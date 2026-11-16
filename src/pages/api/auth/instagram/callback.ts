import type { APIRoute } from "astro";
import { readUsers, updateUsers, createSession, isStaff } from "../../../../lib/auth.ts";
import { safeReturnPath, fetchWithTimeout } from "../../../../lib/http.ts";
import { startMfaChallenge } from "../../../../lib/mfa.ts";
import { cookieOptions, mfaCookieName, setSessionCookie, trustedBrowserCookieName } from "../../../../lib/sessionCookies.ts";
import { trustedMfaBrowser } from "../../../../lib/mfaTrustedBrowsers.ts";

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const GET: APIRoute = async ({ url, cookies, redirect, request }) => {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return json(500, { ok: false, message: "Missing Instagram env vars." });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookies.get("ig_state")?.value;
  const next = safeReturnPath(cookies.get("ig_next")?.value ?? null, "/");

  cookies.delete("ig_state", { path: "/" });
  cookies.delete("ig_next", { path: "/" });

  if (!code) return json(400, { ok: false, message: "Missing code." });
  if (!state || !expectedState || state !== expectedState) {
    return json(400, { ok: false, message: "Invalid state." });
  }

  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", redirectUri);
  form.set("code", code);

  const tokenRes = await fetchWithTimeout(
    "https://api.instagram.com/oauth/access_token",
    {
      method: "POST",
      body: form,
    },
  );

  if (!tokenRes.ok) {
    return json(502, {
      ok: false,
      message: "Token exchange failed.",
    });
  }

  const tokenJson = (await tokenRes.json()) as any;
  const accessToken = String(tokenJson?.access_token ?? "");
  const igUserId = String(tokenJson?.user_id ?? "");

  if (!accessToken || !igUserId) {
    return json(502, { ok: false, message: "Invalid token response." });
  }

  let username: string | undefined;
  try {
    const meUrl = new URL("https://graph.instagram.com/me");
    meUrl.searchParams.set("fields", "id,username");
    meUrl.searchParams.set("access_token", accessToken);

    const meRes = await fetchWithTimeout(meUrl);
    if (meRes.ok) {
      const me = (await meRes.json()) as any;
      username = me?.username ? String(me.username) : undefined;
    }
  } catch {}

  // OAuth may authenticate an existing approved member; it must not approve strangers.
  const user = readUsers().find((u) => u.providers?.instagram?.id === igUserId);
  if (!user?.approved)
    return json(403, {
      ok: false,
      message:
        "承認済みアカウントとの連携が必要です。メールアドレスでログインしてください。",
    });
  if (user.mustResetPassword) return redirect("/ForgotPassword");
  await updateUsers((users) => {
    const current = users.find((u) => u.id === user.id);
    if (current) current.providers.instagram = { id: igUserId, username };
  });
  const maxAgeSeconds = 60 * 60 * 8;
  const trustedToken = cookies.get(trustedBrowserCookieName(request))?.value;
  if (isStaff(user) && !trustedMfaBrowser(user, trustedToken)) {
    const challenge = await startMfaChallenge(user, next, maxAgeSeconds);
    cookies.set(mfaCookieName(request), challenge.token, cookieOptions(request, 600));
    return redirect("/Mfa");
  }
  const session = await createSession(user.id, maxAgeSeconds, user.passwordHash, user.email, undefined, trustedToken);
  setSessionCookie(cookies, request, session);

  return redirect(next);
};

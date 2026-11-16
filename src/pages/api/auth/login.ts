import type { APIRoute } from "astro";
import { createSession, readUsers, isStaff, updateUsers } from "../../../lib/auth.ts";
import { verifyPasswordAsync, hashPasswordAsync, needsPasswordRehash } from "../../../lib/passwords.ts";
import { json, safeReturnPath } from "../../../lib/http.ts";
import { checkLoginAttempts, recordLoginAttempt } from "../../../lib/rateLimit.ts";
import { startMfaChallenge, MfaError } from "../../../lib/mfa.ts";
import { mfaCookieName, cookieOptions, setSessionCookie, trustedBrowserCookieName } from "../../../lib/sessionCookies.ts";
import { trustedMfaBrowser } from "../../../lib/mfaTrustedBrowsers.ts";
import { DEFAULT_SESSION_SECONDS, REMEMBER_SESSION_SECONDS } from "../../../lib/sessionPolicy.ts";
import { audit } from "../../../lib/audit.ts";
import { credentialMismatchMessage } from "../../../lib/siteErrors.ts";

export const POST: APIRoute = async (context) => {
  const { request, cookies } = context;
  let data: Record<string, unknown>;
  try {
    data = request.headers.get("content-type")?.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return json({ ok: false, message: "入力を読み取れません。" }, 400);
  }
  const email = String(data?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(data?.password ?? "");
  if (!email || !password || email.length > 254 || password.length > 1024)
    return json(
      { ok: false, message: "メールアドレスとパスワードを確認してください。" },
      400,
    );
  const user = readUsers().find((u) => u.email.toLowerCase() === email);
  if (!(await checkLoginAttempts(context, email))) return json({ ok: false, message: "ログイン試行が集中しています。15分後に再度お試しください。" }, 429);
  const correct = await verifyPasswordAsync(password, user?.passwordHash);
  if (!user?.passwordHash || !correct) {
    await recordLoginAttempt(context, email, false);
    await audit("anonymous", "auth.login.failed", "login");
    return json(
      {
        ok: false,
        message: credentialMismatchMessage,
      },
      400,
    );
  }
  if (user.mustResetPassword) return json({ ok: false, message: "安全のためパスワードの再設定が必要です。「パスワードを忘れた方」から、以前と異なるパスワードを設定してください。", resetRequired: true }, 403);
  if (!user.approved)
    return json(
      { ok: false, message: "アカウントの承認をお待ちください。" },
      403,
    );
  const remember = data.remember === true || data.remember === "on" || data.remember === "true";
  const maxAge = remember ? REMEMBER_SESSION_SECONDS : DEFAULT_SESSION_SECONDS;
  if (needsPasswordRehash(user.passwordHash)) {
    const old = user.passwordHash, upgraded = await hashPasswordAsync(password);
    await updateUsers(users => {
      const current = users.find(u => u.id === user.id);
      if (!current || current.passwordHash !== old || current.mustResetPassword || current.email !== user.email) throw new Error("Account changed");
      current.passwordHash = upgraded;
    });
    user.passwordHash = upgraded;
  }
  const trustedToken = cookies.get(trustedBrowserCookieName(request))?.value;
  if (isStaff(user) && !trustedMfaBrowser(user, trustedToken)) {
    try {
      const challenge = await startMfaChallenge(user, safeReturnPath(typeof data.next === "string" ? data.next : null, "/"), maxAge);
      cookies.set(mfaCookieName(request), challenge.token, cookieOptions(request, 600));
      return json({ ok: true, next: "/Mfa", mfaRequired: true });
    } catch (error) {
      return json({ ok: false, message: error instanceof MfaError ? error.message : "追加認証を開始できません。再度お試しください。" }, error instanceof MfaError ? error.status : 503);
    }
  }
  await recordLoginAttempt(context, email, true);
  let session;
  try {
    session = await createSession(
      user.id,
      maxAge,
      user.passwordHash,
      user.email,
      undefined,
      trustedToken,
    );
  } catch (error) {
    if (!(error instanceof Error) || ![
      '認証情報が更新されました。再度ログインしてください。',
      'メールアドレスが更新されました。再度ログインしてください。',
      '承認されたアカウントが必要です。',
      'パスワードの再設定が必要です。',
      '二段階認証が必要です。',
    ].includes(error.message)) throw error;
    return json(
      {
        ok: false,
        message:
          "ログイン情報が更新されたか、現在ログインできません。メールアドレスを確認して再度お試しください。",
      },
      409,
    );
  }
  setSessionCookie(cookies, request, session);
  await audit(user.id, "auth.login.success", user.id);
  return json({ ok: true });
};

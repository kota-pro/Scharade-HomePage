import type { APIRoute } from "astro";
import { createSession } from "../../../lib/auth.ts";
import { json } from "../../../lib/http.ts";
import { completeMfaChallenge, resendMfaEmail, MfaError, mfaChallengeView } from "../../../lib/mfa.ts";
import { cookieOptions, mfaCookieName, setSessionCookie } from "../../../lib/sessionCookies.ts";
import { recordLoginAttempt } from "../../../lib/rateLimit.ts";

function failure(error: unknown) {
  return json({ ok: false, message: error instanceof MfaError ? error.message : "認証を確認できません。ログインからやり直してください。" }, error instanceof MfaError ? error.status : 503);
}
export const GET: APIRoute = async ({ cookies, request }) => {
  try { return json({ ok: true, ...mfaChallengeView(cookies.get(mfaCookieName(request))?.value ?? "") }); }
  catch (error) { return failure(error); }
};
export const POST: APIRoute = async (context) => {
  const { request, cookies } = context;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["action", "code"].includes(key))) throw new MfaError();
    const token = cookies.get(mfaCookieName(request))?.value ?? "";
    if (body.action === "resend") return json({ ok: true, ...await resendMfaEmail(token) });
    if (body.action !== "verify" || typeof body.code !== "string" || body.code.length > 6) throw new MfaError();
    const completed = await completeMfaChallenge(token, body.code);
    const session = await createSession(completed.user.id, completed.maxAge, completed.user.passwordHash, completed.user.email, completed.grant);
    setSessionCookie(cookies, request, session);
    cookies.delete(mfaCookieName(request), cookieOptions(request, 0));
    await recordLoginAttempt(context, completed.user.email, true);
    return json({ ok: true, next: completed.next });
  } catch (error) { return failure(error); }
};

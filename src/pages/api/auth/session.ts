import type { APIRoute } from "astro";
import { getAuthenticationFromRequest, renewSession, sessionStatus, touchSession } from "../../../lib/auth.ts";
import { json, isSameOrigin } from "../../../lib/http.ts";
import { sessionCookieName, setSessionCookie, refreshTrustedBrowserCookie } from "../../../lib/sessionCookies.ts";

const expired = () => json({ ok: false, authenticated: false, message: "ログインの有効期限が切れました。再度ログインしてください。" }, 401);
export const GET: APIRoute = ({ request }) => {
  const { user, session } = getAuthenticationFromRequest(request);
  // A routine status poll becoming signed out is an expected state, not an error report.
  return user && session ? json(sessionStatus(session, user)) : json({ ok: true, authenticated: false });
};
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request)) return json({ ok: false, message: "このサイトの画面から操作してください。" }, 403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => k !== "action") || !["activity", "renew"].includes(body.action))
    return json({ ok: false, message: "操作を確認してください。" }, 400);
  const { user, session } = getAuthenticationFromRequest(request);
  if (!user || !session) return expired();
  if (body.action === "activity") {
    const current = await touchSession(session, true);
    if (!current) return expired();
    refreshTrustedBrowserCookie(cookies, request, current);
    return json(sessionStatus(current, user));
  }
  const current = await renewSession(cookies.get(sessionCookieName(request))?.value ?? "");
  if (!current) return expired();
  setSessionCookie(cookies, request, current);
  return json(sessionStatus(current, user));
};

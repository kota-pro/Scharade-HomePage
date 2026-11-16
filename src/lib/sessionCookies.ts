import type { AstroCookies } from "astro";
import type { Session } from "./auth.ts";
import { env } from "./config.ts";
import { securityHash } from "./mfaState.ts";
import { MFA_IDLE_MS } from "./sessionPolicy.ts";

export const sessionCookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-session" : "session";
export const mfaCookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-mfa" : "mfa";
export const trustedBrowserCookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-mfa-browser" : "mfa-browser";
export function cookieOptions(request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:";
  if (!secure && !["development", "test"].includes(env("NODE_ENV"))) throw new Error("HTTPSが必要です。");
  return { path: "/", httpOnly: true, sameSite: "lax" as const, secure, maxAge };
}
export function refreshTrustedBrowserCookie(cookies: AstroCookies, request: Request, session: Session, token = cookies.get(trustedBrowserCookieName(request))?.value) {
  if (token && session.mfaTrustHash === securityHash(token))
    cookies.set(trustedBrowserCookieName(request), token, { ...cookieOptions(request, MFA_IDLE_MS / 1000), expires: new Date(Date.now() + MFA_IDLE_MS) });
}
export function setSessionCookie(cookies: AstroCookies, request: Request, session: Session & { token: string; trustedBrowserToken?: string }) {
  cookies.delete("session", { path: "/" });
  cookies.set(sessionCookieName(request), session.token, { ...cookieOptions(request, Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000))), expires: new Date(session.expiresAt) });
  refreshTrustedBrowserCookie(cookies, request, session, session.trustedBrowserToken ?? cookies.get(trustedBrowserCookieName(request))?.value);
}

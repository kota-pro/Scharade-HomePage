import type { AstroCookies } from "astro";
import type { Session } from "./auth.ts";
import { env } from "./config.ts";

export const sessionCookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-session" : "session";
export const mfaCookieName = (request: Request) => new URL(request.url).protocol === "https:" ? "__Host-mfa" : "mfa";
export function cookieOptions(request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:";
  if (!secure && !["development", "test"].includes(env("NODE_ENV"))) throw new Error("HTTPSが必要です。");
  return { path: "/", httpOnly: true, sameSite: "lax" as const, secure, maxAge };
}
export function setSessionCookie(cookies: AstroCookies, request: Request, session: Session & { token: string }) {
  cookies.delete("session", { path: "/" });
  cookies.set(sessionCookieName(request), session.token, { ...cookieOptions(request, Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000))), expires: new Date(session.expiresAt) });
}

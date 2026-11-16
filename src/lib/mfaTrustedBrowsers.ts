import crypto from "node:crypto";
import { isStaff } from "./roles.ts";
import type { User } from "./auth.ts";
import { securityHash } from "./mfaState.ts";
import { readData, writeData } from "./store.ts";
import { MFA_IDLE_MS } from "./sessionPolicy.ts";

export type TrustedBrowser = {
  tokenHash: string; userId: string; authVersion: number;
  passwordFingerprint: string; emailFingerprint: string;
  verifiedAt: string; lastSeenAt: number; expiresAt: number;
};
const file = "mfa-trusted-browsers.json";
export function readTrustedBrowsers(): TrustedBrowser[] {
  const browsers = readData<TrustedBrowser[]>(file, []);
  if (!Array.isArray(browsers) || browsers.some(b => !b || typeof b.tokenHash !== "string" || !Number.isFinite(b.expiresAt)))
    throw new Error("ブラウザーの認証記録を読み込めません。");
  return browsers;
}
function matches(browser: TrustedBrowser, user: User, now: number) {
  return user.approved && !user.mustResetPassword && isStaff(user) &&
    browser.userId === user.id && browser.authVersion === (user.authVersion ?? 0) &&
    browser.passwordFingerprint === securityHash(user.passwordHash ?? "") && browser.emailFingerprint === securityHash(user.email) &&
    Number.isFinite(Date.parse(browser.verifiedAt)) && browser.lastSeenAt > now - MFA_IDLE_MS && browser.expiresAt > now;
}
export function trustedBrowserByHash(user: User, hash: string, now = Date.now()) {
  return readTrustedBrowsers().find(b => b.tokenHash === hash && matches(b, user, now));
}
export function trustedMfaBrowser(user: User, token?: string) {
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? trustedBrowserByHash(user, securityHash(token)) : undefined;
}
/** These mutations share the auth lock with sessions, resets and account changes. */
export function issueTrustedBrowser(user: User) {
  const now = Date.now(), token = crypto.randomBytes(32).toString("base64url");
  const browser: TrustedBrowser = { tokenHash: securityHash(token), userId: user.id, authVersion: user.authVersion ?? 0,
    passwordFingerprint: securityHash(user.passwordHash ?? ""), emailFingerprint: securityHash(user.email),
    verifiedAt: new Date(now).toISOString(), lastSeenAt: now, expiresAt: now + MFA_IDLE_MS };
  const all = readTrustedBrowsers().filter(b => b.expiresAt > now);
  const retained = all.filter(b => b.userId !== user.id);
  retained.push(...all.filter(b => b.userId === user.id).sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 9), browser);
  writeData(file, retained);
  return { browser, token };
}
export function touchTrustedBrowser(user: User, hash?: string) {
  if (!hash) return;
  const now = Date.now(), all = readTrustedBrowsers().filter(b => b.expiresAt > now);
  const current = all.find(b => b.tokenHash === hash && matches(b, user, now));
  if (current) { current.lastSeenAt = now; current.expiresAt = now + MFA_IDLE_MS; writeData(file, all); }
}
export function removeTrustedBrowsers(hashes: string[]) {
  if (hashes.length) writeData(file, readTrustedBrowsers().filter(b => !hashes.includes(b.tokenHash) && b.expiresAt > Date.now()));
}

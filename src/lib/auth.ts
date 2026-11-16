import crypto from "node:crypto";
import { isArchivedPortfolio } from "../data/portfolioVisibility.ts";
import { resolveAdminView, matchesAdminViewRequest, type AdminViewState } from "./adminViewState.ts";
import { previewActor } from "./requestIdentity.ts";
import { isAdmin, isStaff } from "./roles.ts";
import type { Role } from "./roles.ts";
export { isAdmin, isStaff, isExecutive, canManageAccount } from "./roles.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import { consumeMfaGrant, securityHash } from "./mfaState.ts";
import { revokePushSession } from "./pushDeviceState.ts";
import { DEFAULT_SESSION_SECONDS, REMEMBER_SESSION_SECONDS, MFA_IDLE_MS, SESSION_WARNING_MS } from "./sessionPolicy.ts";
import { issueTrustedBrowser, trustedMfaBrowser, trustedBrowserByHash, touchTrustedBrowser, removeTrustedBrowsers } from "./mfaTrustedBrowsers.ts";

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  approved: boolean;
  approvalNotifiedAt?: string;
  approvalReviewedAt?: string;
  approvalReviewAction?: "approve" | "reject";
  approvalSetup?: import("./accountSetup.ts").AccountSetup;
  rosterRelink?: { id: string; name: string; attempts: number; nextAttemptAt: number };
  role?: Role;
  authVersion?: number;
  mustResetPassword?: boolean;
  portfolioName?: string;
  createdAt: string;
  providers: {
    credentials?: true;
    instagram?: { id: string; username?: string };
  };
  portfolioId?: string | null;
  /** Dedicated site account; personal administrators do not have this marker. */
  siteManagement?: true;
};
export type Session = {
  adminView?: AdminViewState;
  id: string;
  tokenHash?: string;
  userId: string;
  authVersion?: number;
  expiresAt: string;
  createdAt: string;
  lastSeenAt?: string;
  mfaVerifiedAt?: string;
  mfaMethod?: "email";
  remember?: boolean;
  mfaTrustHash?: string;
};

export function readUsers(): User[] {
  const users = readData<User[]>("users.json", []);
  if (
    !Array.isArray(users) ||
    users.some(
      (u) => !u || typeof u.id !== "string" || typeof u.email !== "string",
    )
  )
    throw new Error("会員データの形式が正しくありません。");
  return users;
}
export function actorUser(id?: string) {
  return previewActor(id) ?? readUsers().find(user => user.id === id);
}
export function readSessions(): Session[] {
  const sessions = readData<Session[]>("sessions.json", []);
  if (!Array.isArray(sessions))
    throw new Error("セッションデータの形式が正しくありません。");
  return sessions;
}
export async function updateUsers(update: (users: User[]) => void) {
  return withStoreLock("auth", () => {
    const users = readUsers();
    update(users);
    writeData("users.json", users);
    return users;
  });
}
export async function createSession(
  userId: string,
  seconds: number,
  expectedPasswordHash?: string,
  expectedEmail?: string,
  mfaGrant?: string,
  trustedBrowserToken?: string,
) {
  return withStoreLock("auth", () => {
    const user = readUsers().find((u) => u.id === userId);
    if (expectedPasswordHash !== undefined && user?.passwordHash !== expectedPasswordHash)
      throw new Error("認証情報が更新されました。再度ログインしてください。");
    if (
      expectedEmail !== undefined &&
      user?.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()
    )
      throw new Error(
        "メールアドレスが更新されました。再度ログインしてください。",
      );
    if (!user?.approved) throw new Error("承認されたアカウントが必要です。");
    if (user.mustResetPassword) throw new Error("パスワードの再設定が必要です。");
    const privileged = isStaff(user);
    const freshMfa = privileged && consumeMfaGrant(user.id, user.authVersion ?? 0, user.passwordHash ?? "", user.email, mfaGrant);
    let browser = privileged && expectedPasswordHash === user.passwordHash && expectedEmail !== undefined ? trustedMfaBrowser(user, trustedBrowserToken) : undefined;
    if (privileged && !freshMfa && !browser) throw new Error("二段階認証が必要です。");
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("セッション期間が正しくありません。");
    if (freshMfa) {
      const issued = issueTrustedBrowser(user); browser = issued.browser; trustedBrowserToken = issued.token;
    } else if (browser) touchTrustedBrowser(user, browser.tokenHash);
    const now = Date.now();
    const token = crypto.randomBytes(32).toString("base64url");
    const session: Session = {
      id: crypto.randomUUID(),
      tokenHash: securityHash(token),
      userId,
      authVersion: user.authVersion ?? 0,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.min(seconds, REMEMBER_SESSION_SECONDS) * 1000).toISOString(),
      remember: seconds > DEFAULT_SESSION_SECONDS,
      lastSeenAt: new Date(now).toISOString(),
      ...(privileged && browser ? { mfaVerifiedAt: browser.verifiedAt, mfaMethod: "email" as const, mfaTrustHash: browser.tokenHash } : {}),
    };
    writeData("sessions.json", [
      ...readSessions().filter((s) => Date.parse(s.expiresAt) > now),
      session,
    ]);
    return { ...session, token, ...(privileged ? { trustedBrowserToken } : {}) };
  });
}
export async function deleteSession(token?: string, trustedBrowserToken?: string) {
  await withStoreLock("auth", async () => {
    const sessions = readSessions();
    const tokenHash = token ? securityHash(token) : undefined;
    const session = sessions.find(s => tokenHash && s.tokenHash === tokenHash);
    if (session) await revokePushSession(session.id);
    removeTrustedBrowsers([session?.mfaTrustHash, trustedBrowserToken ? securityHash(trustedBrowserToken) : undefined].filter((x): x is string => Boolean(x)));
    writeData(
      "sessions.json",
      sessions.filter(
        (s) => (!tokenHash || s.tokenHash !== tokenHash) && Date.parse(s.expiresAt) > Date.now(),
      ),
    );
  });
}
export function canEditPortfolio(
  user: User | null | undefined,
  portfolioId: string,
): boolean {
  return Boolean(
    portfolioId && user?.approved &&
      (isAdmin(user) || !isArchivedPortfolio({ id: portfolioId }) && user.portfolioId === portfolioId),
  );
}
function sessionUser(session: Session) {
  if (!(Date.parse(session.expiresAt) > Date.now())) return null;
  const user = readUsers().find(u => u.id === session.userId && u.approved && !u.mustResetPassword && (u.authVersion ?? 0) === (session.authVersion ?? 0));
  if (user && isStaff(user) && (session.mfaMethod !== "email" || !Number.isFinite(Date.parse(session.mfaVerifiedAt ?? "")) ||
    !(Date.parse(session.lastSeenAt ?? session.createdAt) > Date.now() - MFA_IDLE_MS) ||
    (session.mfaTrustHash && !trustedBrowserByHash(user, session.mfaTrustHash)))) return null;
  return user ?? null;
}
export function getUserFromSession(sessionId?: string) {
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return { user: null, session: null };
  const tokenHash = securityHash(sessionId);
  const session = readSessions().find(
    (s) => s.tokenHash === tokenHash && Date.parse(s.expiresAt) > Date.now(),
  );
  if (!session) return { user: null, session: null };
  const user = sessionUser(session);
  return user ? { user, session } : { user: null, session: null };
}
export async function touchSession(session: Session, force = false) {
  if (!force && Date.parse(session.lastSeenAt ?? session.createdAt) > Date.now() - 60_000) return session;
  return withStoreLock("auth", () => {
    const all = readSessions(), current = all.find(s => s.id === session.id);
    const user = current && sessionUser(current);
    if (!current || !user) return null;
    current.lastSeenAt = new Date(Date.now()).toISOString(); touchTrustedBrowser(user, current.mfaTrustHash); writeData("sessions.json", all);
    return current;
  });
}
export async function renewSession(token: string) {
  return withStoreLock("auth", () => {
    const all = readSessions(), current = all.find(s => s.tokenHash === securityHash(token));
    const user = current && sessionUser(current);
    if (!current || !user) return null;
    current.lastSeenAt = new Date(Date.now()).toISOString();
    current.expiresAt = new Date(Date.now() + (current.remember ? REMEMBER_SESSION_SECONDS : DEFAULT_SESSION_SECONDS) * 1000).toISOString();
    touchTrustedBrowser(user, current.mfaTrustHash); writeData("sessions.json", all);
    return { ...current, token };
  });
}
export function sessionStatus(session: Session, user: User) {
  const deadline = Math.min(Date.parse(session.expiresAt), isStaff(user) ? Date.parse(session.lastSeenAt ?? session.createdAt) + MFA_IDLE_MS : Infinity);
  return { ok: true, authenticated: true, serverNow: Date.now(), expiresAt: deadline, remember: Boolean(session.remember), warningMs: SESSION_WARNING_MS };
}
export function getAuthenticationFromRequest(request: Request) {
  const cookieName = new URL(request.url).protocol === "https:" ? "__Host-session" : "session";
  const cookie = (request.headers.get("cookie") ?? "")
    .split(";")
    .find((p) => p.trim().startsWith(`${cookieName}=`));
  if (!cookie) return { user: null, session: null };
  try {
    return getUserFromSession(
      decodeURIComponent(cookie.trim().slice(cookieName.length + 1)),
    );
  } catch (error) {
    if (error instanceof URIError) return { user: null, session: null };
    throw error;
  }
}
export function getUserFromRequest(request: Request) {
  const authentication = getAuthenticationFromRequest(request);
  const view = resolveAdminView(authentication.user, authentication.session, authentication.session?.adminView ? readUsers() : []);
  return { ...authentication, ...view, user: matchesAdminViewRequest(request, view.adminView) ? view.user : null, actor: authentication.user };
}

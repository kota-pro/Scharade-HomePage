import crypto from "node:crypto";
import { readData, writeData, withStoreLock } from "./store.ts";
import { consumeMfaGrant, securityHash } from "./mfaState.ts";
import { revokePushSession } from "./pushDeviceState.ts";

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  approved: boolean;
  approvalNotifiedAt?: string;
  approvalReviewedAt?: string;
  approvalReviewAction?: "approve" | "reject";
  role?: "member" | "staff" | "admin";
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
  id: string;
  tokenHash?: string;
  userId: string;
  authVersion?: number;
  expiresAt: string;
  createdAt: string;
  lastSeenAt?: string;
  mfaVerifiedAt?: string;
  mfaMethod?: "email";
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
) {
  return withStoreLock("auth", () => {
    const user = readUsers().find((u) => u.id === userId);
    if (expectedPasswordHash && user?.passwordHash !== expectedPasswordHash)
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
    if (privileged && !consumeMfaGrant(user.id, user.authVersion ?? 0, user.passwordHash ?? "", user.email, mfaGrant)) throw new Error("二段階認証が必要です。");
    const now = Date.now();
    const token = crypto.randomBytes(32).toString("base64url");
    const session: Session = {
      id: crypto.randomUUID(),
      tokenHash: securityHash(token),
      userId,
      authVersion: user.authVersion ?? 0,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.min(seconds, privileged ? 8 * 60 * 60 : 30 * 24 * 60 * 60) * 1000).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      ...(privileged ? { mfaVerifiedAt: new Date(now).toISOString(), mfaMethod: "email" as const } : {}),
    };
    writeData("sessions.json", [
      ...readSessions().filter((s) => Date.parse(s.expiresAt) > now),
      session,
    ]);
    return { ...session, token };
  });
}
export async function deleteSession(token: string) {
  await withStoreLock("auth", async () => {
    const sessions = readSessions();
    const session = sessions.find(s => s.tokenHash === securityHash(token));
    if (session) await revokePushSession(session.id);
    writeData(
      "sessions.json",
      sessions.filter(
        (s) => s.tokenHash !== securityHash(token) && Date.parse(s.expiresAt) > Date.now(),
      ),
    );
  });
}
export function isAdmin(user: User | null | undefined): boolean {
  return Boolean(user?.approved && user.role === "admin");
}
export function isStaff(user: User | null | undefined): boolean {
  return Boolean(user?.approved && (user.role === "staff" || user.role === "admin"));
}
export function canEditPortfolio(
  user: User | null | undefined,
  portfolioId: string,
): boolean {
  return Boolean(
    user?.approved && (isAdmin(user) || user.portfolioId === portfolioId),
  );
}
export function getUserFromSession(sessionId?: string) {
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(sessionId)) return { user: null, session: null };
  const tokenHash = securityHash(sessionId);
  const session = readSessions().find(
    (s) => s.tokenHash === tokenHash && Date.parse(s.expiresAt) > Date.now(),
  );
  if (!session) return { user: null, session: null };
  const user = readUsers().find(
    (u) =>
      u.id === session.userId &&
      u.approved &&
      !u.mustResetPassword &&
      (u.authVersion ?? 0) === (session.authVersion ?? 0),
  );
  if (user && isStaff(user) && (session.mfaMethod !== "email" || !session.mfaVerifiedAt || Date.parse(session.lastSeenAt ?? session.createdAt) <= Date.now() - 30 * 60 * 1000)) return { user: null, session: null };
  return user ? { user, session } : { user: null, session: null };
}
export async function touchSession(session: Session) {
  if (Date.parse(session.lastSeenAt ?? session.createdAt) > Date.now() - 60_000) return;
  await withStoreLock("auth", () => {
    const all = readSessions(), current = all.find(s => s.id === session.id);
    if (current) { current.lastSeenAt = new Date().toISOString(); writeData("sessions.json", all); }
  });
}
export function getUserFromRequest(request: Request) {
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

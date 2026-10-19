import crypto from "node:crypto";
import { readData, writeData, withStoreLock } from "./store.ts";
import { readUsers, readSessions } from "./auth.ts";
import { hashPasswordAsync, validNewPassword, verifyPasswordAsync } from "./passwords.ts";
export { hashPassword } from "./passwords.ts";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
type PasswordResetToken = {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};
function readTokens() {
  const tokens = readData<PasswordResetToken[]>(
    "password-reset-tokens.json",
    [],
  );
  if (!Array.isArray(tokens))
    throw new Error("再設定データの形式が正しくありません。");
  return tokens;
}
const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");
const validTokens = () =>
  readTokens().filter((t) => Date.parse(t.expiresAt) > Date.now());
export class ResetAccountChangedError extends Error {}

export async function createPasswordResetToken(
  userId: string,
  expectedEmail?: string,
) {
  return withStoreLock("auth", () => {
    const user = readUsers().find((user) => user.id === userId);
    if (
      !user ||
      (expectedEmail !== undefined &&
        user.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase())
    )
      throw new ResetAccountChangedError(
        "Account changed before reset token creation",
      );
    const now = Date.now();
    const token = crypto.randomBytes(32).toString("base64url");
    const tokens = validTokens().filter((t) => t.userId !== userId);
    tokens.push({
      tokenHash: hashToken(token),
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PASSWORD_RESET_TTL_MS).toISOString(),
    });
    writeData("password-reset-tokens.json", tokens);
    return token;
  });
}
export function findPasswordResetToken(token: string) {
  if (!token || token.length > 200) return null;
  return validTokens().find((t) => t.tokenHash === hashToken(token)) ?? null;
}
export async function revokePasswordResetToken(token: string) {
  await withStoreLock("auth", () =>
    writeData(
      "password-reset-tokens.json",
      validTokens().filter((t) => t.tokenHash !== hashToken(token)),
    ),
  );
}

/** Call only while holding the auth lock. */
export function revokeUserPasswordResetTokens(userId: string) {
  writeData(
    "password-reset-tokens.json",
    validTokens().filter((token) => token.userId !== userId),
  );
}
export async function resetPassword(token: string, password: string) {
  const initial = findPasswordResetToken(token);
  if (!initial || !validNewPassword(password)) return false;
  const previous = readUsers().find(u => u.id === initial.userId);
  if (previous?.mustResetPassword && previous.passwordHash && await verifyPasswordAsync(password, previous.passwordHash)) return false;
  const passwordHash = await hashPasswordAsync(password);
  return withStoreLock("auth", () => {
    const entry = findPasswordResetToken(token);
    if (!entry) return false;
    const users = readUsers();
    const user = users.find((u) => u.id === entry.userId);
    if (!user) return false;
    if (user.passwordHash !== previous?.passwordHash || (user.authVersion ?? 0) !== (previous?.authVersion ?? 0)) return false;
    // Invalidate existing sessions even if the process stops before session cleanup.
    user.passwordHash = passwordHash;
    delete user.mustResetPassword;
    user.providers.credentials = true;
    user.authVersion = (user.authVersion ?? 0) + 1;
    writeData(
      "password-reset-tokens.json",
      validTokens().filter((t) => t.userId !== entry.userId),
    );
    writeData("users.json", users);
    writeData(
      "sessions.json",
      readSessions().filter((s) => s.userId !== user.id),
    );
    return true;
  });
}

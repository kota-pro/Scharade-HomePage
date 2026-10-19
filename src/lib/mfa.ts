import crypto from "node:crypto";
import { readUsers, isStaff, type User } from "./auth.ts";
import { withStoreLock } from "./store.ts";
import { readMfaState, writeMfaState, securityHash, type MfaChallenge, type MfaState } from "./mfaState.ts";
import { mailTransport, CONTACT_EMAIL } from "./mail.ts";
import { safeReturnPath } from "./http.ts";
import { env } from "./config.ts";
import { audit } from "./audit.ts";

const TTL = 10 * 60_000, WINDOW = 15 * 60_000, RESEND_DELAY = 60_000;
type SendEmail = (email: string, code: string, expiresAt: number) => Promise<void>;
export class MfaError extends Error {
  status: number;
  constructor(message = "認証を確認できません。ログインからやり直してください。", status = 400) { super(message); this.status = status; }
}
function challengeKey(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new MfaError();
  return securityHash(token);
}
function currentChallenge(state: MfaState, token: string) {
  const key = challengeKey(token), challenge = state.challenges[key];
  if (!challenge || challenge.expiresAt <= Date.now() || challenge.attempts >= 5) throw new MfaError("認証の有効期限が切れました。ログインからやり直してください。", 410);
  const user = readUsers().find(u => u.id === challenge.userId && isStaff(u) && !u.mustResetPassword && (u.authVersion ?? 0) === challenge.authVersion && securityHash(u.passwordHash ?? "") === challenge.passwordFingerprint && securityHash(u.email) === challenge.emailFingerprint);
  if (!user) throw new MfaError();
  const delivery = state.deliveries[user.id];
  if (delivery && delivery.windowStart + WINDOW > Date.now() && delivery.failedAttempts >= 5) throw new MfaError("確認の試行が集中しています。15分ほど待ってログインからやり直してください。", 429);
  return { key, challenge, user };
}
function emailHash(challengeToken: string, code: string) {
  const key = env("MFA_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new MfaError("認証の設定を確認してください。", 503);
  return crypto.createHmac("sha256", Buffer.from(key, "hex")).update(`mfa-email-v2:${challengeToken}:${code}`).digest("hex");
}
function sameHash(a: string, b: string) {
  const aa = Buffer.from(a, "hex"), bb = Buffer.from(b, "hex");
  return aa.length === 32 && bb.length === 32 && crypto.timingSafeEqual(aa, bb);
}
function deliveryWindow(state: MfaState, userId: string) {
  const previous = state.deliveries[userId];
  if (!previous || previous.windowStart + WINDOW <= Date.now()) state.deliveries[userId] = { windowStart: Date.now(), lastSentAt: 0, sent: 0, failedAttempts: 0 };
  return state.deliveries[userId];
}
function reserveEmail(state: MfaState, userId: string) {
  const delivery = deliveryWindow(state, userId);
  if (delivery.failedAttempts >= 5 || delivery.sent >= 5) throw new MfaError("確認の試行や送信が集中しています。15分ほど待って再度お試しください。", 429);
  if (delivery.lastSentAt + RESEND_DELAY > Date.now()) throw new MfaError("確認メールは送信済みです。再送する場合は60秒ほど待ってください。", 429);
  delivery.lastSentAt = Date.now(); delivery.sent++;
}
function failure(state: MfaState, key: string, challenge: MfaChallenge): never {
  challenge.attempts++; deliveryWindow(state, challenge.userId).failedAttempts++;
  if (challenge.attempts >= 5) delete state.challenges[key];
  writeMfaState(state);
  throw new MfaError("コードが正しくないか、既に使用済みです。", 400);
}
const sendConfirmation: SendEmail = async (email, code, expiresAt) => {
  const result = await mailTransport().sendMail({ from: `"写団シャレード" <${CONTACT_EMAIL}>`, to: email,
    subject: "【写団シャレード】ログインの二段階認証コード", text: `ログインを確認します。\n\n確認コード：${code}\n\n有効期限：${new Date(expiresAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false })}（日本時間）\nログイン開始から10分間有効です。再送後は最後に届いたコードを使ってください。コードを他の人に伝えないでください。心当たりがない場合はパスワードを変更してください。` });
  if (!result.accepted?.length) throw new Error("SMTP did not accept the confirmation email");
};
export function maskedMfaEmail(email: string) {
  const at = email.lastIndexOf("@");
  return at > 0 ? `${email.slice(0, Math.min(2, at))}***${email.slice(at)}` : "登録済みメールアドレス";
}
async function deliver(token: string, email: string, code: string, expiresAt: number, deliveryId: string, sendEmail: SendEmail) {
  const key = challengeKey(token);
  try { await sendEmail(email, code, expiresAt); }
  catch {
    await withStoreLock("auth", () => { const state = readMfaState(); if (state.challenges[key]?.deliveryId === deliveryId) delete state.challenges[key]; writeMfaState(state); });
    throw new MfaError("確認メールを送信できません。時間をおいて再度ログインしてください。", 503);
  }
  await withStoreLock("auth", () => {
    const state = readMfaState(), { challenge } = currentChallenge(state, token);
    if (challenge.deliveryId !== deliveryId) throw new MfaError();
    challenge.delivered = true; writeMfaState(state);
  });
}
export async function startMfaChallenge(user: User, returnPath = "/", maxAge = 8 * 60 * 60, sendEmail: SendEmail = sendConfirmation) {
  const token = crypto.randomBytes(32).toString("base64url"), key = securityHash(token), deliveryId = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = await withStoreLock("auth", () => {
    const latest = readUsers().find(u => u.id === user.id);
    if (!latest || !isStaff(latest) || latest.mustResetPassword || latest.passwordHash !== user.passwordHash || latest.email !== user.email || (latest.authVersion ?? 0) !== (user.authVersion ?? 0)) throw new MfaError();
    const state = readMfaState(); reserveEmail(state, user.id);
    for (const [id, challenge] of Object.entries(state.challenges)) if (challenge.userId === user.id) delete state.challenges[id];
    const expiresAt = Date.now() + TTL;
    state.challenges[key] = { userId: user.id, authVersion: user.authVersion ?? 0,
      passwordFingerprint: securityHash(user.passwordHash ?? ""), emailFingerprint: securityHash(user.email), expiresAt, attempts: 0,
      returnPath: safeReturnPath(returnPath, "/"), maxAge: Math.min(maxAge, 8 * 60 * 60),
      emailCodeHash: emailHash(token, code), delivered: false, deliveryId };
    writeMfaState(state); return expiresAt;
  });
  await deliver(token, user.email, code, expiresAt, deliveryId, sendEmail);
  await audit(user.id, "auth.mfa.email.challenge", user.id);
  return { token, expiresAt };
}
export function mfaChallengeView(token: string) {
  const state = readMfaState(), { challenge, user } = currentChallenge(state, token);
  return { method: "email" as const, email: maskedMfaEmail(user.email), expiresAt: challenge.expiresAt, serverNow: Date.now(),
    resendAt: (state.deliveries[user.id]?.lastSentAt ?? Date.now()) + RESEND_DELAY };
}
export async function resendMfaEmail(token: string, sendEmail: SendEmail = sendConfirmation) {
  let code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const deliveryId = crypto.randomUUID();
  const { user, expiresAt } = await withStoreLock("auth", () => {
    const state = readMfaState(), { challenge, user } = currentChallenge(state, token);
    if (!challenge.delivered) throw new MfaError("確認メールを送信しています。しばらくお待ちください。", 429);
    reserveEmail(state, user.id);
    while (sameHash(challenge.emailCodeHash, emailHash(token, code))) code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    challenge.emailCodeHash = emailHash(token, code); challenge.delivered = false; challenge.deliveryId = deliveryId;
    // Keep the original expiry and attempt count. Resending cannot extend password proof or reset guesses.
    writeMfaState(state); return { user, expiresAt: challenge.expiresAt };
  });
  await deliver(token, user.email, code, expiresAt, deliveryId, sendEmail);
  await audit(user.id, "auth.mfa.email.resend", user.id);
  return mfaChallengeView(token);
}
export async function completeMfaChallenge(token: string, code: string) {
  const result = await withStoreLock("auth", () => {
    const state = readMfaState(), { key, challenge, user } = currentChallenge(state, token);
    if (!challenge.delivered) throw new MfaError("確認メールを送信しています。しばらくお待ちください。", 503);
    if (!/^\d{6}$/.test(code) || !sameHash(challenge.emailCodeHash, emailHash(token, code))) return failure(state, key, challenge);
    const grant = crypto.randomBytes(32).toString("base64url");
    state.grants[securityHash(grant)] = { userId: user.id, authVersion: user.authVersion ?? 0,
      passwordFingerprint: challenge.passwordFingerprint, emailFingerprint: challenge.emailFingerprint,
      method: "email", expiresAt: Date.now() + 60_000 };
    delete state.challenges[key]; delete state.deliveries[user.id]; writeMfaState(state);
    return { user, grant, maxAge: challenge.maxAge, next: safeReturnPath(challenge.returnPath, "/") };
  });
  await audit(result.user.id, "auth.mfa.email.verify", result.user.id);
  return result;
}

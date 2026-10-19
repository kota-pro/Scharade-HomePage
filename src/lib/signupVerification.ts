import crypto from "node:crypto";
import { env } from "./config.ts";
import { mailTransport, CONTACT_EMAIL } from "./mail.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import { checkSignupCodeRequest } from "./rateLimit.ts";

const FILE = "signup-verifications.json";
export const SIGNUP_CODE_TTL = 10 * 60_000;
type Challenge = { tokenHash: string; email: string; codeHash: string; expiresAt: number; attempts: number };
export class SignupVerificationError extends Error {
  status: number;
  restart: boolean;
  constructor(message = "確認コードが正しくありません。", status = 400, restart = false) { super(message); this.status = status; this.restart = restart; }
}
export const normalizeSignupEmail = (email: string) => email.trim().toLowerCase();
export function validSignupEmail(email: string) {
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(email)
    && !email.startsWith(".") && !email.includes("..") && !email.includes(".@");
}
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
function codeHash(token: string, code: string) {
  const secret = env("SIGNUP_REVIEW_SECRET");
  if (secret.length < 32) throw new SignupVerificationError("現在はメール確認を利用できません。時間をおいて再度お試しください。", 503);
  return crypto.createHmac("sha256", secret).update(`signup-email-v1:${token}:${code}`).digest("hex");
}
function activeChallenges() {
  const entries = readData<Challenge[]>(FILE, []);
  if (!Array.isArray(entries)) throw new SignupVerificationError("メール確認の保存状態を確認してください。", 503);
  return entries.filter(entry => entry.expiresAt > Date.now() && entry.attempts < 5);
}
function matches(expected: string, actual: string) {
  const a = Buffer.from(expected, "hex"), b = Buffer.from(actual, "hex");
  return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b);
}
async function revoke(token: string) {
  await withStoreLock("signup-verification", () => writeData(FILE, activeChallenges().filter(entry => entry.tokenHash !== hashToken(token))));
}

/** Account existence is never consulted before mailbox ownership is proved. */
export async function requestSignupCode(email: string, send: (email: string, code: string) => Promise<void> = async (recipient, code) => {
  await mailTransport().sendMail({ from: `"写団シャレード" <${CONTACT_EMAIL}>`, to: recipient,
    subject: "【写団シャレード】新規登録の認証コード", text: `メールアドレスの所有確認を行います。\n\n確認コード：${code}\n\n有効期限は10分です。コードを他の人に伝えないでください。登録した覚えがない場合は、このメールを破棄してください。` });
}) {
  const started = Date.now(); email = normalizeSignupEmail(email);
  if (!validSignupEmail(email)) throw new SignupVerificationError("メールアドレスを確認してください。");
  if (!env("GMAIL_PASS")) throw new SignupVerificationError("現在はメール確認を利用できません。時間をおいて再度お試しください。", 503);
  const verificationToken = crypto.randomBytes(32).toString("base64url"), code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const digest = codeHash(verificationToken, code), expiresAt = Date.now() + SIGNUP_CODE_TTL;
  if (await checkSignupCodeRequest(email)) {
    const stored = await withStoreLock("signup-verification", () => {
      const entries = activeChallenges();
      if (entries.length >= 2000) return false;
      entries.push({ tokenHash: hashToken(verificationToken), email, codeHash: digest, expiresAt, attempts: 0 });
      writeData(FILE, entries); return true;
    });
    // A slow or failed SMTP service must not reveal registration state or block this response.
    if (stored) void Promise.resolve().then(() => send(email, code)).catch(async () => {
      console.error("[auth/signup] confirmation mail failed"); await revoke(verificationToken);
    }).catch(() => console.error("[auth/signup] confirmation cleanup failed"));
  }
  await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, 600 - (Date.now() - started))));
  return { verificationToken, expiresAt };
}

/** Consume before provisioning; concurrent/replayed confirmation cannot create two accounts. */
export async function confirmSignupEmail(token: string, email: string, code: string) {
  email = normalizeSignupEmail(email);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new SignupVerificationError("メール確認コードを取得してから登録してください。", 400, true);
  return withStoreLock("signup-verification", () => {
    const entries = activeChallenges(), index = entries.findIndex(entry => entry.tokenHash === hashToken(token));
    const entry = entries[index];
    if (!entry) throw new SignupVerificationError("メール確認の有効期限が切れました。コードを再取得してください。", 410, true);
    if (entry.email !== email || !/^\d{6}$/.test(code) || !matches(entry.codeHash, codeHash(token, code))) {
      entry.attempts++;
      if (entry.attempts >= 5) entries.splice(index, 1);
      writeData(FILE, entries);
      throw new SignupVerificationError(entry.attempts >= 5 ? "メール確認の有効期限が切れました。コードを再取得してください。" : "確認コードが正しくありません。", entry.attempts >= 5 ? 410 : 400, entry.attempts >= 5);
    }
    entries.splice(index, 1); writeData(FILE, entries); return email;
  });
}

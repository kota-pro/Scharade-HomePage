import crypto from "node:crypto";
import { readUsers, isAdmin } from "./auth.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import {
  normalizeSignupEmail,
  validSignupEmail,
} from "./signupVerification.ts";
import { mailTransport, CONTACT_EMAIL } from "./mail.ts";
import { securityHash } from "./mfaState.ts";
import type { DeletionInventory } from "./deletionPrivacy.ts";

const FILE = "account-deletion-requests.json",
  LOCK = "account-deletion-requests",
  WINDOW = 15 * 60_000;
export class DeletionRequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
type Challenge = {
  email: string;
  userId?: string;
  codeHash: string;
  expiresAt: number;
  delivered: boolean;
  attempts: number;
};
export type DeletionRequest = {
  id: string;
  userId: string;
  email: string;
  name: string;
  portfolioId: string | null;
  createdAt: number;
  dueAt: number;
  status: "pending" | "processing" | "complete";
  notBefore?: number;
  startedBy?: string;
  completedAt?: number;
  completedBy?: string;
  inventory?: DeletionInventory;
  mailSentAt?: number;
  mailAttempts?: number;
  mailRetryAt?: number;
  mailLease?: string;
  mailLeaseUntil?: number;
};
type Store = {
  version: 1;
  requests: DeletionRequest[];
  challenges: Record<string, Challenge>;
  limits: Record<
    string,
    { start: number; sent: number; failed: number; lastSent: number }
  >;
};
export function readDeletionRequests(): Store {
  const data = readData<Store>(FILE, {
    version: 1,
    requests: [],
    challenges: {},
    limits: {},
  });
  if (
    data.version !== 1 ||
    !Array.isArray(data.requests) ||
    !data.challenges ||
    typeof data.challenges !== "object" ||
    !data.limits ||
    typeof data.limits !== "object"
  )
    throw new Error(
      "削除申請を読み込めません。バックアップを確認してください。",
    );
  return data;
}
export function writeDeletionRequests(data: Store) {
  writeData(FILE, data);
}
export const deletionRequestView = (r: DeletionRequest) => ({
  id: r.id,
  status: r.status,
  createdAt: r.createdAt,
  dueAt: r.dueAt,
  completedAt: r.completedAt ?? null,
});
type SendCode = (email: string, code: string) => Promise<void>;
const sendCode: SendCode = async (email, code) => {
  await mailTransport().sendMail({
    from: `"写団シャレード" <${CONTACT_EMAIL}>`,
    to: email,
    subject: "【Scharade】アカウント削除申請の確認コード",
    text: `アカウント削除の申請を確認します。\n\n確認コード：${code}\n\n有効期限は10分です。このコードを入力して申請を確定するまで、アカウントは削除されません。お心当たりがなければ、このメールを破棄してください。`,
  });
};
/** Public flow also supports members whose registration has not yet been approved. */
export async function requestDeletionCode(
  input: unknown,
  send: SendCode = sendCode,
  now = Date.now(),
) {
  if (typeof input !== "string")
    throw new DeletionRequestError("メールアドレスを入力してください。");
  const email = normalizeSignupEmail(input);
  if (!validSignupEmail(email))
    throw new DeletionRequestError("メールアドレスを確認してください。");
  const token = crypto.randomBytes(32).toString("base64url"),
    code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"),
    key = securityHash(token);
  await withStoreLock("auth", () =>
    withStoreLock(LOCK, () => {
      const data = readDeletionRequests(),
        rateKey = securityHash(email);
      for (const [id, c] of Object.entries(data.challenges))
        if (c.expiresAt <= now) delete data.challenges[id];
      for (const [id, rate] of Object.entries(data.limits))
        if (rate.start + WINDOW <= now) delete data.limits[id];
      const rate = data.limits[rateKey] ?? {
        start: now,
        sent: 0,
        failed: 0,
        lastSent: 0,
      };
      if (
        rate.sent >= 5 ||
        rate.failed >= 5 ||
        (rate.lastSent && rate.lastSent + 60000 > now) ||
        Object.keys(data.challenges).length >= 2000
      )
        throw new DeletionRequestError(
          "確認の試行や送信が集中しています。しばらく待って再度お試しください。",
          429,
        );
      rate.sent++;
      rate.lastSent = now;
      data.limits[rateKey] = rate;
      const user = readUsers().find(
        (u) => u.email.trim().toLowerCase() === email,
      );
      data.challenges[key] = {
        email,
        userId: user?.id,
        codeHash: securityHash(`${token}:${code}`),
        expiresAt: now + 600000,
        delivered: false,
        attempts: 0,
      };
      writeDeletionRequests(data);
    }),
  );
  try {
    await send(email, code);
    await withStoreLock(LOCK, () => {
      const data = readDeletionRequests();
      if (data.challenges[key]) data.challenges[key].delivered = true;
      writeDeletionRequests(data);
    });
  } catch {
    await withStoreLock(LOCK, () => {
      const data = readDeletionRequests();
      delete data.challenges[key];
      writeDeletionRequests(data);
    });
    throw new DeletionRequestError(
      "確認メールを送信できませんでした。時間をおいて再度お試しください。",
      503,
    );
  }
  return { ok: true, verificationToken: token, expiresAt: now + 600000 };
}
export async function submitDeletionRequest(
  token: unknown,
  code: unknown,
  now = Date.now(),
) {
  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    typeof code !== "string"
  )
    throw new DeletionRequestError(
      "確認コードを取得してから申請してください。",
    );
  return withStoreLock("auth", () =>
    withStoreLock(LOCK, () => {
      const data = readDeletionRequests(),
        key = securityHash(token),
        challenge = data.challenges[key];
      if (
        !challenge ||
        !challenge.delivered ||
        challenge.expiresAt <= now ||
        challenge.attempts >= 5
      )
        throw new DeletionRequestError(
          "確認の有効期限が切れました。コードを再取得してください。",
          410,
        );
      const rate = data.limits[securityHash(challenge.email)];
      if (rate && rate.start + WINDOW > now && rate.failed >= 5)
        throw new DeletionRequestError(
          "確認の試行が集中しています。15分後に再度お試しください。",
          429,
        );
      const hash = securityHash(`${token}:${code}`);
      if (
        !/^\d{6}$/.test(code) ||
        !crypto.timingSafeEqual(
          Buffer.from(hash),
          Buffer.from(challenge.codeHash),
        )
      ) {
        challenge.attempts++;
        if (rate) rate.failed++;
        writeDeletionRequests(data);
        throw new DeletionRequestError("確認コードが正しくありません。");
      }
      const user = readUsers().find(
        (u) =>
          u.id === challenge.userId &&
          u.email.trim().toLowerCase() === challenge.email,
      );
      delete data.challenges[key];
      if (!user) {
        writeDeletionRequests(data);
        throw new DeletionRequestError(
          "このメールアドレスに対応するアカウントはありません。",
          404,
        );
      }
      const existing = data.requests.find(
        (r) => r.userId === user.id && r.status !== "complete",
      );
      if (existing) {
        existing.email = user.email;
        existing.name = user.name;
        existing.portfolioId = user.portfolioId ?? null;
        writeDeletionRequests(data);
        return { ok: true, request: deletionRequestView(existing) };
      }
      const request: DeletionRequest = {
        id: crypto.randomUUID(),
        userId: user.id,
        email: user.email,
        name: user.name,
        portfolioId: user.portfolioId ?? null,
        createdAt: now,
        dueAt: now + 7 * 86400000,
        status: "pending",
      };
      data.requests.push(request);
      writeDeletionRequests(data);
      return { ok: true, request: deletionRequestView(request) };
    }),
  );
}
export async function updateDeletionRequest(
  actorId: string,
  requestId: string,
  update: (request: DeletionRequest) => void,
) {
  return withStoreLock("auth", () =>
    withStoreLock(LOCK, () => {
      if (!isAdmin(readUsers().find((u) => u.id === actorId)))
        throw new DeletionRequestError("管理者権限が必要です。", 403);
      const data = readDeletionRequests(),
        request = data.requests.find((r) => r.id === requestId);
      if (!request)
        throw new DeletionRequestError("申請が見つかりません。", 404);
      update(request);
      writeDeletionRequests(data);
      return request;
    }),
  );
}

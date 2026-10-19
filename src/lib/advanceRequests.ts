import crypto from "node:crypto";
import { signedEnvelope } from "./signedEnvelope.ts";
import { env } from "./config.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import type { User } from "./auth.ts";

export type RefundDetails = {
  refundMethod?: "bank" | "paypay" | "cash";
  refundLineName?: string;
  bankName?: string;
  bankAccountName?: string;
  bankBranchName?: string;
  bankBranchCode?: string;
  bankAccountNumber?: string;
};
export type AdvanceInput = RefundDetails & {
  idempotencyKey: string;
  expenseDate: string;
  item: string;
  amount: number;
  rosterName: string;
  university: string;
  lineName: string;
  notes: string;
  receiptUrl: string;
};
export type AdvancePayload = Omit<AdvanceInput, "idempotencyKey"> & {
  requestId: string;
  submittedAt: string;
  websiteUserId: string;
  accountName: string;
  accountEmail: string;
};
export type AdvanceRequest = {
  payload: AdvancePayload;
  fingerprint: string;
  delivery: "pending" | "delivered";
  attempts: number;
  nextAttemptAt: number;
  leaseUntil?: number;
  leaseToken?: string;
  deliveredAt?: string;
  lastError?: string;
};
const FILE = "advance-requests.json";
const LOCK = "advance-requests";

export class AdvanceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function validateAdvance(value: unknown, now = new Date()): AdvanceInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdvanceError("入力形式を確認してください。");
  const raw = value as Record<string, unknown>;
  const limits = { item: 200, rosterName: 100, university: 100, lineName: 100, notes: 3000, receiptUrl: 2000 };
  const refundKeys = ["refundMethod", "refundLineName", "bankName", "bankAccountName", "bankBranchName", "bankBranchCode", "bankAccountNumber"];
  const allowed = new Set(["idempotencyKey", "expenseDate", "amount", ...Object.keys(limits), ...refundKeys]);
  if (Object.keys(raw).some(key => !allowed.has(key)))
    throw new AdvanceError("送信できない項目が含まれています。");
  if (typeof raw.idempotencyKey !== "string" || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(raw.idempotencyKey))
    throw new AdvanceError("画面を開き直して再度送信してください。");
  const date = raw.expenseDate;
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today)
    throw new AdvanceError("立替日は今日までの実在する日付を入力してください。");
  if (!Number.isSafeInteger(raw.amount) || (raw.amount as number) <= 0)
    throw new AdvanceError("金額は1円以上の整数で入力してください。");
  const text: Record<string, string> = {};
  for (const [key, max] of Object.entries(limits)) {
    const v = raw[key] ?? "";
    if (typeof v !== "string" || v.length > max || /\u0000/.test(v))
      throw new AdvanceError(`${key === "item" ? "項目名" : "入力内容"}の文字数や形式を確認してください。`);
    text[key] = v.trim();
  }
  if (!text.item || !text.rosterName) throw new AdvanceError("項目名と名簿上の氏名を入力してください。");
  if (text.receiptUrl) {
    try {
      const url = new URL(text.receiptUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch { throw new AdvanceError("領収書リンクはHTTPSのURLで入力してください。"); }
  }
  const refund: RefundDetails = {};
  // Missing fields are accepted only to reconstruct the exact fingerprint of an old retry.
  // enqueueAdvance rejects a new request without a method.
  if (refundKeys.some(key => Object.hasOwn(raw, key))) {
    if (typeof raw.refundMethod !== "string" || !["bank", "paypay", "cash"].includes(raw.refundMethod)) throw new AdvanceError("希望の返金方法を選択してください。");
    refund.refundMethod = raw.refundMethod as RefundDetails["refundMethod"];
    const requiredText = (key: string, label: string, max = 100) => {
      const v = raw[key];
      if (typeof v !== "string" || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v)) throw new AdvanceError(`${label}を正しく入力してください。`);
      return v.trim();
    };
    if (refund.refundMethod === "paypay") refund.refundLineName = requiredText("refundLineName", "PayPay連絡用のLINE名");
    if (refund.refundMethod === "bank") {
      refund.bankName = requiredText("bankName", "銀行名");
      refund.bankAccountName = requiredText("bankAccountName", "口座に登録している名前");
      refund.bankBranchName = requiredText("bankBranchName", "店名");
      const digits = (key: string, label: string, max: number) => requiredText(key, label, max).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
      refund.bankBranchCode = digits("bankBranchCode", "店番号", 3);
      refund.bankAccountNumber = digits("bankAccountNumber", "口座番号", 8);
      if (!/^\d{3}$/.test(refund.bankBranchCode)) throw new AdvanceError("店番号は3桁の数字で入力してください。");
      if (!/^\d{1,8}$/.test(refund.bankAccountNumber)) throw new AdvanceError("口座番号は8桁以内の数字で入力してください。");
    }
  }
  return { idempotencyKey: raw.idempotencyKey.toLowerCase(), expenseDate: date, amount: raw.amount as number,
    item: text.item, rosterName: text.rosterName, university: text.university, lineName: text.lineName,
    notes: text.notes, receiptUrl: text.receiptUrl, ...refund };
}

function readRequests(): AdvanceRequest[] {
  const records = readData<AdvanceRequest[]>(FILE, []);
  if (!Array.isArray(records) || records.some(r => !r?.payload?.requestId || !["pending", "delivered"].includes(r.delivery)))
    throw new Error("立替申請の保存データを確認してください。");
  return records;
}

export async function enqueueAdvance(user: User, input: AdvanceInput): Promise<AdvanceRequest> {
  if (!user.approved) throw new AdvanceError("承認済みのログインが必要です。", 403);
  const { idempotencyKey, ...fields } = input;
  const requestId = "ADV-" + crypto.createHash("sha256").update(`${user.id}:${idempotencyKey}`).digest("hex").slice(0, 32);
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(fields)).digest("hex");
  return withStoreLock(LOCK, () => {
    const records = readRequests();
    const existing = records.find(r => r.payload.requestId === requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new AdvanceError("この送信番号では既に別の内容を受け付けています。新しい申請として入力してください。", 409);
      return existing;
    }
    if (!input.refundMethod) throw new AdvanceError("希望の返金方法を選択してください。以前の画面を開いている場合は、再読み込みしてください。");
    const record: AdvanceRequest = {
      payload: { ...fields, requestId, submittedAt: new Date().toISOString(), websiteUserId: user.id, accountName: user.name, accountEmail: user.email },
      fingerprint, delivery: "pending", attempts: 0, nextAttemptAt: 0,
    };
    records.push(record);
    writeData(FILE, records);
    return record;
  });
}

/** GAS ContentService uses a GET redirect for the response, never forward the signed POST body. */
async function postToGas(url: string, body: string, timeout = 15000): Promise<Response> {
  let target = new URL(url);
  if (target.protocol !== "https:" || target.hostname !== "script.google.com" || !/^\/macros\/s\/[^/]+\/exec$/.test(target.pathname))
    throw new Error("configuration");
  const signal = AbortSignal.timeout(timeout);
  let response = await fetch(target, { method: "POST", headers: { "Content-Type": "application/json" }, body, redirect: "manual", signal });
  for (let hops = 0; [301, 302, 303, 307, 308].includes(response.status) && hops < 3; hops++) {
    if (![301, 302, 303].includes(response.status)) throw new Error("redirect");
    target = new URL(response.headers.get("location") ?? "", target);
    if (target.protocol !== "https:" || target.hostname !== "script.googleusercontent.com") throw new Error("redirect");
    response = await fetch(target, { method: "GET", redirect: "manual", signal });
  }
  return response;
}

export function advanceIntegrationConfigured() {
  return Boolean(env("ACCOUNTING_GAS_URL") && env("ACCOUNTING_WEBHOOK_SECRET").length >= 32);
}

/** Only server code can sign a request to the accounting intake. */
export async function postAccountingPayload(value: object, timeout = 15000): Promise<Response> {
  return postToGas(env("ACCOUNTING_GAS_URL"), JSON.stringify(signedEnvelope(value, env("ACCOUNTING_WEBHOOK_SECRET"))), timeout);
}

export async function deliverAdvance(requestId: string): Promise<boolean> {
  if (!advanceIntegrationConfigured()) return false;
  const token = crypto.randomUUID();
  const record = await withStoreLock(LOCK, () => {
    const records = readRequests();
    const r = records.find(r => r.payload.requestId === requestId);
    if (!r || r.delivery === "delivered" || (r.leaseUntil ?? 0) > Date.now() || r.nextAttemptAt > Date.now()) return null;
    r.leaseToken = token;
    r.leaseUntil = Date.now() + 60000;
    r.attempts++;
    writeData(FILE, records);
    return structuredClone(r);
  });
  if (!record) return readRequests().some(r => r.payload.requestId === requestId && r.delivery === "delivered");
  let error = "connection";
  let delivered = false;
  try {
    const response = await postAccountingPayload(record.payload);
    const result = await response.json().catch(() => null);
    delivered = response.ok && result?.ok === true && result?.requestId === requestId;
    error = result?.code === "UNAUTHORIZED" ? "configuration" : "upstream";
  } catch { /* Retry without logging the request, names, email or secret. */ }
  await withStoreLock(LOCK, () => {
    const records = readRequests();
    const r = records.find(r => r.payload.requestId === requestId);
    if (!r || r.leaseToken !== token) return;
    delete r.leaseToken;
    delete r.leaseUntil;
    if (delivered) {
      r.delivery = "delivered";
      r.deliveredAt = new Date().toISOString();
      delete r.lastError;
    } else {
      r.lastError = error;
      r.nextAttemptAt = Date.now() + Math.min(15 * 60000, 30000 * 2 ** Math.min(r.attempts - 1, 5));
    }
    writeData(FILE, records);
  });
  return delivered;
}

export async function drainAdvanceQueue(limit = 20) {
  const pending = readRequests().filter(r => r.delivery === "pending" && r.nextAttemptAt <= Date.now() && (r.leaseUntil ?? 0) <= Date.now()).slice(0, limit);
  let delivered = 0;
  for (const r of pending) if (await deliverAdvance(r.payload.requestId)) delivered++;
  return { attempted: pending.length, delivered };
}

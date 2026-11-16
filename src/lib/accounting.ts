import { isExecutive, actorUser } from "./auth.ts";
import { audit } from "./audit.ts";
import { AccountingError, postAccountingAdmin } from "./accountingGoogle.ts";
import { currentAccountingRoster, accountingRosterJob } from "./accountingRoster.ts";
import type { AccountingAction, AccountingData } from "./accountingTypes.ts";
export { AccountingError } from "./accountingGoogle.ts";

function actor(userId: string) {
  const user = actorUser(userId);
  if (!isExecutive(user)) throw new AccountingError("幹部以上の権限が必要です。", 403, "FORBIDDEN");
  return { id: user!.id, name: user!.name, role: user!.role };
}
function view(result: Record<string, any>): AccountingData {
  const data = result.data as AccountingData;
  if (!data || !/^[a-f0-9]{64}$/.test(data.revision) || !Array.isArray(data.members) || !Array.isArray(data.requests) || !Array.isArray(data.events)) throw new AccountingError("会計の応答を確認できませんでした。", 503, "RETRY");
  const roster = currentAccountingRoster();
  data.rosterStatus = { configured: !!roster, current: !!roster && data.sharedRoster?.fingerprint === roster.fingerprint, revision: roster?.revision || 0, title: roster?.title || "未設定", error: !!accountingRosterJob()?.error };
  // Private receipt URLs are not navigation targets in the website UI.
  data.requests = data.requests.map(({ receiptUrl, ...request }) => ({ ...request, hasReceipt: !!receiptUrl }));
  return data;
}
export async function accountingView(userId: string) {
  const result = await postAccountingAdmin({ action: "bootstrap", actor: actor(userId) });
  return { ok: true, data: view(result) };
}
const actionFields: Record<AccountingAction["action"], string[]> = {
  transaction: ["type", "date", "amount", "description", "account", "from", "to", "memberId", "advanceId", "notes"],
  review: ["requestId", "decision", "memberId", "note"], cancel: ["id", "reason"], check: ["date", "account", "actual"],
  settings: ["startDate", "bankOpening", "cashOpening", "fiscalYear", "note"], resolveRoster: ["key", "memberId"], refresh: [], recover: [],
};
export function validateAccountingAction(value: unknown): AccountingAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountingError("入力形式を確認してください。");
  const raw = value as Record<string, unknown>, action = raw.action as AccountingAction["action"];
  if (typeof action !== "string" || !Object.hasOwn(actionFields, action)) throw new AccountingError("対応していない操作です。");
  if (typeof raw.operationId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(raw.operationId) || typeof raw.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(raw.expectedRevision)) throw new AccountingError("画面を読み直して操作してください。");
  const allowed = new Set(["action", "operationId", "expectedRevision", ...actionFields[action]]);
  if (Object.keys(raw).some(k => !allowed.has(k))) throw new AccountingError("送信できない項目が含まれています。");
  const output: AccountingAction = { action, operationId: raw.operationId, expectedRevision: raw.expectedRevision };
  for (const key of actionFields[action]) {
    const input = raw[key] ?? "";
    if (["amount", "actual", "bankOpening", "cashOpening", "fiscalYear"].includes(key)) {
      if ((typeof input !== "string" && typeof input !== "number") || String(input).trim() === "" || !Number.isSafeInteger(Number(input))) throw new AccountingError("金額・年度は整数で入力してください。");
      output[key] = Number(input);
    } else {
      if (typeof input !== "string" || input.length > (["notes", "note", "reason"].includes(key) ? 3000 : 300) || /\u0000/.test(input)) throw new AccountingError("入力内容の形式や文字数を確認してください。");
      output[key] = input.trim();
    }
  }
  return output;
}
export async function accountingAction(userId: string, value: unknown) {
  const user = actor(userId), input = validateAccountingAction(value), roster = currentAccountingRoster();
  const result = await postAccountingAdmin({ ...input, actor: user, rosterFingerprint: roster?.fingerprint || "" });
  await audit(user.id, "accounting." + input.action, input.operationId).catch(() => console.error("accounting: audit unavailable"));
  return { ok: true, data: view(result), warning: typeof result.warning === "string" ? result.warning : "" };
}
export async function accountingReceipt(userId: string, requestId: string) {
  if (!/^ADV-[a-f0-9]{32}$/.test(requestId)) throw new AccountingError("領収書が見つかりません。", 404, "NOT_FOUND");
  const result = await postAccountingAdmin({ action: "receipt.read", requestId, actor: actor(userId) }, true);
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(result.mimeType) || typeof result.data !== "string" || !Number.isSafeInteger(result.size) || result.size < 1 || result.size > 10 * 1024 * 1024) throw new AccountingError("領収書の形式を確認できませんでした。", 503, "RETRY");
  const bytes = Buffer.from(result.data, "base64");
  if (bytes.length !== result.size) throw new AccountingError("領収書を取得できませんでした。", 503, "RETRY");
  await audit(userId, "accounting.receipt.read", requestId);
  return { bytes, mimeType: String(result.mimeType), name: String(result.name || "領収書").replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) };
}

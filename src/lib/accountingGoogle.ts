import { env } from "./config.ts";
import { signedEnvelope } from "./signedEnvelope.ts";

export class AccountingError extends Error {
  status: number; code: string;
  constructor(message: string, status = 400, code = "INVALID") { super(message); this.status = status; this.code = code; }
}
function target(receipt: boolean) {
  const url = new URL(env(receipt ? "ACCOUNTING_GAS_URL" : "ACCOUNTING_ADMIN_GAS_URL"));
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash || url.port || url.username || url.password) throw new Error("configuration");
  return url;
}
export function accountingConfigured() {
  try { target(false); return env("ACCOUNTING_ADMIN_WEBHOOK_SECRET").length >= 32; } catch { return false; }
}
export async function postAccountingAdmin(payload: object, receipt = false): Promise<Record<string, any>> {
  if (!accountingConfigured()) throw new AccountingError("会計連携が未設定です。管理者が接続設定を確認してください。", 503, "NOT_CONFIGURED");
  try {
    const signal = AbortSignal.timeout(30000);
    let url = target(receipt);
    let response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signedEnvelope(payload, env("ACCOUNTING_ADMIN_WEBHOOK_SECRET"))), redirect: "manual", signal });
    for (let i = 0; i < 3 && [301, 302, 303].includes(response.status); i++) {
      const next = new URL(response.headers.get("location") ?? "", url);
      if (next.protocol !== "https:" || next.hostname !== "script.googleusercontent.com" || next.port || next.username || next.password) throw new Error("redirect");
      url = next; response = await fetch(url, { redirect: "manual", signal });
    }
    if (!response.ok) throw new Error("upstream");
    const body = await response.text();
    if (body.length > (receipt ? 15_000_000 : 8_000_000)) throw new Error("size");
    const result = JSON.parse(body);
    if (!result?.ok) {
      const code = String(result?.code || "RETRY");
      const messages: Record<string, string> = {
        CONFLICT: "別の操作で内容が更新されています。最新の内容を読み直して確認してください。",
        ROSTER_PENDING: "Adminの名簿との同期・人物対応を確認してから操作してください。",
        PENDING: "中断した保存があります。「中断した保存を再確認」から結果を確認してください。",
        NOT_FOUND: "対象の記録または領収書が見つかりません。",
        NOT_CONFIGURED: "Google側の会計連携設定を確認してください。",
      };
      if (code === "INVALID") throw new AccountingError(typeof result.message === "string" ? result.message.slice(0, 300) : "入力内容を確認してください。", 400, code);
      if (["CONFLICT", "ROSTER_PENDING", "PENDING"].includes(code)) throw new AccountingError(messages[code], 409, code);
      if (code === "NOT_FOUND") throw new AccountingError(messages[code], 404, code);
      throw new AccountingError(messages[code] || "会計への接続結果を確認できません。同じ操作を再確認してください。", 503, code);
    }
    if (result.gatewayVersion !== 1 || result.envelopeVersion !== 2) throw new Error("version");
    return result;
  } catch (error) {
    if (error instanceof AccountingError) throw error;
    throw new AccountingError("会計への接続結果を確認できません。同じ操作を再確認してください。", 503, "RETRY");
  }
}

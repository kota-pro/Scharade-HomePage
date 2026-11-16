import type { APIRoute } from "astro";
import { isExecutive } from "../../../../../lib/auth.ts";
import { accountingReceipt, AccountingError } from "../../../../../lib/accounting.ts";
import { json } from "../../../../../lib/http.ts";
export const GET: APIRoute = async ({ locals, params }) => {
  if (!isExecutive(locals.user)) return json({ ok: false, message: "幹部以上の権限が必要です。" }, locals.user ? 403 : 401);
  try {
    const file = await accountingReceipt(locals.user!.id, params.requestId || "");
    return new Response(new Uint8Array(file.bytes), { headers: { "Content-Type": file.mimeType, "Content-Length": String(file.bytes.length), "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(file.name), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return json({ ok: false, message: error instanceof AccountingError ? error.message : "領収書を取得できませんでした。" }, error instanceof AccountingError ? error.status : 503); }
};

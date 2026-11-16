import type { APIRoute } from "astro";
import { isExecutive } from "../../../../lib/auth.ts";
import { accountingView, AccountingError } from "../../../../lib/accounting.ts";
import { json } from "../../../../lib/http.ts";
export const GET: APIRoute = async ({ locals }) => {
  if (!isExecutive(locals.user)) return json({ ok: false, message: "幹部以上の権限が必要です。" }, locals.user ? 403 : 401);
  try { return json(await accountingView(locals.user!.id)); }
  catch (error) { return json({ ok: false, code: error instanceof AccountingError ? error.code : "RETRY", message: error instanceof AccountingError ? error.message : "会計を読み込めませんでした。" }, error instanceof AccountingError ? error.status : 503); }
};

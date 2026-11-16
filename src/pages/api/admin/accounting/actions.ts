import type { APIRoute } from "astro";
import { isExecutive } from "../../../../lib/auth.ts";
import { accountingAction, AccountingError } from "../../../../lib/accounting.ts";
import { json } from "../../../../lib/http.ts";
export const POST: APIRoute = async ({ locals, request }) => {
  if (!isExecutive(locals.user)) return json({ ok: false, message: "幹部以上の権限が必要です。" }, locals.user ? 403 : 401);
  try { return json(await accountingAction(locals.user!.id, await request.json().catch(() => null))); }
  catch (error) { return json({ ok: false, code: error instanceof AccountingError ? error.code : "RETRY", message: error instanceof AccountingError ? error.message : "操作の結果を確認できません。同じ操作を再確認してください。" }, error instanceof AccountingError ? error.status : 503); }
};

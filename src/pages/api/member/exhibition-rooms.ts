import type { APIRoute } from "astro";
import { isStaff } from "../../../lib/auth.ts";
import { json } from "../../../lib/http.ts";
import { ExhibitionError, exhibitionErrorBody } from "../../../lib/exhibitionValidation.ts";
import { readRoomTemplates, roomTemplateAction } from "../../../lib/exhibitionRoomTemplates.ts";
export const GET: APIRoute = async ({ locals }) => {
  if (!isStaff(locals.user)) return json({ ok: false, message: "運営以上の権限が必要です。" }, locals.user ? 403 : 401);
  try { return json({ ok: true, templates: readRoomTemplates() }); }
  catch { return json({ ok: false, message: "保存済み展示室を読み込めませんでした。" }, 503); }
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!isStaff(locals.user)) return json({ ok: false, message: "運営以上の権限が必要です。" }, locals.user ? 403 : 401);
  try { return json(await roomTemplateAction(locals.user!.id, await request.json().catch(() => null))); }
  catch (error) { return json(exhibitionErrorBody(error), error instanceof ExhibitionError ? error.status : 503); }
};

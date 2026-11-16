import type { APIRoute } from "astro";
import { changeAdminView } from "../../../lib/adminViewActions.ts";
import { HttpInputError, isSameOrigin, json } from "../../../lib/http.ts";
export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return json({ ok: false, message: "このサイトの画面から操作してください。" }, 403);
  try { return json(await changeAdminView(request, await request.json())); }
  catch (error) { return json({ ok: false, message: error instanceof HttpInputError ? error.message : "表示の切り替えができませんでした。再度お試しください。" }, error instanceof HttpInputError ? error.status : 503); }
};

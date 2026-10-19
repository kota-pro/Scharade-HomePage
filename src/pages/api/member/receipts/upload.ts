import type { APIRoute } from "astro";
import { json } from "../../../../lib/http.ts";
import { AdvanceError } from "../../../../lib/advanceRequests.ts";
import { receiptFormData, uploadAdvanceReceipt } from "../../../../lib/advanceReceipts.ts";

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user?.approved) return json({ ok: false, message: "ログインが必要です。" }, 401);
  try {
    const form = await receiptFormData(request);
    if ([...form.keys()].some(key => !["uploadKey", "file"].includes(key)) || form.getAll("file").length > 1 || form.getAll("uploadKey").length !== 1) throw new AdvanceError("添付内容を確認してください。");
    const key = form.get("uploadKey"), file = form.get("file");
    if (typeof key !== "string" || (file !== null && !(file instanceof File))) throw new AdvanceError("ファイルを選んでください。");
    return json({ ok: true, receipt: await uploadAdvanceReceipt(locals.user, key, file || undefined) });
  } catch (error) {
    if (error instanceof AdvanceError) return json({ ok: false, message: error.message }, error.status);
    return json({ ok: false, message: "領収書を保存できませんでした。同じ内容でもう一度送信してください。" }, 503);
  }
};

import type { APIRoute } from "astro";
import { json } from "../../../lib/http.ts";
import { AdvanceError, validateAdvance, enqueueAdvance, deliverAdvance, advanceIntegrationConfigured } from "../../../lib/advanceRequests.ts";

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user?.approved) return json({ ok: false, message: "ログインが必要です。" }, 401);
  try {
    const input = validateAdvance(await request.json().catch(() => null));
    if (!advanceIntegrationConfigured()) return json({ ok: false, message: "立替申請の受付準備中です。会計担当者へお問い合わせください。" }, 503);
    const record = await enqueueAdvance(locals.user, input);
    const delivered = record.delivery === "delivered" || await deliverAdvance(record.payload.requestId);
    return json({ ok: true, requestId: record.payload.requestId, delivery: delivered ? "delivered" : "pending",
      message: delivered ? "立替申請を登録しました。会計担当者の確認をお待ちください。" : "申請を受け付けました。会計への送信を待っています。再申請は不要です。" }, delivered ? 201 : 202);
  } catch (error) {
    if (error instanceof AdvanceError) return json({ ok: false, message: error.message }, error.status);
    return json({ ok: false, message: "受付結果を確認できませんでした。入力を保持したまま、もう一度送信してください。" }, 503);
  }
};

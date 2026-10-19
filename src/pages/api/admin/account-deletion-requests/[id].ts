import type { APIRoute } from "astro";
import { json } from "../../../../lib/http.ts";
import { isAdmin } from "../../../../lib/auth.ts";
import {
  startDeletionProcessing,
  completeDeletionProcessing,
} from "../../../../lib/accountDeletionProcessing.ts";
import { DeletionRequestError } from "../../../../lib/accountDeletionRequests.ts";
import { AccountUpdateError } from "../../../../lib/accountManagement.ts";
export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!isAdmin(locals.user))
    return json({ ok: false, message: "管理者権限が必要です。" }, 403);
  const data = await request.json().catch(() => null);
  try {
    if (
      !params.id ||
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).some(
        (k) => !["action", "confirmationEmail", "checks"].includes(k),
      )
    )
      return json({ ok: false, message: "操作を確認してください。" }, 400);
    if (data.action === "start") {
      await startDeletionProcessing(locals.user!.id, params.id);
      return json({ ok: true });
    }
    if (data.action === "complete")
      return json(
        await completeDeletionProcessing(locals.user!.id, params.id, {
          confirmationEmail: data.confirmationEmail,
          checks: data.checks,
        }),
      );
    return json({ ok: false }, 400);
  } catch (error) {
    const expected =
      error instanceof DeletionRequestError ||
      error instanceof AccountUpdateError;
    return json(
      {
        ok: false,
        message: expected
          ? error.message
          : "処理を完了できませんでした。再読み込みして再試行してください。",
      },
      expected ? error.status : 503,
    );
  }
};

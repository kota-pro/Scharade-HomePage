import type { APIRoute } from "astro";
import { json } from "../../lib/http.ts";
import {
  requestDeletionCode,
  submitDeletionRequest,
  DeletionRequestError,
} from "../../lib/accountDeletionRequests.ts";
export const POST: APIRoute = async ({ request }) => {
  const data = await request.json().catch(() => null);
  try {
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).some(
        (k) => !["action", "email", "verificationToken", "code"].includes(k),
      )
    )
      return json({ ok: false, message: "入力内容を確認してください。" }, 400);
    if (data.action === "request-code")
      return json(await requestDeletionCode(data.email));
    if (data.action === "submit")
      return json(
        await submitDeletionRequest(data.verificationToken, data.code),
      );
    return json({ ok: false, message: "操作を確認してください。" }, 400);
  } catch (error) {
    return json(
      {
        ok: false,
        message:
          error instanceof DeletionRequestError
            ? error.message
            : "申請を保存できませんでした。時間をおいて再度お試しください。",
      },
      error instanceof DeletionRequestError ? error.status : 503,
    );
  }
};

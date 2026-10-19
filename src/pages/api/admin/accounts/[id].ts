import type { APIRoute } from "astro";
import { isAdmin } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/http.ts";
import { deleteAccount } from "../../../../lib/accountDeletion.ts";
import {
  updateAccountRegistration,
  AccountUpdateError,
} from "../../../../lib/accountManagement.ts";

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!isAdmin(locals.user))
    return json({ ok: false, message: "管理者権限が必要です。" }, 403);
  if (!params.id || params.id.length > 128) return json({ ok: false }, 404);
  const data: unknown = await request.json().catch(() => null);
  try {
    const result = await updateAccountRegistration(
      locals.user!.id,
      params.id,
      data,
    );
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AccountUpdateError)
      return json({ ok: false, message: error.message }, error.status);
    console.error("[admin/accounts] registration update failed");
    return json(
      {
        ok: false,
        message: "保存できませんでした。時間をおいて再度お試しください。",
      },
      503,
    );
  }
};

export const DELETE: APIRoute = async ({ locals, params, request }) => {
  if (!isAdmin(locals.user))
    return json({ ok: false, message: "管理者権限が必要です。" }, 403);
  if (!params.id || params.id.length > 128) return json({ ok: false }, 404);
  const data: unknown = await request.json().catch(() => null);
  try {
    await deleteAccount(locals.user!.id, params.id, data);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof AccountUpdateError)
      return json({ ok: false, message: error.message }, error.status);
    console.error("[admin/accounts] deletion failed");
    return json(
      {
        ok: false,
        message: "削除を完了できませんでした。時間をおいて再試行してください。",
      },
      503,
    );
  }
};

import type { APIRoute } from "astro";
import { isExecutive } from "../../../lib/auth.ts";
import {
  clubFormAction,
  clubFormsView,
  ClubFormsError,
} from "../../../lib/clubForms.ts";
import { json } from "../../../lib/http.ts";

export const GET: APIRoute = ({ locals }) => {
  if (!isExecutive(locals.user))
    return json(
      { ok: false, message: "幹部以上の権限が必要です。" },
      locals.user ? 403 : 401,
    );
  try {
    return json(clubFormsView(locals.user!.id));
  } catch (error) {
    return json(
      {
        ok: false,
        message:
          error instanceof ClubFormsError
            ? error.message
            : "フォームを読み込めませんでした。",
      },
      error instanceof ClubFormsError ? error.status : 503,
    );
  }
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!isExecutive(locals.user))
    return json(
      { ok: false, message: "幹部以上の権限が必要です。" },
      locals.user ? 403 : 401,
    );
  try {
    return json(
      await clubFormAction(
        locals.user!.id,
        await request.json().catch(() => null),
      ),
    );
  } catch (error) {
    return json(
      {
        ok: false,
        message:
          error instanceof ClubFormsError
            ? error.message
            : "Googleとの連携を完了できませんでした。設定・接続を確認してください。",
      },
      error instanceof ClubFormsError ? error.status : 503,
    );
  }
};

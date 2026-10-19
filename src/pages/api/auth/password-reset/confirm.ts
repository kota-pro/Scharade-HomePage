import type { APIRoute } from "astro";
import {
  findPasswordResetToken,
  resetPassword,
} from "../../../../lib/passwordReset.ts";
import { json } from "../../../../lib/http.ts";
import { validNewPassword } from "../../../../lib/passwords.ts";
import { PASSWORD_POLICY_ERROR } from "../../../../lib/passwordPolicy.ts";

export const GET: APIRoute = async ({ url }) => {
  const valid = Boolean(
    findPasswordResetToken(url.searchParams.get("token") ?? ""),
  );
  return json({ valid }, valid ? 200 : 410);
};
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");
  if (!validNewPassword(password))
    return json(
      { ok: false, message: `${PASSWORD_POLICY_ERROR} 再設定が必要な場合は以前と異なるパスワードを選んでください。` },
      400,
    );
  if (password !== body?.passwordConfirm)
    return json({ ok: false, message: "パスワードが一致しません。" }, 400);
  if (!token || !(await resetPassword(token, password)))
    return json(
      { ok: false, message: "リンクは無効、使用済み、または期限切れです。" },
      410,
    );
  return json({
    ok: true,
    message:
      "パスワードを変更しました。新しいパスワードでログインしてください。",
  });
};

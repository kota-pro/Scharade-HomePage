import type { APIRoute } from "astro";
import {
  readSessions,
  readUsers,
  writeSessions,
  writeUsers,
} from "../../../../lib/auth";
import {
  consumePasswordResetToken,
  findPasswordResetToken,
  hashPassword,
} from "../../../../lib/passwordReset";

function json(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get("token") ?? "";
  const entry = findPasswordResetToken(token);
  return json(entry ? 200 : 410, { valid: Boolean(entry) });
};

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as any;
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");
  const passwordConfirm = String(body?.passwordConfirm ?? "");

  if (!token) {
    return json(400, { ok: false, message: "再設定用トークンがありません。" });
  }
  if (password.length < 8) {
    return json(400, {
      ok: false,
      message: "パスワードは8文字以上で入力してください。",
    });
  }
  if (password !== passwordConfirm) {
    return json(400, { ok: false, message: "パスワードが一致しません。" });
  }

  const entry = findPasswordResetToken(token);
  if (!entry) {
    return json(410, {
      ok: false,
      message: "この再設定リンクは無効、使用済み、または期限切れです。",
    });
  }

  const users = readUsers();
  const user = users.find((candidate) => candidate.id === entry.userId);
  if (!user) {
    return json(410, {
      ok: false,
      message: "この再設定リンクは無効、使用済み、または期限切れです。",
    });
  }

  user.passwordHash = hashPassword(password);
  user.providers.credentials = true;
  writeUsers(users);

  // Changing a password signs the account out on every device.
  writeSessions(readSessions().filter((session) => session.userId !== user.id));
  consumePasswordResetToken(token);

  return json(200, {
    ok: true,
    message:
      "パスワードを変更しました。新しいパスワードでログインしてください。",
  });
};

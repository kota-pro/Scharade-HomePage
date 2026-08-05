import type { APIRoute } from "astro";
import nodemailer from "nodemailer";
import { readUsers } from "../../../../lib/auth";
import {
  createPasswordResetToken,
  revokePasswordResetToken,
} from "../../../../lib/passwordReset";

const CONTACT_EMAIL = "contact@scharade.jp";
const SENT_MESSAGE = "パスワード再設定用メールを送信しました。";

function json(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async ({ request, url }) => {
  const contentType = request.headers.get("content-type") ?? "";
  let email = "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as any;
    email = String(body?.email ?? "");
  } else {
    const form = await request.formData();
    email = String(form.get("email") ?? "");
  }

  email = email.trim().toLowerCase();
  if (!email) {
    return json(400, {
      ok: false,
      message: "メールアドレスを入力してください。",
    });
  }

  const user = readUsers().find(
    (candidate) => candidate.email.trim().toLowerCase() === email,
  );

  if (!user?.passwordHash) {
    return json(404, {
      ok: false,
      message: "入力されたメールアドレスは登録されていません。",
    });
  }

  const gmailPass =
    (import.meta as any).env?.GMAIL_PASS ?? process.env.GMAIL_PASS;
  if (!gmailPass) {
    console.error("[auth/password-reset] GMAIL_PASS is not configured");
    return json(503, {
      ok: false,
      message: "現在メールを送信できません。時間をおいて再度お試しください。",
    });
  }

  const token = createPasswordResetToken(user.id);
  const resetUrl = new URL("/ResetPassword", url.origin);
  resetUrl.searchParams.set("token", token);

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      port: 587,
      secure: false,
      auth: { user: CONTACT_EMAIL, pass: gmailPass },
    });

    await transporter.sendMail({
      from: `"写団シャレード" <${CONTACT_EMAIL}>`,
      to: user.email,
      subject: "【写団シャレード】パスワード再設定のご案内",
      text: `${user.name} 様\n\nパスワードの再設定を受け付けました。\n以下のURLを開き、新しいパスワードを設定してください。\n\n${resetUrl.toString()}\n\nこのURLの有効期限は1時間で、一度だけ使用できます。\nお心当たりがない場合は、このメールを破棄してください。\n\n※このメールはシステムからの自動送信です。`,
    });
  } catch (error) {
    console.error("[auth/password-reset] failed to send reset mail", error);
    revokePasswordResetToken(token);
    return json(503, {
      ok: false,
      message: "現在メールを送信できません。時間をおいて再度お試しください。",
    });
  }

  return json(200, { ok: true, message: SENT_MESSAGE });
};

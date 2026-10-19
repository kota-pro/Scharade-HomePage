import type { APIRoute } from "astro";
import { mailTransport } from "../../../../lib/mail.ts";
import { env, siteOrigin } from "../../../../lib/config.ts";
import { readUsers } from "../../../../lib/auth.ts";
import { checkPasswordResetRequest } from "../../../../lib/rateLimit.ts";
import {
  createPasswordResetToken,
  revokePasswordResetToken,
  ResetAccountChangedError,
} from "../../../../lib/passwordReset.ts";

const CONTACT_EMAIL = "contact@scharade.jp";
const SENT_MESSAGE =
  "登録情報を確認し、再設定が可能な場合はご案内メールを送信します。";

function json(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async ({ request }) => {
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
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, {
      ok: false,
      message: "有効なメールアドレスを入力してください。",
    });
  }

  // Configuration failures are identical for known and unknown addresses.
  if (!env("GMAIL_PASS")) {
    console.error("[auth/password-reset] GMAIL_PASS is not configured");
    return json(503, {
      ok: false,
      message: "現在メールを送信できません。時間をおいて再度お試しください。",
    });
  }

  // Mail delivery runs in the persistent Node process. Its success, failure,
  // and SMTP latency must not reveal whether an address belongs to a member.
  const responseDelay = new Promise<void>(resolve => setTimeout(resolve, 600));
  const deliver = async () => {
    if (!await checkPasswordResetRequest(email)) return;
    const user = readUsers().find(candidate => candidate.email.trim().toLowerCase() === email);
    if (!user?.passwordHash) return;
    let token: string;
    try { token = await createPasswordResetToken(user.id, user.email); }
    catch (error) {
      if (!(error instanceof ResetAccountChangedError)) console.error("[auth/password-reset] token creation failed");
      return;
    }
    const resetUrl = new URL("/ResetPassword", siteOrigin(request));
    resetUrl.searchParams.set("token", token);
    try {
      await mailTransport().sendMail({
      from: `"写団シャレード" <${CONTACT_EMAIL}>`,
      to: user.email,
      subject: "【写団シャレード】パスワード再設定のご案内",
      text: `${user.name} 様\n\nパスワードの再設定を受け付けました。\n以下のURLを開き、新しいパスワードを設定してください。\n\n${resetUrl.toString()}\n\nこのURLの有効期限は1時間で、一度だけ使用できます。\nお心当たりがない場合は、このメールを破棄してください。\n\n※このメールはシステムからの自動送信です。`,
      });
    } catch {
      console.error("[auth/password-reset] failed to send reset mail");
      await revokePasswordResetToken(token);
    }
  };
  // A bounded SMTP timeout is configured in mailTransport; no raw error or
  // address is logged. Work may finish after the uniform HTTP response.
  void deliver().catch(() => console.error("[auth/password-reset] delivery cleanup failed"));
  await responseDelay;
  return json(200, { ok: true, message: SENT_MESSAGE });
};

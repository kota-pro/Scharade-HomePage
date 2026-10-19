import type { APIRoute } from "astro";
import { validateContact } from "../../lib/contact.ts";
import { json } from "../../lib/http.ts";
import { mailTransport, CONTACT_EMAIL } from "../../lib/mail.ts";
export const POST: APIRoute = async ({ request }) => {
  let data;
  try {
    data = validateContact(await request.json());
  } catch (error) {
    return json(
      {
        message:
          error instanceof Error ? error.message : "入力を確認してください。",
      },
      400,
    );
  }
  const {
    name,
    furigana,
    institution,
    faculty,
    grade,
    email,
    inquiry,
    message,
  } = data;
  const text = `お名前: ${name}（${furigana}）\n所属: ${institution} ${faculty} ${grade}\nメール: ${email}\n項目: ${inquiry}\n\n${message}`;
  let transport;
  try {
    transport = mailTransport();
    await transport.sendMail({
      from: `"写団シャレード フォーム" <${CONTACT_EMAIL}>`,
      to: CONTACT_EMAIL,
      replyTo: email,
      subject: `【HPお問い合わせ】${name}様より`,
      text,
    });
  } catch {
    console.error("[contact] Delivery to contact mailbox failed");
    return json(
      { message: "現在送信できません。時間をおいて再度お試しください。" },
      503,
    );
  }
  // A failed acknowledgement must not tell visitors to resend an accepted inquiry.
  try {
    await transport.sendMail({
      from: `"写団シャレード" <${CONTACT_EMAIL}>`,
      to: email,
      subject: "お問い合わせを受け付けました",
      text: `${name} 様\n\nお問い合わせありがとうございます。確認後にご連絡します。\n\n${text}\n\n※自動返信です。`,
    });
  } catch {
    console.error("[contact] Acknowledgement failed; inquiry already accepted");
  }
  return json({
    message: "お問い合わせを受け付けました。確認後にご連絡します。",
  });
};

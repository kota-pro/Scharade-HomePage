import type { APIRoute } from "astro";
import nodemailer from "nodemailer";

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const { name, furigana, institution, email, inquiry, message } = data;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      port: 587,
      secure: false,
      auth: {
        user: "iamuyoha@gmail.com",
        pass: import.meta.env.GMAIL_PASS,
      },
    });
    const mailContent = `
--------------------------------------------------
【お問い合わせ内容】
お名前: ${name} (${furigana}) 様
所属: ${institution}
メールアドレス: ${email}
項目: ${inquiry}
詳細：${message || "（入力なし）"}
--------------------------------------------------
    `.trim();

    await transporter.sendMail({
      from: `"写団シャレード フォーム" <contact@scharade.jp>`,
      to: "contact@scharade.jp",
      subject: `【HPお問い合わせ】${name}様より`,
      text: mailContent,
    });

    await transporter.sendMail({
      from: `"写団シャレード" <contact@scharade.jp>`,
      to: email,
      subject: "お問い合わせありがとうございました",
      text: `${name} 様

お問い合わせありがとうございました。
以下の内容で承りました。内容を確認し、折り返しご連絡いたします。

${mailContent}

※このメールはシステムからの自動返信です。`,
    });

    return new Response(JSON.stringify({ message: "送信成功" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ message: "送信失敗" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

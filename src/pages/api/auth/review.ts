import type { APIRoute } from "astro";
import { readUsers, writeUsers } from "../../../lib/auth";
import {
  type ReviewAction,
  verifyReviewSignature,
} from "../../../lib/signupReview";

function html(status: number, title: string, body: string) {
  return new Response(
    `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        font-family: sans-serif;
        background: #f8f8f8;
        color: #111;
      }
      .card {
        max-width: 720px;
        margin: 40px auto;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
      }
      h1 {
        margin-top: 0;
        font-size: 28px;
      }
      p {
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${body}</p>
    </div>
  </body>
</html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );
}

function parseAction(raw: string | null): ReviewAction | null {
  if (raw === "approve" || raw === "reject") return raw;
  return null;
}

export const GET: APIRoute = async ({ url }) => {
  const action = parseAction(url.searchParams.get("action"));
  const userId = url.searchParams.get("userId");
  const expires = url.searchParams.get("expires");
  const signature = url.searchParams.get("sig");

  if (!action || !userId || !expires || !signature) {
    return html(400, "Invalid Request", "必要なパラメータが不足しています。");
  }

  const expiryTime = new Date(expires).getTime();
  if (!Number.isFinite(expiryTime) || expiryTime < Date.now()) {
    return html(410, "Link Expired", "この承認リンクは期限切れです。");
  }

  const verified = verifyReviewSignature({
    action,
    expires,
    signature,
    userId,
  });
  if (!verified) {
    return html(403, "Invalid Signature", "署名の検証に失敗しました。");
  }

  const users = readUsers();
  const user = users.find((entry) => entry.id === userId);
  if (!user) {
    return html(404, "User Not Found", "対象のアカウントが見つかりません。");
  }

  user.approved = action === "approve";
  writeUsers(users);

  return html(
    200,
    action === "approve" ? "Approved" : "Rejected",
    action === "approve"
      ? `${user.name} (${user.email}) を承認しました。`
      : `${user.name} (${user.email}) を非承認にしました。`,
  );
};

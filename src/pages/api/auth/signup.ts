import type { APIRoute } from "astro";
import crypto from "node:crypto";
import { mailTransport } from "../../../lib/mail.ts";
import {
  assertReviewConfig,
  createReviewSignature,
} from "../../../lib/signupReview.ts";

import { readUsers, updateUsers } from "../../../lib/auth.ts";
import { hashPasswordAsync, validNewPassword } from "../../../lib/passwords.ts";
import { PASSWORD_POLICY_ERROR } from "../../../lib/passwordPolicy.ts";
import { fetchWithTimeout } from "../../../lib/http.ts";
import { env, siteOrigin } from "../../../lib/config.ts";
import { withStoreLock } from "../../../lib/store.ts";
import { requestSignupCode, confirmSignupEmail, normalizeSignupEmail, validSignupEmail, SignupVerificationError } from "../../../lib/signupVerification.ts";
import { audit } from "../../../lib/audit.ts";
const CONTACT_EMAIL = "contact@scharade.jp";

function normalizeEmail(email: string) {
  return normalizeSignupEmail(email);
}

function json(status: number, data: any) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

async function sendSignupReviewMail(input: {
  createdAt: string;
  email: string;
  name: string;
  portfolioId: string;
  portfolioName: string;
  request: Request;
  userId: string;
}) {
  assertReviewConfig();

  const transporter = mailTransport();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const origin = siteOrigin(input.request);

  const makeReviewUrl = (action: "approve" | "reject") => {
    const params = new URLSearchParams({
      action,
      expires,
      userId: input.userId,
    });
    params.set(
      "sig",
      createReviewSignature({
        action,
        expires,
        userId: input.userId,
      }),
    );
    return `${origin}/api/auth/review?${params.toString()}`;
  };

  const mailContent = `
新しいアカウント申請がありました。

Name: ${input.name}
Portfolio Name: ${input.portfolioName}
Email: ${input.email}
Portfolio ID: ${input.portfolioId}
Created At: ${input.createdAt}

Approve:
${makeReviewUrl("approve")}

Reject:
${makeReviewUrl("reject")}
  `.trim();

  await transporter.sendMail({
    from: `"写団シャレード アカウント申請" <${CONTACT_EMAIL}>`,
    to: CONTACT_EMAIL,
    subject: `【アカウント申請】${input.name} / ${input.portfolioName}`,
    text: mailContent,
  });
}

async function createPortfolioInMicroCMS(
  portfolioName: string,
): Promise<string> {
  const SERVICE_DOMAIN = env("MICROCMS_SERVICE_DOMAIN"), API_KEY = env("MICROCMS_SERVER_API_KEY"), PORTFOLIO_ENDPOINT = env("MICROCMS_PORTFOLIO_ENDPOINT") || "portfolio";
  if (!SERVICE_DOMAIN || !API_KEY) {
    const missing = [
      !SERVICE_DOMAIN ? "MICROCMS_SERVICE_DOMAIN" : null,
      !API_KEY ? "MICROCMS_SERVER_API_KEY" : null,
    ].filter(Boolean);
    throw new Error(
      `microCMS is not configured. Missing: ${missing.join(", ")}`,
    );
  }

  const url = `https://${SERVICE_DOMAIN}.microcms.io/api/v1/${PORTFOLIO_ENDPOINT}`;

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-MICROCMS-API-KEY": API_KEY,
    },
    body: JSON.stringify({
      name: portfolioName,
      hashtags: [],
      pictures: [],
      self_introduction: "",
      instagram: "",
      x_url: "",
      camera: "",
    }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `microCMS error (${res.status}): ${text || res.statusText}`,
    );
  }

  const data = JSON.parse(text || "{}");
  const id = (data as any).id;
  if (!id || typeof id !== "string") {
    throw new Error("microCMS did not return an id.");
  }
  return id;
}

async function removeUnlinkedPortfolio(id: string) {
  // This ID was created by this request. Never remove a Portfolio now linked to an account.
  if (readUsers().some(user => user.portfolioId === id)) return;
  const domain = env("MICROCMS_SERVICE_DOMAIN"), key = env("MICROCMS_SERVER_API_KEY"), endpoint = env("MICROCMS_PORTFOLIO_ENDPOINT") || "portfolio";
  const response = await fetchWithTimeout(`https://${domain}.microcms.io/api/v1/${endpoint}/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "X-MICROCMS-API-KEY": key } });
  if (!response.ok && response.status !== 404) throw new Error("Signup cleanup failed");
}

export const POST: APIRoute = async ({ request }) => {
  let name = "";
  let portfolioName = "";
  let email = "";
  let password = "";
  let passwordConfirm = "";
  let action = "complete", verificationToken = "", code = "";

  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as any;
    name = String(body?.name ?? "");
    portfolioName = String(body?.portfolioName ?? "");
    email = String(body?.email ?? "");
    password = String(body?.password ?? "");
    passwordConfirm = String(body?.passwordConfirm ?? "");
    action = String(body?.action ?? "complete"); verificationToken = String(body?.verificationToken ?? ""); code = String(body?.code ?? "");
  } else {
    const form = await request.formData();
    name = String(form.get("name") ?? "");
    portfolioName = String(form.get("portfolioName") ?? "");
    email = String(form.get("email") ?? "");
    password = String(form.get("password") ?? "");
    passwordConfirm = String(form.get("passwordConfirm") ?? "");
    action = String(form.get("action") ?? "complete"); verificationToken = String(form.get("verificationToken") ?? ""); code = String(form.get("code") ?? "");
  }

  name = name.trim();
  portfolioName = portfolioName.trim();
  email = normalizeEmail(email);

  if (action === "request-code") {
    try {
      const verification = await requestSignupCode(email);
      return json(200, { ok: true, verificationRequired: true, ...verification, message: "入力したメールアドレスに届く確認コードを入力してください。" });
    } catch (error) {
      if (error instanceof SignupVerificationError) return json(error.status, { ok: false, message: error.message });
      console.error("[auth/signup] confirmation request failed");
      return json(503, { ok: false, message: "メール確認を準備できませんでした。時間をおいて再度お試しください。" });
    }
  }
  if (action !== "complete") return json(400, { ok: false, message: "登録の操作を確認してください。" });

  if (!name || name.length > 80)
    return json(400, {
      ok: false,
      message: "名前は80文字以内で入力してください。",
    });

  if (!portfolioName) {
    return json(400, { ok: false, message: "Portfolio name is required." });
  }
  if (portfolioName.length > 50) {
    return json(400, {
      ok: false,
      message: "Portfolio name is too long (max 50).",
    });
  }

  if (!validSignupEmail(email))
    return json(400, {
      ok: false,
      message: "メールアドレスを確認してください。",
    });
  if (!validNewPassword(password)) {
    return json(400, {
      ok: false,
      message: PASSWORD_POLICY_ERROR,
    });
  }
  if (password !== passwordConfirm) {
    return json(400, { ok: false, message: "Passwords do not match." });
  }

  try {
    await confirmSignupEmail(verificationToken, email, code);
  } catch (error) {
    if (error instanceof SignupVerificationError) return json(error.status, { ok: false, message: error.message, verificationRequired: error.restart });
    console.error("[auth/signup] confirmation failed");
    return json(503, { ok: false, message: "メール確認ができませんでした。コードを再取得してください。", verificationRequired: true });
  }

  let provisioned: { response: Response } | { createdAt: string; userId: string; portfolioId: string };
  try {
    const emailKey = crypto.createHash("sha256").update(email).digest("hex");
    provisioned = await withStoreLock(`signup-provision-${emailKey}`, async () => {
      if (readUsers().some(user => normalizeEmail(user.email) === email)) return { response: json(409, { ok: false, message: "このメールアドレスは登録済みです。ログイン、またはパスワードの再設定をご利用ください。", verificationRequired: true }) };
      const passwordHash = await hashPasswordAsync(password), createdAt = new Date().toISOString(), userId = crypto.randomUUID();
      let portfolioId: string;
      try { portfolioId = await createPortfolioInMicroCMS(portfolioName); }
      catch { return { response: json(502, { ok: false, message: "Portfolioを準備できませんでした。時間をおいて確認コードを再取得し、お試しください。", verificationRequired: true }) }; }
      try {
        await updateUsers(current => {
          if (current.some(user => normalizeEmail(user.email) === email)) throw new Error("duplicate");
          current.push({ id: userId, name, portfolioName, email, passwordHash, role: "member", approved: false, createdAt, providers: { credentials: true }, portfolioId });
        });
      } catch {
        try { await removeUnlinkedPortfolio(portfolioId); } catch { console.error("[auth/signup] unlinked Portfolio cleanup failed"); }
        return { response: json(503, { ok: false, message: "アカウントを保存できませんでした。確認コードを再取得してお試しください。", verificationRequired: true }) };
      }
      return { createdAt, userId, portfolioId };
    });
  } catch {
    console.error("[auth/signup] provisioning failed");
    return json(503, { ok: false, message: "登録が混み合っています。時間をおいて確認コードを再取得し、お試しください。", verificationRequired: true });
  }
  if ("response" in provisioned) return provisioned.response;
  const { createdAt, userId, portfolioId } = provisioned;
  try { await audit(userId, "auth.signup.email-confirmed", userId); } catch { console.error("[auth/signup] audit failed after saving"); }

  try {
    await sendSignupReviewMail({
      createdAt,
      email,
      name,
      portfolioId,
      portfolioName,
      request,
      userId,
    });
  } catch (err: any) {
    console.error("[auth/signup] failed to send review mail");
    return json(200, {
      ok: true,
      message:
        "申請を保存しましたが管理者への通知に失敗しました。お問い合わせから承認をご依頼ください。",
      warning: "admin_notification_failed",
    });
  }

  return json(200, {
    ok: true,
    message: "Account created and pending approval.",
  });
};

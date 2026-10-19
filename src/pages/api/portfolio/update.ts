import type { APIRoute } from "astro";
import {
  getUserFromRequest,
  isAdmin,
  canEditPortfolio,
} from "../../../lib/auth.ts";
import { canonicalizePortfolioGrade } from "../../../lib/microcms.ts";
import { json, fetchWithTimeout } from "../../../lib/http.ts";
import { env } from "../../../lib/config.ts";
import { invalidateCache } from "../../../lib/cache.ts";
import { audit } from "../../../lib/audit.ts";
import { safeMediaUrl } from "../../../lib/contentSecurity.ts";

export const POST: APIRoute = async ({ request }) => {
  const { user } = getUserFromRequest(request);
  if (!user) return json({ ok: false, message: "ログインが必要です。" }, 401);
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return json({ ok: false, message: "入力形式が正しくありません。" }, 400);
  const target =
    typeof payload.portfolioId === "string"
      ? payload.portfolioId
      : user.portfolioId;
  if (!target || !canEditPortfolio(user, target))
    return json(
      { ok: false, message: "このPortfolioを編集する権限がありません。" },
      403,
    );
  const administrative = ["generation", "role", "isExecutive", "displayOrder"];
  if (!isAdmin(user) && administrative.some((k) => Object.hasOwn(payload, k)))
    return json(
      { ok: false, message: "管理者だけが変更できる項目です。" },
      403,
    );
  const body: Record<string, unknown> = {};
  for (const [key, max] of Object.entries({
    name: 80,
    self_introduction: 5000,
    instagram: 300,
    x_url: 1000,
    camera: 500,
  })) {
    if (Object.hasOwn(payload, key)) {
      if (
        typeof payload[key] !== "string" ||
        payload[key].length > max ||
        (key === "name" && !payload[key].trim())
      )
        return json(
          { ok: false, message: `${key}の入力を確認してください。` },
          400,
        );
      body[key] = payload[key].trim();
    }
  }
  const validMedia = (value: unknown) => !!safeMediaUrl(value);
  if ("iconUrl" in payload) {
    if (payload.iconUrl !== "" && !validMedia(payload.iconUrl))
      return json(
        { ok: false, message: "アイコン画像を確認してください。" },
        400,
      );
    body.icon = payload.iconUrl;
  }
  if ("pictures" in payload) {
    if (
      !Array.isArray(payload.pictures) ||
      payload.pictures.length > 500 ||
      payload.pictures.some((p: unknown) => !validMedia(p))
    )
      return json(
        {
          ok: false,
          message: "写真はアップロードした画像を500枚以内で指定してください。",
        },
        400,
      );
    body.pictures = payload.pictures;
  }
  if ("hashtags" in payload) {
    if (
      !Array.isArray(payload.hashtags) ||
      payload.hashtags.length > 30 ||
      payload.hashtags.some(
        (v: unknown) => typeof v !== "string" || v.length > 50,
      )
    )
      return json({ ok: false, message: "タグを確認してください。" }, 400);
    body.hashtags = payload.hashtags
      .map((v: string) => v.trim())
      .filter(Boolean);
  }
  if (body.x_url) {
    try {
      if (new URL(String(body.x_url)).protocol !== "https:") throw new Error();
    } catch {
      return json(
        { ok: false, message: "SNSリンクはHTTPSのURLで入力してください。" },
        400,
      );
    }
  }
  const gradeField = env("MICROCMS_PORTFOLIO_GRADE_FIELD") || "grade";
  const grade =
    typeof payload.grade === "string"
      ? canonicalizePortfolioGrade(payload.grade)
      : "";
  if (Object.hasOwn(payload, "grade")) {
    if (typeof payload.grade !== "string" || payload.grade.length > 80)
      return json(
        { ok: false, message: "学年の入力を確認してください。" },
        400,
      );
    body[gradeField] = grade;
  }
  if (isAdmin(user)) {
    for (const key of ["generation", "displayOrder"])
      if (key in payload) {
        if (payload[key] === null || payload[key] === "") body[key] = null;
        else if (
          !Number.isInteger(payload[key]) ||
          payload[key] < 0 ||
          payload[key] > 100000
        )
          return json(
            {
              ok: false,
              message: "期・表示順は0以上の整数で入力してください。",
            },
            400,
          );
        else body[key] = payload[key];
      }
    if ("role" in payload) {
      if (typeof payload.role !== "string" || payload.role.length > 100)
        return json({ ok: false, message: "役職を確認してください。" }, 400);
      body.role = payload.role.trim();
    }
    if ("isExecutive" in payload) {
      if (typeof payload.isExecutive !== "boolean")
        return json({ ok: false }, 400);
      body.isExecutive = payload.isExecutive;
    }
  }
  if (!Object.keys(body).length)
    return json({ ok: false, message: "更新内容がありません。" }, 400);
  const domain = env("MICROCMS_SERVICE_DOMAIN"),
    key = env("MICROCMS_SERVER_API_KEY"),
    endpoint = env("MICROCMS_PORTFOLIO_ENDPOINT") || "portfolio";
  if (!domain || !key)
    return json(
      {
        ok: false,
        message: "現在更新を利用できません。管理者にお問い合わせください。",
      },
      503,
    );
  const url = `https://${domain}.microcms.io/api/v1/${endpoint}/${encodeURIComponent(target)}`;
  try {
    const patch = (content: Record<string, unknown>) =>
      fetchWithTimeout(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-MICROCMS-API-KEY": key,
        },
        body: JSON.stringify(content),
      });
    let response = await patch(body);
    let upstreamError = "";
    if (response.status === 400 && Object.hasOwn(payload, "grade")) {
      upstreamError = await response.text();
      if (
        upstreamError.includes(gradeField) &&
        upstreamError.includes("unexpected data type")
      )
        response = await patch({ ...body, [gradeField]: grade ? [grade] : [] });
    }
    if (!response.ok) {
      if (response.status === 400) {
        const message = response.bodyUsed
          ? upstreamError
          : await response.text();
        if (
          message.includes("generation") &&
          message.includes("unexpected key")
        )
          return json(
            {
              ok: false,
              message:
                "「期」を保存するには、microCMSのPortfolioに generation（数値）フィールドを追加してください。期を変更せずに保存すると、ほかの項目は更新できます。",
            },
            422,
          );
      }
      return json(
        {
          ok: false,
          message:
            response.status === 404
              ? "対象のPortfolioが見つかりません。"
              : "保存先で更新に失敗しました。時間をおいてお試しください。",
        },
        response.status === 404 ? 404 : 502,
      );
    }
    invalidateCache("cms:");
    await audit(user.id, "portfolio.update", target);
    return json({ ok: true });
  } catch {
    return json(
      {
        ok: false,
        message: "保存先に接続できませんでした。再度お試しください。",
      },
      502,
    );
  }
};

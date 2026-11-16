import { cmsPhotoId } from "../../../lib/photoIdentity.ts";
import { parsePhotoMetadata } from "../../../lib/photoMetadata.ts";
import { savePhotoMetadata } from "../../../lib/photoState.ts";
import type { PhotoMetadata, PortfolioSeries } from "../../../types/photos.ts";
import { parsePortfolioSeries } from "../../../lib/portfolioSeries.ts";
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
import { withStoreLock, writeData } from "../../../lib/store.ts";
import { readActivities } from "../../../lib/activities.ts";
import { sanitizePortfolioIntroduction, serializePortfolioIntroduction, portfolioIntroductionText } from "../../../lib/portfolioIntroduction.ts";
import { INTRODUCTION_TEXT_LIMIT, INTRODUCTION_HTML_LIMIT } from "../../../utils/portfolioIntroduction.ts";
import { PortfolioBookInputError, preparePortfolioBooks, publishPortfolioBooks, withPortfolioBooksLock } from "../../../lib/portfolioBooks.ts";

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
  if (Object.hasOwn(payload, "self_introduction_format") && payload.self_introduction_format !== "html")
    return json({ ok: false, message: "自己紹介の形式を確認してください。" }, 400);
  if (Object.hasOwn(payload, "self_introduction")) {
    const rich = payload.self_introduction_format === "html";
    if (typeof payload.self_introduction !== "string" || payload.self_introduction.length > (rich ? INTRODUCTION_HTML_LIMIT : INTRODUCTION_TEXT_LIMIT))
      return json({ ok: false, message: "自己紹介が長すぎます。文章や装飾を減らしてください。" }, 400);
    if (rich) {
      const clean = sanitizePortfolioIntroduction(payload.self_introduction);
      if (portfolioIntroductionText(clean).length > INTRODUCTION_TEXT_LIMIT)
        return json({ ok: false, message: "自己紹介は5,000文字以内で入力してください。" }, 400);
      body.self_introduction = serializePortfolioIntroduction(clean);
    } else body.self_introduction = payload.self_introduction.trim();
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
  let metadataEntries: { url: string; metadata: PhotoMetadata }[] = [];
  let series: PortfolioSeries[] | undefined;
  if (Object.hasOwn(payload, "photoSeries")) {
    try {
      if (!Array.isArray(payload.pictures)) throw new Error("掲載する写真を指定してください。");
      series = parsePortfolioSeries(payload.photoSeries, payload.pictures);
    } catch (error) {
      return json({ ok: false, message: (error as Error).message }, 400);
    }
  }
  if ("photoMetadata" in payload) {
    try {
      if (!payload.photoMetadata || typeof payload.photoMetadata !== "object" || Array.isArray(payload.photoMetadata) || !Array.isArray(payload.pictures)) throw new Error();
      metadataEntries = Object.entries(payload.photoMetadata).map(([url, metadata]) => {
        if (!payload.pictures.includes(url)) throw new Error();
        return { url, metadata: parsePhotoMetadata(metadata) };
      });
    } catch { return json({ ok: false, message: "写真情報の入力内容を確認してください。" }, 400); }
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
    // Serialize with the roster worker: a pending import must not undo a later manual save.
    const update = async () => {
      const books = Object.hasOwn(payload, "portfolioBooks")
        ? preparePortfolioBooks(target, user.id, payload.portfolioBookRevision, payload.portfolioBooks)
        : undefined;
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
      if (response.status === 400 && Object.hasOwn(payload, "grade")) {
        const upstreamError = await response.text();
        if (
          upstreamError.includes(gradeField) &&
          upstreamError.includes("unexpected data type")
        )
          response = await patch({ ...body, [gradeField]: grade ? [grade] : [] });
      }
      if (!response.ok) {
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
      if (Object.hasOwn(payload, "grade")) {
        await withStoreLock("member-activities", () => {
          const data = readActivities();
          let changed = false;
          for (const job of data.rosterPortfolioUpdates || []) {
            if (job.portfolioId === target && job.targetGrade && (job.status === "pending" || job.status === "error")) {
              job.status = "cancelled";
              job.message = "Portfolioで学年が保存されたため、名簿からの更新を中止しました。";
              job.updatedAt = new Date().toISOString();
              changed = true;
            }
          }
          if (changed) writeData("member-activities.json", data);
        });
      }
      await savePhotoMetadata(metadataEntries.map(entry => ({ ref: { source: "portfolio", containerId: target, imageId: cmsPhotoId(entry.url) }, metadata: entry.metadata })), undefined, series && { id: target, series });
      if (books) publishPortfolioBooks(target, books);
      invalidateCache("cms:");
      await audit(user.id, "portfolio.update", target);
      return json({ ok: true });
    };
    return await withStoreLock("roster-portfolio", () =>
      Object.hasOwn(payload, "portfolioBooks") ? withPortfolioBooksLock(target, update) : update());
  } catch (error) {
    if (error instanceof PortfolioBookInputError) return json({ ok: false, message: error.message }, error.status);
    return json(
      {
        ok: false,
        message: "保存先に接続できませんでした。再度お試しください。",
      },
      502,
    );
  }
};

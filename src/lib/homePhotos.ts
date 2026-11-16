import { getAllPortfolios, type Portfolio } from "./microcms.ts";
import { isListedPortfolio } from "../data/portfolioVisibility.ts";
import { safeMediaUrl } from "./contentSecurity.ts";
import { cmsPhotoId } from "./photoIdentity.ts";

export type HomePhoto = {
  id: string;
  url: string;
  portfolioId: string;
  portfolioName: string;
  position: number;
  width: number;
  height: number;
};

/** Use the same eligibility as the public, signed-out Portfolio list. */
export function collectHomePhotos(portfolios: Portfolio[]): HomePhoto[] {
  const photos = new Map<string, HomePhoto>();
  for (const portfolio of portfolios) {
    if (!isListedPortfolio(portfolio) || !portfolio.icon?.url?.trim()) continue;
    for (const [index, picture] of (portfolio.pictures ?? []).entries()) {
      // Do not guess an orientation when CMS dimensions are absent or invalid.
      // A square is not a landscape photograph.
      if (!Number.isFinite(picture?.width) || !Number.isFinite(picture?.height) ||
          picture.height <= 0 || picture.width <= picture.height) continue;
      const url = safeMediaUrl(picture?.url);
      if (!url) continue;
      const id = cmsPhotoId(url);
      if (photos.has(id)) continue;
      photos.set(id, {
        id, url, portfolioId: portfolio.id, portfolioName: portfolio.name,
        position: index + 1,
        width: picture.width,
        height: picture.height,
      });
    }
  }
  return [...photos.values()];
}

export async function getHomePhotoCatalog() {
  // getAllPortfolios pages through all published CMS entries and caches reads.
  return collectHomePhotos(await getAllPortfolios());
}

export function selectHomePhotos(photos: HomePhoto[], exclusions: string[], random = Math.random) {
  const excluded = new Set(exclusions);
  const available = photos.filter(photo => !excluded.has(photo.id));
  // Partial Fisher–Yates: at most 20 unique pictures, resampled per page request.
  const count = Math.min(20, available.length);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (available.length - i));
    [available[i], available[j]] = [available[j], available[i]];
  }
  return available.slice(0, count);
}

export function parseHomePhotoExclusions(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5000 || value.some(id => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))) {
    throw new Error("写真の除外設定を確認してください（最大5,000枚）。");
  }
  return [...new Set(value)];
}

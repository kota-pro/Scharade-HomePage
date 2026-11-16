import { cmsPhotoId } from "./photoIdentity.ts";
import { normalizePhotoMetadataLens, parsePhotoMetadata } from "./photoMetadata.ts";
import { readPhotoState } from "./photoState.ts";
import { layoutBounds } from "./exhibitionGeometry.ts";
import { optimizeMicrocmsImage } from "../utils/microcmsImage.ts";
import type { Portfolio } from "./microcms.ts";
import type { PortfolioSeries, PhotoSeries } from "../types/photos.ts";

export function parsePortfolioSeries(value: unknown, pictures: string[]): PortfolioSeries[] {
  const invalid = () => new Error("組写真は登録済みの異なる写真を2〜100枚選び、配置と写真情報を確認してください。");
  if (!Array.isArray(value) || value.length > pictures.length / 2) throw invalid();
  const available = new Set(pictures), groups = new Set<string>(), used = new Set<string>();
  return value.map(group => {
    if (!group || typeof group.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(group.id) || groups.has(group.id) ||
        !Array.isArray(group.photos) || group.photos.length < 2 || group.photos.length > 100) throw invalid();
    groups.add(group.id);
    const photos = group.photos.map((photo: Record<string, unknown>) => {
      if (!photo || typeof photo.assetId !== "string" || !available.has(photo.assetId)) throw invalid();
      const assetId = cmsPhotoId(photo.assetId);
      const { x, y, width, height, rotation } = photo;
      if (used.has(assetId) || ![x, y, width, height, rotation].every(n => typeof n === "number" && Number.isFinite(n)) ||
          Math.abs(x as number) > 100000 || Math.abs(y as number) > 100000 ||
          (width as number) < .1 || (height as number) < .1 ||
          (width as number) > 100000 || (height as number) > 100000 || Math.abs(rotation as number) > 360) throw invalid();
      used.add(assetId);
      return { assetId, x: x as number, y: y as number, width: width as number, height: height as number, rotation: rotation as number };
    });
    return { id: group.id, metadata: parsePhotoMetadata(group.metadata), photos };
  });
}

export function portfolioSeriesForPictures(portfolioId: string, pictures: Portfolio["pictures"]) {
  const series = readPhotoState().portfolioSeries;
  if (!series || !Object.hasOwn(series, portfolioId)) return [];
  const ids = new Set((pictures ?? []).map(pic => cmsPhotoId(pic.url)));
  return series[portfolioId].flatMap(work => {
    const photos = work.photos.filter(photo => ids.has(photo.assetId));
    return photos.length >= 2 ? [{ ...work, photos, metadata: normalizePhotoMetadataLens(work.metadata) }] : [];
  });
}

export function portfolioPhotoSeries(portfolio: Portfolio, photoId: string) {
  const work = portfolioSeriesForPictures(portfolio.id, portfolio.pictures).find(series => series.photos.some(photo => photo.assetId === photoId));
  if (!work) return;
  return portfolioSeriesLayout(work, new Map(portfolio.pictures.map(pic => [cmsPhotoId(pic.url), pic.url])));
}

export function portfolioSeriesLayout(work: PortfolioSeries, pictures: ReadonlyMap<string, string>, thumbnailWidth = 960): PhotoSeries {
  const bounds = layoutBounds(work.photos);
  return {
    title: work.metadata.title || "組写真", metadata: work.metadata, width: bounds.width, height: bounds.height,
    photos: work.photos.map((photo, index) => {
      const url = pictures.get(photo.assetId)!;
      return {
        id: photo.assetId, name: `写真 ${index + 1}`,
        src: optimizeMicrocmsImage(url, { width: thumbnailWidth, quality: 75 }),
        full: optimizeMicrocmsImage(url, { width: 2048, quality: 85 }),
        x: photo.x - bounds.x, y: photo.y - bounds.y, width: photo.width, height: photo.height, rotation: photo.rotation,
      };
    }),
  };
}

import { isExecutive, readUsers, type User } from "./auth.ts";
import { cached } from "./cache.ts";
import { getPortfolioDetail, microcmsClient, type Portfolio } from "./microcms.ts";
import { accessibleAlbum } from "./galleryAccess.ts";
import { getGalleryPhotosPage } from "./galleryCatalog.ts";
import { photoLinks } from "./galleryTokens.ts";
import { cmsPhotoId, parsePhotoRef } from "./photoIdentity.ts";
import { blogImages, resolvePhoto, photoPageUrl } from "./photos.ts";
import { photoView, photoLikers, readPhotoState, type PhotoStore } from "./photoState.ts";
import type { Blog } from "../types/microcms.ts";
import type { PhotoRef, PhotoView } from "../types/photos.ts";

export type RankedPhoto = PhotoView & { rank: number; href: string; containerName: string; sourceLabel: string };
export type PhotoRanking = {
  photos: RankedPhoto[]; page: number; pages: number; pageSize: number;
  summary: { totalLikes: number; likedPhotos: number; mostLikes: number };
  scope: { value: string; label: string }; unavailable: number; generatedAt: string;
};
export class PhotoRankingError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const sourceOrder = { portfolio: 0, gallery: 1, blog: 2 };
const labels = { portfolio: "Portfolio", blog: "Blog", gallery: "Gallery" };

/** Counts share photograph identity across placements; visitor records stay on the server. */
export function likedPhotoCandidates(data: PhotoStore) {
  return Object.entries(data.likes).flatMap(([key, records]) => {
    const values = Object.values(records), count = values.filter(value => value.active).length;
    if (!count) return [];
    const refs = new Map<string, PhotoRef>();
    for (const value of values) {
      try { const ref = parsePhotoRef(value.ref); refs.set(`${ref.source}:${ref.containerId}:${ref.imageId}`, ref); } catch { /* Skip invalid old references. */ }
    }
    return [{ key, count, refs: [...refs.values()].sort((a, b) => sourceOrder[a.source] - sourceOrder[b.source] || a.containerId.localeCompare(b.containerId)) }];
  });
}
export function orderPhotoRanking(photos: Omit<RankedPhoto, "rank">[]) {
  const ordered = [...photos].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.key.localeCompare(b.key));
  let rank = 0;
  return ordered.map((photo, index) => {
    if (!index || photo.count !== ordered[index - 1].count) rank = index + 1;
    return { ...photo, rank };
  });
}
async function mapBounded<T, R>(items: T[], fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (index < items.length) { const current = index++; results[current] = await fn(items[current]); }
  }));
  return results;
}

export async function getPhotoRanking(user: User, scope = "", requestedPage = 1): Promise<PhotoRanking> {
  if (!isExecutive(user)) throw new PhotoRankingError("写真のいいね数を閲覧する権限がありません。", 403);
  const parts = scope.split(":");
  if (scope && (parts.length !== 2 || !["portfolio", "blog", "gallery"].includes(parts[0]) || !/^[a-zA-Z0-9_-]{1,128}$/.test(parts[1]))) throw new PhotoRankingError("写真の掲載先を選択してください。");
  const data = readPhotoState();
  const result = await cached(`photo-ranking:${user.id}:${user.role}:${scope}:${data.sequence}`, async () => {
    let candidates = likedPhotoCandidates(data), scopeLabel = "すべての掲載先";
    if (scope) {
      const source = parts[0] as PhotoRef["source"], containerId = parts[1];
      if (source === "gallery") {
        const album = await accessibleAlbum(containerId, user);
        if (!album) throw new PhotoRankingError("この掲載先は現在表示できません。", 404);
        scopeLabel = album.payload.name;
        const liked = candidates.filter(candidate => candidate.key.startsWith("lightroom:"));
        const members = new Map<string, PhotoRef>(), cursors = new Set<string>();
        if (liked.length) {
          let cursor: string | null = null;
          do {
            const current = await getGalleryPhotosPage(containerId, { limit: 100, cursor });
            for (const photo of current.photos) members.set(`lightroom:${photo.id}`, { source, containerId, imageId: photo.id, proof: new URL(photoLinks(containerId, photo).full, "https://photo.invalid").searchParams.get("proof")! });
            cursor = current.nextCursor;
            if (cursor && cursors.has(cursor)) throw new Error("Repeated Gallery cursor");
            if (cursor) cursors.add(cursor);
          } while (cursor);
        }
        candidates = liked.filter(candidate => members.has(candidate.key)).map(candidate => ({ ...candidate, refs: [members.get(candidate.key)!] }));
      } else {
        const content = source === "portfolio" ? await getPortfolioDetail<Portfolio>(containerId) : await microcmsClient.getListDetail<Blog>({ endpoint: "blog", contentId: containerId });
        scopeLabel = source === "portfolio" ? (content as Portfolio).name : (content as Blog).title;
        const images = source === "portfolio" ? (content as Portfolio).pictures ?? [] : blogImages(content as Blog);
        const ids = new Set(images.map(image => cmsPhotoId(image.url)));
        candidates = candidates.filter(candidate => candidate.key.startsWith("cms:") && ids.has(candidate.key.slice(4))).map(candidate => ({ ...candidate, refs: [{ source, containerId, imageId: candidate.key.slice(4) }] }));
      }
    }
    let unavailable = 0;
    const rows = await mapBounded(candidates, async candidate => {
      for (const ref of candidate.refs) {
        try {
          let resolved = await resolvePhoto(ref, user);
          if (!scope && resolved.portfolioRef) {
            try { resolved = await resolvePhoto(resolved.portfolioRef, user); } catch { /* Keep the available Blog reference. */ }
          }
          if (resolved.key !== candidate.key) continue;
          const photo = photoView(resolved, user, "", data);
          let containerName = photo.author?.name || labels[photo.ref.source], href = photoPageUrl(photo.ref);
          if (photo.ref.source === "blog") {
            const post = await microcmsClient.getListDetail<Blog>({ endpoint: "blog", contentId: photo.ref.containerId });
            containerName = post.title; href = `/posts/${encodeURIComponent(post.slug)}?photo=${encodeURIComponent(photo.ref.imageId)}`;
          } else if (photo.ref.source === "gallery") containerName = (await accessibleAlbum(photo.ref.containerId, user))?.payload.name || "Gallery";
          return { ...photo, count: candidate.count, href, containerName, sourceLabel: labels[photo.ref.source] };
        } catch { /* Try another placement of the same photograph. */ }
      }
      unavailable++;
      return null;
    });
    const photos = orderPhotoRanking(rows.filter((row): row is NonNullable<typeof row> => row !== null));
    return { photos, summary: { totalLikes: photos.reduce((sum, photo) => sum + (photo.count ?? 0), 0), likedPhotos: photos.length, mostLikes: photos[0]?.count ?? 0 }, scope: { value: scope, label: scopeLabel }, unavailable, generatedAt: new Date().toISOString() };
  }, 15_000);
  const pageSize = 20, pages = Math.max(1, Math.ceil(result.photos.length / pageSize)), page = Math.min(pages, Math.max(1, requestedPage));
  const users = readUsers();
  return { ...result, photos: result.photos.slice((page - 1) * pageSize, page * pageSize).map(photo => ({ ...photo, likers: photoLikers(photo.key, data, users) })), page, pages, pageSize };
}

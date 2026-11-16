import sanitizeHtml from "sanitize-html";
import { getAllPortfolios, getPortfolioDetail, microcmsClient, type Portfolio } from "./microcms.ts";
import { isAdmin, isStaff, readUsers, type User } from "./auth.ts";
import { safeMediaUrl } from "./contentSecurity.ts";
import { optimizeMicrocmsImage } from "../utils/microcmsImage.ts";
import { accessibleAlbum } from "./galleryAccess.ts";
import { getGalleryPhotosPage, exhibitionPhotoEntries, exhibitionGalleryPlacement, exhibitionGallerySeries, galleryPlacementRevision, galleryWorkKey } from "./galleryCatalog.ts";
import { photoLinks, verifyGalleryValue } from "./galleryTokens.ts";
import { getLightroomPhotoMetadata } from "./lightroom.ts";
import { extractPhotoExif } from "./photoExif.ts";
import { cached } from "./cache.ts";
import { fetchWithTimeout, boundedBody } from "./http.ts";
import { cmsPhotoId, parsePhotoRef } from "./photoIdentity.ts";
import { galleryWorkSettings, photoMetadata, type ResolvedPhoto } from "./photoState.ts";
import { galleryAlbumSettings } from "./gallerySettings.ts";
import { portfolioPhotoSeries } from "./portfolioSeries.ts";
import type { Blog } from "../types/microcms.ts";
import { photoShootingMetadata } from "./photoMetadata.ts";
import type { PhotoRef } from "../types/photos.ts";
import type { Submission } from "./exhibitionTypes.ts";
import { findPortfolioBook } from "./portfolioBooks.ts";
import { portfolioBookMediaUrl } from "../types/portfolioBooks.ts";

export function blogImages(post: Blog) {
  const pictures = [...(post.pictures ?? [])];
  sanitizeHtml(post.body ?? "", { transformTags: { img: (tagName, attribs) => {
    const url = safeMediaUrl(attribs.src);
    if (url) pictures.push({ url, width: Number(attribs.width) || 0, height: Number(attribs.height) || 0 });
    return { tagName, attribs };
  } } });
  return [...new Map(pictures.filter(image => safeMediaUrl(image.url)).map(image => [cmsPhotoId(image.url), image])).values()];
}
function portfolioAuthor(portfolio: Portfolio) {
  return { name: portfolio.name, icon: portfolio.icon ? optimizeMicrocmsImage(portfolio.icon.url, { width: 120 }) : "/images/placeholder_icon.jpeg", href: `/Portfolio/${encodeURIComponent(portfolio.id)}` };
}
function portfolioOwner(id: string) {
  const owners = readUsers().filter(user => user.approved && user.portfolioId === id);
  return owners.length === 1 ? owners[0] : undefined;
}
function exhibitionPhotoOwner(submission: Pick<Submission, "userId" | "portfolioId">) {
  if (submission.userId) return readUsers().find(u => u.approved && u.id === submission.userId);
  if (submission.portfolioId) return portfolioOwner(submission.portfolioId);
}
export function galleryPhotoEditorId(submission: Submission, ownerId = exhibitionPhotoOwner(submission)?.id) {
  return submission.userId || submission.qrSource === "account" && submission.qrConfirmed ? ownerId : undefined;
}
export async function resolvePhoto(input: unknown, user?: User | null, loadExif = false): Promise<ResolvedPhoto> {
  const ref = parsePhotoRef(input);
  if (ref.source === "gallery") {
    const album = await accessibleAlbum(ref.containerId, user);
    if (!album) throw new Error("写真は削除されたか、現在の公開範囲では表示できません。");
    const local = exhibitionPhotoEntries(album.id), entry = local?.entries.find(e => e.asset.lightroomId === ref.imageId);
    let found = Boolean(entry);
    if (local ? !entry : galleryAlbumSettings(album.id)?.excludedPhotoIds?.includes(ref.imageId)) throw new Error("この写真は現在公開されていません。");
    if (!found && ref.proof) {
      try { const claim = verifyGalleryValue(ref.proof, "photo"); found = !claim.staffPreview && claim.album === album.id && claim.id === ref.imageId; } catch { /* Resolve expired links using current membership. */ }
    }
    if (!found) {
      let cursor: string | null = null;
      for (let page = 0; page < 100; page++) {
        const current = await getGalleryPhotosPage(album.id, { limit: 100, cursor });
        if (current.photos.some(photo => photo.id === ref.imageId)) { found = true; break; }
        if (!current.nextCursor) break;
        cursor = current.nextCursor;
      }
    }
    if (!found) throw new Error("写真が見つかりません。");
    const links = photoLinks(album.id, { id: ref.imageId, name: entry?.asset.name ?? "写真" });
    const owner = entry && exhibitionPhotoOwner(entry.submission);
    const galleryEditorId = entry && galleryPhotoEditorId(entry.submission, owner?.id);
    let author: ResolvedPhoto["author"];
    if (owner?.portfolioId) {
      try { author = portfolioAuthor(await getPortfolioDetail<Portfolio>(owner.portfolioId)); } catch { /* The submitted public author name remains usable. */ }
    }
    if (!author && entry?.content.authorName) author = { name: entry.content.authorName, icon: "/images/placeholder_icon.jpeg" };
    const details = photoShootingMetadata(entry?.work.details);
    const placement = loadExif && local && entry ? exhibitionGalleryPlacement(album.id, local.entries, entry) : undefined;
    const series = local && entry && placement ? exhibitionGallerySeries(album.id, local.entries, entry, placement) : undefined;
    const book = entry?.work.kind === "book" ? galleryWorkSettings(galleryWorkKey(album.id, entry)) : undefined;
    let galleryEdit: ResolvedPhoto["galleryEdit"];
    if (loadExif && (isStaff(user) || user?.approved && user.id === galleryEditorId)) {
      if (placement && series) galleryEdit = { kind: "series", layoutRevision: galleryPlacementRevision(placement.frames) };
      else if (local && entry?.work.kind === "book") {
        const pages = new Map(local.entries.filter(page => page.work === entry.work).map(({ asset }) =>
          [asset.lightroomId, { src: photoLinks(album.id, { id: asset.lightroomId, name: asset.name }).full, name: asset.name }]));
        galleryEdit = { kind: "book", pages: [...pages.values()] };
      } else galleryEdit = { kind: "single" };
    }
    return {
      ref: { ...ref, proof: new URL(links.full, "https://photo.invalid").searchParams.get("proof")! }, key: `lightroom:${ref.imageId}`, src: links.src, full: links.full, alt: entry?.work.title || "写真",
      width: entry?.asset.width, height: entry?.asset.height, author,
      ...(series ? { series } : {}),
      ...(galleryEdit ? { galleryEdit } : {}),
      ownerId: owner?.id, notifyOwnerId: owner?.id, galleryEditorId,
      ...(!entry && loadExif ? await getLightroomPhotoMetadata(ref.imageId) : {}), ...entry?.asset.photoMetadata, ...details, ...entry?.photo.metadata,
      title: entry?.work.title ?? "", caption: entry?.work.caption ?? "", ...photoMetadata(ref), ...book?.metadata,
    };
  }
  let portfolio: Portfolio | undefined;
  let image: { url: string; width?: number; height?: number } | undefined;
  if (ref.source === "portfolio") {
    portfolio = await getPortfolioDetail<Portfolio>(ref.containerId);
    image = portfolio.pictures?.find(photo => cmsPhotoId(photo.url) === ref.imageId);
    const book = !image && findPortfolioBook(portfolio.id, ref.imageId);
    if (book) {
      const cover = portfolioBookMediaUrl(portfolio.id, book.coverId);
      const owner = portfolioOwner(portfolio.id);
      return {
        ...book.metadata, ref, key: `book:${portfolio.id}:${book.id}`, src: cover, full: cover,
        alt: `${book.metadata.title || "ブック"}の表紙`, width: book.width, height: book.height,
        author: portfolioAuthor(portfolio), ownerId: owner?.id, notifyOwnerId: owner?.id, portfolioBook: true,
      };
    }
  } else {
    const post = await microcmsClient.getListDetail<Blog>({ endpoint: "blog", contentId: ref.containerId });
    image = blogImages(post).find(photo => cmsPhotoId(photo.url) === ref.imageId);
    const matches = (await getAllPortfolios()).filter(person => person.pictures?.some(photo => cmsPhotoId(photo.url) === ref.imageId));
    if (matches.length === 1) portfolio = matches[0];
  }
  if (!image) throw new Error("写真は削除されたか、現在公開されていません。");
  const owner = portfolio ? portfolioOwner(portfolio.id) : undefined;
  const portfolioRef: PhotoRef | undefined = portfolio ? { source: "portfolio", containerId: portfolio.id, imageId: ref.imageId } : undefined;
  const series = loadExif && portfolio && ref.source === "portfolio" ? portfolioPhotoSeries(portfolio, ref.imageId) : undefined;
  const automatic = loadExif ? await cached(`photo:exif:${ref.imageId}`, async () => {
    try {
      const original = new URL(image!.url); original.search = "";
      const response = await fetchWithTimeout(original);
      if (!response.ok) return {};
      const request = new Request("https://photo.invalid", { method: "POST", headers: response.headers, body: response.body, duplex: "half" } as RequestInit);
      return extractPhotoExif(await boundedBody(request, 20 * 1024 * 1024));
    } catch { return {}; }
  }, 300_000) : {};
  return {
    ref, key: `cms:${ref.imageId}`, src: optimizeMicrocmsImage(image.url, { width: 960, quality: 75 }), full: optimizeMicrocmsImage(image.url, { width: 2048, quality: 85 }),
    alt: portfolio ? `${portfolio.name}の写真` : "写真", width: image.width, height: image.height,
    ...(series ? { series } : {}),
    ...(portfolio ? { author: portfolioAuthor(portfolio) } : {}), ownerId: owner?.id,
    ...(ref.source === "portfolio" ? { notifyOwnerId: owner?.id } : {}), portfolioRef,
    ...automatic, ...(portfolioRef ? photoMetadata(portfolioRef) : {}), ...photoMetadata(ref),
  };
}
export function canEditPhoto(photo: ResolvedPhoto, user?: User | null) {
  if (photo.portfolioBook) return false;
  if (photo.ref.source === "gallery") return isStaff(user) || Boolean(user?.approved && user.id === photo.galleryEditorId);
  return isAdmin(user) || Boolean(user?.approved && photo.ref.source === "portfolio" && user.portfolioId === photo.ref.containerId);
}
export function photoPageUrl(ref: PhotoRef) {
  const path = ref.source === "portfolio" ? `/Portfolio/${encodeURIComponent(ref.containerId)}` : ref.source === "gallery" ? `/Gallery/${encodeURIComponent(ref.containerId)}` : "";
  return `${path}?photo=${encodeURIComponent(ref.imageId)}`;
}

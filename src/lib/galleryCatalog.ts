import { createHash } from "node:crypto";
import { readData } from "./store.ts";
import { isStaff, type User } from "./auth.ts";
import { getAlbums, getAlbumPhotosPage, type LightroomAlbum, type LightroomPhoto } from "./lightroom.ts";
import type { ExhibitionStore, Exhibition } from "./exhibitionTypes.ts";
import { photoLinks, signGalleryValue, verifyGalleryValue } from "./galleryTokens.ts";
import { albumPhotoExcluded, currentExhibitionPhotos } from './exhibitionAlbumPhotos.ts';
import { layoutBounds } from './exhibitionGeometry.ts';
import type { PhotoSeries, PhotoSeriesPreview } from '../types/photos.ts';
import { photoShootingMetadata } from "./photoMetadata.ts";
import { photoSeriesPreview } from "../utils/photoSeriesLayout.ts";
import { galleryAlbumSettings, readGallerySettings, type GallerySettings, type GalleryVisibility } from "./gallerySettings.ts";
import { galleryWorkSettings } from "./photoState.ts";

type GalleryPhoto = LightroomPhoto & { width?: number; height?: number; opensSeries?: boolean; series?: PhotoSeriesPreview };
type GalleryPhotoPage = { photos: GalleryPhoto[]; nextCursor: string | null };
type ExhibitionPhotoEntry = ReturnType<typeof currentExhibitionPhotos>[number];
export type GalleryAlbum = LightroomAlbum & GallerySettings;

export const exhibitionPhotoStore = () => readData<ExhibitionStore>("exhibitions.json", { version: 1, exhibitions: [], submissions: [], assets: [] });
export function galleryAlbumAllowed(album: GalleryAlbum, user?: User | null) {
  return album.visibility === "public" || (album.visibility === "members" ? Boolean(user?.approved) : isStaff(user));
}
function exhibitionAlbumVisibility(exhibition: Exhibition): GalleryVisibility {
  if (exhibition.gallery === "members" || exhibition.gallery === "public") return exhibition.gallery;
  return exhibition.albumCreated ? "public" : "staff";
}
export function exhibitionPhotoEntries(albumId: string, includeExcluded = false) {
  const data = exhibitionPhotoStore(), exhibition = data.exhibitions.find(e => e.albumId === albumId);
  if (!exhibition) return null;
  const entries = currentExhibitionPhotos(data, exhibition.id).filter(entry => includeExcluded || !albumPhotoExcluded(exhibition, entry.asset.id));
  return { exhibition, entries };
}

function hasSeriesPlacement({ work, photo }: ExhibitionPhotoEntry) {
  return work.kind === "series" && [photo.x, photo.y, photo.width, photo.height, photo.rotation].every(Number.isFinite)
    && photo.width > 0 && photo.height > 0;
}

export function galleryWorkKey(albumId: string, { submission, work }: ExhibitionPhotoEntry) {
  return JSON.stringify([albumId, submission.id, work.id]);
}

export function exhibitionGalleryPlacement(albumId: string, entries: ExhibitionPhotoEntry[], selected: ExhibitionPhotoEntry) {
  if (!hasSeriesPlacement(selected)) return;
  const visible = [...new Map(entries.filter(entry => entry.work === selected.work && hasSeriesPlacement(entry)).map(entry => [entry.asset.lightroomId, entry])).values()];
  if (!visible.some(entry => entry.asset.lightroomId === selected.asset.lightroomId)) return;
  const settings = galleryWorkSettings(galleryWorkKey(albumId, selected));
  const overrides = new Map(settings?.layout?.map(photo => [photo.assetId, photo]));
  const frames = visible.map(({ asset, photo }) => {
    const { x, y, width, height, rotation } = overrides.get(asset.lightroomId) ?? photo;
    return { assetId: asset.lightroomId, x, y, width, height, rotation };
  });
  return { visible, frames, bounds: layoutBounds(frames), settings };
}

export function galleryPlacementRevision(frames: NonNullable<ReturnType<typeof exhibitionGalleryPlacement>>["frames"]) {
  return createHash("sha256").update(JSON.stringify(frames)).digest("hex");
}

export function exhibitionGallerySeries(albumId: string, entries: ExhibitionPhotoEntry[], selected: ExhibitionPhotoEntry, placement = exhibitionGalleryPlacement(albumId, entries, selected)): PhotoSeries | undefined {
  if (!placement) return;
  const { visible, frames, bounds, settings } = placement;
  return {
    title: settings?.metadata.title ?? (selected.work.title || "組写真"), width: bounds.width, height: bounds.height,
    metadata: { caption: selected.work.caption, ...photoShootingMetadata(selected.work.details), ...settings?.metadata },
    photos: frames.map(({ assetId, x, y, width, height, rotation }, index) => ({
      ...photoLinks(albumId, { id: assetId, name: visible[index].asset.name }),
      x: x - bounds.x, y: y - bounds.y, width, height, rotation,
    })),
  };
}
export async function getGalleryAlbums(): Promise<GalleryAlbum[]> {
  const local = exhibitionPhotoStore().exhibitions;
  const settings = readGallerySettings();
  let remote: LightroomAlbum[];
  try { remote = await getAlbums(); }
  catch (error) {
    if (!local.some(e => e.status !== "draft") && !Object.values(settings).some(state => state.project && !state.project.supplement && !state.deletedAt)) throw error;
    remote = [];
  }
  const ids = new Set(local.map(e => e.albumId));
  const apply = (album: LightroomAlbum, initial: GalleryVisibility): GalleryAlbum => {
    const configured = galleryAlbumSettings(album.id, settings);
    const visibility = configured?.visibility ?? initial;
    return { ...album, category: configured?.category ?? album.category, payload: { ...album.payload, name: configured?.name ?? album.payload.name }, visibility, hidden: visibility !== "public", coverPhotoId: configured?.coverPhotoId ?? null, revision: configured?.revision ?? 0 };
  };
  const managed = Object.entries(settings).flatMap(([id, state]) =>
    state.project && !state.project.supplement && !ids.has(id)
      ? [apply({ id, created: state.project.createdAt, updated: state.project.createdAt, category: "other", hidden: true, payload: { name: state.name ?? id } }, "staff")]
      : []);
  const managedIds = new Set(managed.map(album => album.id));
  const supplements = new Set(Object.values(settings).filter(state => state.project?.supplement).map(state => state.project!.id));
  return [
    ...remote.filter(album => !ids.has(album.id) && !managedIds.has(album.id) && !supplements.has(album.id)).map(album => apply(album, album.hidden ? "members" : "public")),
    ...managed,
    ...local.filter(e => e.status !== "draft").map(e => apply({
      id: e.albumId, created: e.createdAt, updated: e.updatedAt, category: "exhibition", hidden: false, payload: { name: e.title },
    }, exhibitionAlbumVisibility(e))),
  ].filter(album => !galleryAlbumSettings(album.id, settings)?.deletedAt);
}

const supplementCursor = "supplement:";

async function remoteGalleryPhotos(albumId: string, options: { cursor?: string | null; limit?: number; includeExcluded?: boolean }): Promise<GalleryPhotoPage> {
  const settings = galleryAlbumSettings(albumId);
  const supplementId = settings?.project?.supplement ? settings.project.id : undefined;
  const excluded = new Set(options.includeExcluded ? [] : settings?.excludedPhotoIds);
  let source = albumId;
  let cursor = options.cursor;
  if (cursor && supplementId) {
    const claim = verifyGalleryValue(cursor, "cursor");
    if (claim.album !== albumId) throw new Error("Invalid gallery cursor");
    if (claim.url?.startsWith(supplementCursor)) {
      source = supplementId;
      cursor = claim.url.slice(supplementCursor.length) || null;
    }
  }
  if (!supplementId && !excluded.size) return getAlbumPhotosPage(source, options);
  const wrap = (next: string | null) => signGalleryValue({ kind: "cursor", album: albumId, url: supplementCursor + (next ?? "") });
  const seen = new Set<string>();
  while (true) {
    const page = await getAlbumPhotosPage(source, { ...options, cursor });
    let photos = page.photos.filter(photo => !excluded.has(photo.id));
    if (source !== albumId && photos.length) {
      const original = await remotePhotoIds(albumId, photos.map(photo => photo.id));
      photos = photos.filter(photo => !original.has(photo.id));
    }
    if (photos.length && page.nextCursor) return { photos, nextCursor: source === albumId ? page.nextCursor : wrap(page.nextCursor) };
    if (!page.nextCursor) {
      if (!supplementId || source === supplementId) return { photos, nextCursor: null };
      if (photos.length) return { photos, nextCursor: wrap(null) };
      source = supplementId;
      cursor = null;
      continue;
    }
    if (seen.size >= 100 || seen.has(page.nextCursor)) throw new Error("Repeated Gallery cursor");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
export async function getGalleryPhotosPage(albumId: string, options: { cursor?: string | null; limit?: number; includeExcluded?: boolean; groupSeries?: boolean } = {}): Promise<GalleryPhotoPage> {
  const local = exhibitionPhotoEntries(albumId, options.includeExcluded);
  if (!local) return remoteGalleryPhotos(albumId, options);
  const cursorPrefix = options.groupSeries ? "local-works:" : "local:";
  let offset = 0;
  if (options.cursor) {
    const claim = verifyGalleryValue(options.cursor, "cursor");
    const position = claim.url?.slice(cursorPrefix.length);
    if (claim.album !== albumId || !claim.url?.startsWith(cursorPrefix) || !/^\d+$/.test(position ?? "")) throw new Error("Invalid gallery cursor");
    offset = Number(position);
  }
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const entries = [...new Map(local.entries.map(entry => [entry.asset.lightroomId, entry])).values()];
  const groups = new Map<ExhibitionPhotoEntry["work"], ExhibitionPhotoEntry[]>();
  const additionalFrames = new Set<ExhibitionPhotoEntry>();
  if (options.groupSeries) {
    for (const entry of entries) {
      if (!hasSeriesPlacement(entry)) continue;
      const group = groups.get(entry.work);
      if (group) {
        group.push(entry);
        additionalFrames.add(entry);
      } else groups.set(entry.work, [entry]);
    }
  }
  const cards = additionalFrames.size ? entries.filter(entry => !additionalFrames.has(entry)) : entries;
  return {
    photos: cards.slice(offset, offset + limit).map(entry => {
      const { asset, work } = entry;
      const group = groups.get(work);
      const series = group && exhibitionGallerySeries(albumId, group, entry);
      return { id: asset.lightroomId, name: asset.name, width: asset.width, height: asset.height,
        ...(series ? { opensSeries: true, series: photoSeriesPreview(series) } : !options.groupSeries && work.kind === "series" ? { opensSeries: true } : {}) };
    }),
    nextCursor: offset + limit < cards.length ? signGalleryValue({ kind: "cursor", album: albumId, url: `${cursorPrefix}${offset + limit}` }) : null,
  };
}

export async function galleryHasPhoto(albumId: string, photoId: string) {
  const local = exhibitionPhotoEntries(albumId);
  if (local) return local.entries.some(({ asset }) => asset.lightroomId === photoId);
  if (galleryAlbumSettings(albumId)?.excludedPhotoIds?.includes(photoId)) return false;
  return galleryHasRemotePhotos(albumId, [photoId]);
}

export async function galleryHasRemotePhotos(albumId: string, photoIds: string[]) {
  const found = await remotePhotoIds(albumId, photoIds);
  const remaining = photoIds.filter(id => !found.has(id));
  if (!remaining.length) return true;
  const project = galleryAlbumSettings(albumId)?.project;
  return !!project?.supplement && (await remotePhotoIds(project.id, remaining)).size === new Set(remaining).size;
}

async function remotePhotoIds(albumId: string, photoIds: string[]) {
  const remaining = new Set(photoIds);
  const found = new Set<string>();
  if (!remaining.size) return found;
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await getAlbumPhotosPage(albumId, { cursor, limit: 100 });
    for (const photo of page.photos) if (remaining.delete(photo.id)) found.add(photo.id);
    if (!remaining.size) return found;
    cursor = page.nextCursor;
    if (!cursor || seen.has(cursor)) return found;
    seen.add(cursor);
  } while (seen.size < 100);
  return found;
}

export async function galleryCoverId(album: GalleryAlbum) {
  if (album.coverPhotoId && await galleryHasPhoto(album.id, album.coverPhotoId)) return album.coverPhotoId;
  const hasExclusions = galleryAlbumSettings(album.id)?.excludedPhotoIds?.length;
  return (await getGalleryPhotosPage(album.id, { limit: hasExclusions ? 30 : 1 })).photos[0]?.id ?? null;
}

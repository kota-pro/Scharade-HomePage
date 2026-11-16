import { isSiteManagement } from "./accountVisibility.ts";
import { readData, writeData, withStoreLock, dataPath } from "./store.ts";
import fs from "node:fs";
import crypto from "node:crypto";
import { isExecutive, readUsers, type User } from "./auth.ts";
import { photoRefKey } from "./photoIdentity.ts";
import { photoCameraModel } from "./photoCamera.ts";
import { normalizePhotoMetadataLens } from "./photoMetadata.ts";
import type { PhotoMetadata, PhotoRef, PhotoView, PhotoLiker, PortfolioSeries } from "../types/photos.ts";
import type { PhotoLayout } from "./exhibitionTypes.ts";

export type ResolvedPhoto = Omit<PhotoView, "liked" | "count" | "likers"> & { ownerId?: string; notifyOwnerId?: string; portfolioRef?: PhotoRef; galleryEditorId?: string; portfolioBook?: true };
type GalleryWorkSettings = { metadata: PhotoMetadata; layout?: PhotoLayout[] };
type Like = { active: boolean; sequence: number; at: string; ownerId?: string; likerId?: string; ref: PhotoRef };
export type PhotoStore = { version: 1; sequence: number; metadata: Record<string, PhotoMetadata>; likes: Record<string, Record<string, Like>>; readThrough: Record<string, Record<string, number>>; portfolioSeries?: Record<string, PortfolioSeries[]>; galleryWorks?: Record<string, GalleryWorkSettings> };
const FILE = "photo-interactions.json";
let snapshot: { stamp: string; data: PhotoStore } | undefined;
export function readPhotoState(): PhotoStore {
  let stamp = "";
  try {
    const file = dataPath(FILE), stat = fs.statSync(file);
    stamp = `${file}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (snapshot?.stamp === stamp) return snapshot.data;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const data = readData<PhotoStore>(FILE, { version: 1, sequence: 0, metadata: {}, likes: {}, readThrough: {} });
  if (data.version !== 1 || !Number.isSafeInteger(data.sequence) || !data.metadata || !data.likes || !data.readThrough) throw new Error("写真データの形式を確認してください。");
  if (stamp) snapshot = { stamp, data }; else snapshot = undefined;
  return data;
}
export function photoMetadata(ref: PhotoRef) { return normalizePhotoMetadataLens(readPhotoState().metadata[photoRefKey(ref)] ?? {}); }
export function galleryWorkSettings(key: string) { return readPhotoState().galleryWorks?.[key]; }

export async function saveGalleryWork(key: string, metadata: PhotoMetadata, authorize: () => PhotoLayout[] | undefined) {
  return withStoreLock(FILE, () => {
    const layout = authorize();
    const data = structuredClone(readPhotoState());
    const works = data.galleryWorks ??= {};
    const previous = works[key];
    const placements = new Map(previous?.layout?.map(photo => [photo.assetId, photo]));
    for (const photo of layout ?? []) placements.set(photo.assetId, photo);
    works[key] = { metadata: { ...previous?.metadata, ...metadata }, ...(placements.size ? { layout: [...placements.values()] } : {}) };
    writeData(FILE, data);
  });
}
function likeIdentity(visitor: string, user: User | null | undefined, likes: Record<string, Like>) {
  if (!user?.approved) return visitor;
  const account = `member:${user.id}`;
  // Preserve old browser likes until an explicit cancellation, without guessing their member.
  return Object.hasOwn(likes, account) || !likes[visitor]?.active ? account : visitor;
}
function likerProfiles(likes: Like[], users: User[]): PhotoLiker[] {
  const directory = new Map(users.filter(user => !isSiteManagement(user)).map(user => [user.id, user])), seen = new Set<string>();
  return [...likes].sort((a, b) => b.sequence - a.sequence).flatMap(like => {
    if (!like.active || !like.likerId || seen.has(like.likerId)) return [];
    const member = directory.get(like.likerId); if (!member) return [];
    seen.add(member.id);
    return [{ name: member.name?.trim() || member.portfolioName?.trim() || "会員", ...(member.portfolioId && /^[a-zA-Z0-9_-]{1,128}$/.test(member.portfolioId) ? { href: `/Portfolio/${encodeURIComponent(member.portfolioId)}` } : {}) }];
  });
}
export function photoLikers(key: string, data = readPhotoState(), users = readUsers()) { return likerProfiles(Object.values(data.likes[key] ?? {}), users); }
export async function savePhotoMetadata(entries: { ref: PhotoRef; metadata: PhotoMetadata; merge?: boolean }[], authorize?: () => void, portfolio?: { id: string; series: PortfolioSeries[] }) {
  return withStoreLock(FILE, () => {
    authorize?.();
    const data = structuredClone(readPhotoState());
    for (const { ref, metadata, merge } of entries) {
      const key = photoRefKey(ref);
      data.metadata[key] = merge ? { ...data.metadata[key], ...metadata } : metadata;
    }
    if (portfolio) {
      if (portfolio.series.length) data.portfolioSeries = { ...data.portfolioSeries, [portfolio.id]: portfolio.series };
      else if (data.portfolioSeries) delete data.portfolioSeries[portfolio.id];
    }
    writeData(FILE, data);
  });
}
export function photoView(photo: ResolvedPhoto, user?: User | null, visitor = "", data = readPhotoState()): PhotoView {
  const { ownerId, notifyOwnerId: _notificationOwner, portfolioRef: _portfolioRef, galleryEdit: _galleryEdit, galleryEditorId: _galleryEditorId, portfolioBook: _portfolioBook, ...view } = photo;
  const likes = data.likes[photo.key] ?? {};
  return { ...normalizePhotoMetadataLens(view), ...(view.camera === undefined ? {} : { camera: photoCameraModel("", view.camera) }), liked: Boolean(likes[likeIdentity(visitor, user, likes)]?.active), ...((user?.approved && (user.id === ownerId || photo.ref.source === "portfolio" && user.portfolioId === photo.ref.containerId)) || isExecutive(user) ? { count: Object.values(likes).filter(like => like.active).length, likers: photoLikers(photo.key, data) } : {}) };
}
export async function setPhotoLike(photo: ResolvedPhoto, visitor: string, liked: boolean, user?: User | null) {
  return withStoreLock(FILE, () => {
    if (user?.approved && !readUsers().some(member => member.id === user.id && member.approved)) throw new Error("ログイン状態を確認してください。");
    const data = structuredClone(readPhotoState()), likes = data.likes[photo.key] ??= {};
    const identity = likeIdentity(visitor, user, likes);
    if (Boolean(likes[identity]?.active) !== liked) {
      data.sequence++;
      likes[identity] = { active: liked, sequence: data.sequence, at: new Date().toISOString(), ref: { ...photo.ref, proof: undefined }, ...(liked && photo.notifyOwnerId ? { ownerId: photo.notifyOwnerId } : {}), ...(liked && user?.approved ? { likerId: user.id } : {}) };
      writeData(FILE, data);
    }
    return data;
  });
}
export function unreadPhotoGroups(ownerId: string, data = readPhotoState()) {
  const users = readUsers();
  return Object.entries(data.likes).flatMap(([key, records]) => {
    const likes = Object.values(records).filter(like => like.active && like.ownerId === ownerId && like.sequence > (data.readThrough[ownerId]?.[key] ?? 0));
    if (!likes.length) return [];
    const latest = likes.reduce((a, b) => a.sequence > b.sequence ? a : b);
    return [{ key, count: likes.length, likers: likerProfiles(likes, users), ref: latest.ref, at: latest.at, sequence: latest.sequence, through: data.sequence }];
  }).sort((a, b) => b.sequence - a.sequence);
}
export async function readPhotoNotifications(ownerId: string, key?: string, through?: number) {
  return withStoreLock(FILE, () => {
    const data = structuredClone(readPhotoState());
    const cutoff = key ? Math.min(data.sequence, through ?? -1) : data.sequence;
    if (!Number.isSafeInteger(cutoff) || cutoff < 0) throw new Error("既読にする通知を確認してください。");
    const owned = data.readThrough[ownerId] ??= {};
    for (const group of unreadPhotoGroups(ownerId, data)) {
      if (!key || group.key === key) owned[group.key] = Math.max(owned[group.key] ?? 0, cutoff);
    }
    writeData(FILE, data);
    return unreadPhotoGroups(ownerId, data).length;
  });
}

export async function clearAccountPhotoReferences(userId: string, portfolioId?: string | null) {
  return withStoreLock(FILE, () => {
    const data = structuredClone(readPhotoState());
    delete data.readThrough[userId];
    if (portfolioId) for (const key of Object.keys(data.metadata)) if (key.startsWith(`portfolio:${portfolioId}:`)) delete data.metadata[key];
    if (portfolioId && data.portfolioSeries) delete data.portfolioSeries[portfolioId];
    for (const records of Object.values(data.likes)) for (const [identity, like] of Object.entries(records)) {
      if (like.ownerId === userId) delete like.ownerId;
      if (like.likerId === userId || identity === `member:${userId}`) {
        delete like.likerId;
        delete records[identity];
        records[`anonymous:${crypto.randomUUID()}`] = like;
      }
    }
    data.sequence++;
    writeData(FILE, data);
  });
}

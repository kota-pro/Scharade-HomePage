import { readData, withStoreLock, writeData } from "./store.ts";
import type { GalleryAlbumCategory } from "../data/galleryAlbums.ts";

export type GalleryVisibility = "public" | "members" | "staff";
export type GallerySettings = { revision: number; visibility: GalleryVisibility; coverPhotoId: string | null };
type StoredSettings = Omit<GallerySettings, "visibility"> & {
  visibility: GalleryVisibility | null;
  excludedPhotoIds?: string[];
  name?: string;
  category?: GalleryAlbumCategory;
  project?: { id: string; createdAt: string; supplement?: true };
  deletedAt?: string;
  deletePending?: boolean;
};
type SettingsStore = { albums: Record<string, StoredSettings> };
const FILE = "gallery-settings.json";

export function readGallerySettings() {
  return readData<SettingsStore>(FILE, { albums: {} }).albums;
}

export function galleryAlbumSettings(albumId: string, albums = readGallerySettings()) {
  return Object.hasOwn(albums, albumId) ? albums[albumId] : undefined;
}

export function saveGallerySettings(albumId: string, revision: number, settings: Partial<Omit<StoredSettings, "revision">>) {
  return withStoreLock(FILE, () => {
    const albums = readGallerySettings();
    const current = galleryAlbumSettings(albumId, albums);
    if ((current?.revision ?? 0) !== revision) return false;
    const next = { visibility: null, coverPhotoId: null, ...current, ...settings, revision: revision + 1 };
    writeData<SettingsStore>(FILE, { albums: { ...albums, [albumId]: next } });
    return true;
  });
}

export function linkGallerySupplement(albumId: string, project: NonNullable<StoredSettings["project"]>) {
  return withStoreLock(FILE, () => {
    const albums = readGallerySettings();
    const current = galleryAlbumSettings(albumId, albums);
    if (current?.deletedAt || (current?.project && current.project.id !== project.id)) return false;
    if (current?.project) return true;
    const next = { visibility: null, coverPhotoId: null, revision: 0, ...current, project };
    writeData<SettingsStore>(FILE, { albums: { ...albums, [albumId]: next } });
    return true;
  });
}

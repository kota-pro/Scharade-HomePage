import { createHash } from "node:crypto";
import sharp from "sharp";
import { GALLERY_CATEGORY_ORDER, type GalleryAlbumCategory } from "../data/galleryAlbums.ts";
import { getAdobeAccessToken } from "./adobeAuth.ts";
import { audit } from "./audit.ts";
import type { User } from "./auth.ts";
import { invalidateCache } from "./cache.ts";
import { env, siteOrigin } from "./config.ts";
import { ContentManagementError } from "./contentManagement.ts";
import { accessibleAlbum } from "./galleryAccess.ts";
import { exhibitionPhotoEntries } from "./galleryCatalog.ts";
import { galleryAlbumSettings, linkGallerySupplement, saveGallerySettings } from "./gallerySettings.ts";
import { fetchWithTimeout } from "./http.ts";
import { imageSignature, withImageSlot } from "./imageSecurity.ts";
import { validLightroomId } from "./lightroom.ts";
import { withStoreLock } from "./store.ts";

export const GALLERY_UPLOAD_LIMIT = 20 * 1024 * 1024;

function albumLock<T>(id: string, job: () => Promise<T>) {
  if (!validLightroomId(id)) throw new ContentManagementError("アルバムが見つかりません。", 404);
  return withStoreLock(`gallery-album-${id}`, job);
}

function stableId(...parts: string[]) {
  const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${hex.slice(0, 12)}4${hex.slice(13, 16)}8${hex.slice(17, 32)}`;
}

function conflict() {
  return new ContentManagementError("別の画面で変更されました。再読み込みしてください。", 409);
}

export function galleryAlbumName(input: unknown) {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw new ContentManagementError("アルバム名を120文字以内で入力してください。");
  return name;
}

export function galleryAlbumCategory(input: unknown) {
  const category = input as GalleryAlbumCategory;
  if (!GALLERY_CATEGORY_ORDER.includes(category)) throw new ContentManagementError("分類を選択してください。");
  return category;
}

export function galleryAlbumFields(input: Record<string, unknown>) {
  return { name: galleryAlbumName(input.name), category: galleryAlbumCategory(input.category) };
}

async function lightroomContext() {
  const catalog = env("LIGHTROOM_CATALOG_ID");
  const client = env("ADOBE_CLIENT_ID");
  if (!catalog || !client) throw new ContentManagementError("Lightroomへの接続が設定されていません。", 503);
  const token = await getAdobeAccessToken();
  const base = `https://lr.adobe.io/v2/catalogs/${encodeURIComponent(catalog)}`;
  function send(url: string, options: RequestInit = {}, timeout = 8000) {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("X-API-Key", client);
    return fetchWithTimeout(url, { ...options, headers }, timeout);
  }
  return {
    request: (path: string, options?: RequestInit, timeout?: number) => send(base + path, options, timeout),
    account: () => send("https://lr.adobe.io/v2/account"),
    client,
  };
}

type LightroomContext = Awaited<ReturnType<typeof lightroomContext>>;
const remoteAlbumId = (id: string) => `gallery:${id}`;

function jsonBody(method: string, body: unknown, create = false): RequestInit {
  return {
    method, body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(create ? { "If-None-Match": "*" } : {}) },
  };
}

async function responseResource(response: Response) {
  const data = JSON.parse((await response.text()).replace(/^while\s*\(1\)\s*\{\}\s*/, ""));
  return data.resource ?? data;
}

async function lightroomResourceExists(response: Response) {
  if (response.status === 409 || response.status === 412) return true;
  if (response.status !== 403) return false;
  const error = await responseResource(response).catch(() => null);
  return error?.code === 1002;
}

function checkLightroom(response: Response) {
  if (response.ok) return;
  if (response.status === 429) throw new ContentManagementError("Lightroomが混み合っています。少し待って再試行してください。", 429);
  if (response.status === 413) throw new ContentManagementError("Lightroomの容量または送信サイズの上限に達しました。", 413);
  if (response.status === 403) throw new ContentManagementError("Lightroomへの書き込み権限を確認してください。", 503);
  throw new ContentManagementError("Lightroomで処理できませんでした。時間をおいて再試行してください。", 503);
}

async function hasUploadedMaster(context: LightroomContext, assetId: string, size: number) {
  const response = await context.request(`/assets/${assetId}`);
  checkLightroom(response);
  const asset = await responseResource(response);
  if (asset.id !== assetId || asset.payload?.importSource?.importedOnDevice !== context.client)
    throw new ContentManagementError("Lightroom上の写真を確認できません。", 409);
  return Number(asset.payload.importSource.fileSize) === size;
}

async function ownedProject(context: LightroomContext, projectId: string, albumId: string) {
  const response = await context.request(`/albums/${projectId}`);
  if (response.status === 404) return false;
  checkLightroom(response);
  const album = await responseResource(response);
  if (album.serviceId !== context.client || album.subtype !== "project" ||
    album.payload?.publishInfo?.remoteId !== remoteAlbumId(albumId))
    throw new ContentManagementError("Lightroomアルバムの所有情報を確認できません。", 409);
  return true;
}

async function ensureProject(context: LightroomContext, projectId: string, albumId: string, name: string, now: string) {
  if (await ownedProject(context, projectId, albumId)) return;
  const response = await context.request(`/albums/${projectId}`, jsonBody("PUT", {
    subtype: "project", serviceId: context.client,
    payload: {
      name, userCreated: now, userUpdated: now,
      publishInfo: {
        version: 3, created: now, updated: now, remoteId: remoteAlbumId(albumId),
        remoteLinks: { edit: { href: `${siteOrigin()}/Management/gallery/${albumId}` } },
      },
    },
  }, true));
  if (await lightroomResourceExists(response) && await ownedProject(context, projectId, albumId)) return;
  checkLightroom(response);
}

export async function createGalleryAlbum(input: Record<string, unknown>, user: User) {
  const fields = galleryAlbumFields(input);
  if (typeof input.requestId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.requestId))
    throw new ContentManagementError("作成画面を再読み込みしてください。");
  const id = stableId("gallery-project", user.id, input.requestId.toLowerCase());
  return albumLock(id, async () => {
    const current = galleryAlbumSettings(id);
    if (current?.deletedAt) throw conflict();
    if (current?.project) return id;
    const createdAt = new Date().toISOString();
    await ensureProject(await lightroomContext(), id, id, fields.name, createdAt);
    if (!await saveGallerySettings(id, 0, { ...fields, visibility: "staff", project: { id, createdAt } })) throw conflict();
    invalidateCache("lr:albums");
    await audit(user.id, "gallery.album.create", id);
    return id;
  });
}

async function projectForUpload(id: string, user: User) {
  const album = await accessibleAlbum(id, user);
  if (!album) throw new ContentManagementError("アルバムが見つかりません。", 404);
  if (exhibitionPhotoEntries(id)) throw new ContentManagementError("写真展の写真は写真展管理から追加してください。", 409);
  const context = await lightroomContext();
  const settings = galleryAlbumSettings(id);
  if (settings?.project) {
    if (!await ownedProject(context, settings.project.id, id))
      throw new ContentManagementError("Lightroomの連携アルバムが見つかりません。", 503);
    return { context, projectId: settings.project.id };
  }
  const projectId = stableId("gallery-supplement", id);
  const createdAt = new Date().toISOString();
  await ensureProject(context, projectId, id, `${album.payload.name.slice(0, 110)}（Gallery追加）`, createdAt);
  if (!await linkGallerySupplement(id, { id: projectId, createdAt, supplement: true })) throw conflict();
  return { context, projectId };
}

export async function uploadGalleryPhoto(id: string, file: File, user: User) {
  if (!file.size || file.size > GALLERY_UPLOAD_LIMIT)
    throw new ContentManagementError("20MB以下の画像を選択してください。", file.size ? 413 : 400);
  return albumLock(id, async () => {
    const bytes = Buffer.from(await file.arrayBuffer());
    const format = imageSignature(bytes);
    if (format !== "jpeg" && format !== "png") throw new ContentManagementError("JPEGまたはPNG画像を選択してください。");
    const metadata = await withImageSlot(() => sharp(bytes, { limitInputPixels: 60_000_000 }).timeout({ seconds: 10 }).metadata()).catch(error => {
      if (error instanceof Error && "status" in error) throw error;
      throw new ContentManagementError("破損している画像や6,000万画素を超える画像は追加できません。");
    });
    if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width * metadata.height > 60_000_000 || (metadata.pages ?? 1) !== 1)
      throw new ContentManagementError("画像の形式とサイズを確認してください。");
    const { context, projectId } = await projectForUpload(id, user);
    const assetId = stableId("gallery-photo", id, createHash("sha256").update(bytes).digest("hex"));
    const path = `/assets/${assetId}`;
    const accountResponse = await context.account();
    checkLightroom(accountResponse);
    const account = await responseResource(accountResponse);
    if (typeof account.id !== "string" || !/^[a-f0-9]{32}$/i.test(account.id))
      throw new ContentManagementError("Lightroomのアカウントを確認できません。", 503);
    const fileName = file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) || `photo.${format}`;
    const now = new Date().toISOString();
    const created = await context.request(path, jsonBody("PUT", {
      subtype: "image",
      payload: {
        captureDate: "0000-00-00T00:00:00",
        importSource: { fileName, importedOnDevice: context.client, importedBy: account.id, importTimestamp: now },
      },
    }, true));
    const existing = await lightroomResourceExists(created);
    if (!existing) checkLightroom(created);
    const ready = existing && await hasUploadedMaster(context, assetId, bytes.length);
    if (!ready) {
      const uploaded = await context.request(`${path}/master`, {
        method: "PUT", headers: { "Content-Type": `image/${format}`, "Content-Length": String(bytes.length) },
        body: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      }, 35000);
      if (!uploaded.ok && !(existing && await lightroomResourceExists(uploaded) && await hasUploadedMaster(context, assetId, bytes.length))) checkLightroom(uploaded);
    }
    checkLightroom(await context.request(`/albums/${projectId}/assets`, jsonBody("PUT", {
      resources: [{ id: assetId, payload: { publishInfo: { remoteId: assetId } } }],
    })));
    invalidateCache(`lr:photos:https://lr.adobe.io/v2/catalogs/${env("LIGHTROOM_CATALOG_ID")}/albums/${projectId}/assets`);
    await audit(user.id, "gallery.photo.upload", `${id}/${assetId}`);
    return assetId;
  });
}

export async function deleteGalleryAlbum(id: string, revision: unknown, user: User) {
  return albumLock(id, async () => {
    let current = galleryAlbumSettings(id);
    if (current?.deletedAt && !current.deletePending) return;
    if (!current?.deletedAt) {
      const album = await accessibleAlbum(id, user);
      if (!album) throw new ContentManagementError("アルバムが見つかりません。", 404);
      if (album.revision !== revision) throw conflict();
      const deletePending = !!current?.project && !current.project.supplement && !exhibitionPhotoEntries(id);
      if (!await saveGallerySettings(id, album.revision, { name: album.payload.name, deletedAt: new Date().toISOString(), deletePending })) throw conflict();
      await audit(user.id, "gallery.album.delete", id);
      current = galleryAlbumSettings(id);
    }
    if (!current?.deletePending || !current.project) return;
    const context = await lightroomContext();
    if (await ownedProject(context, current.project.id, id)) {
      const removed = await context.request(`/albums/${current.project.id}`, { method: "DELETE" });
      if (removed.status !== 404) checkLightroom(removed);
    }
    if (!await saveGallerySettings(id, current.revision, { deletePending: false })) throw conflict();
    invalidateCache("lr:albums");
  });
}

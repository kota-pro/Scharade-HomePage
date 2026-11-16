import type { APIRoute } from "astro";
import { isStaff } from "../../../../../lib/auth.ts";
import { currentExhibitionPhotos, parseAlbumExclusions } from "../../../../../lib/exhibitionAlbumPhotos.ts";
import { ExhibitionError } from "../../../../../lib/exhibitionValidation.ts";
import { requireStaff, updateExhibitionStore } from "../../../../../lib/exhibitions.ts";
import { accessibleAlbum } from "../../../../../lib/galleryAccess.ts";
import { exhibitionPhotoEntries, galleryHasRemotePhotos, getGalleryPhotosPage } from "../../../../../lib/galleryCatalog.ts";
import { galleryAlbumSettings, saveGallerySettings } from "../../../../../lib/gallerySettings.ts";
import { photoLinks } from "../../../../../lib/galleryTokens.ts";
import { json } from "../../../../../lib/http.ts";
import { validLightroomId } from "../../../../../lib/lightroom.ts";

const unauthorized = (signedIn: boolean) => json({ ok: false, message: "運営以上の権限が必要です。" }, signedIn ? 403 : 401);
const missing = () => json({ ok: false, message: "アルバムが見つかりません。" }, 404);
const conflictMessage = "別の画面で設定が変更されました。ページを再読み込みしてください。";

export const GET: APIRoute = async ({ params, url, locals }) => {
  if (!isStaff(locals.user)) return unauthorized(!!locals.user);
  try {
    const album = await accessibleAlbum(params.id ?? "", locals.user);
    if (!album) return missing();
    const cursor = url.searchParams.get("cursor");
    const local = exhibitionPhotoEntries(album.id, true);
    const settings = local ? undefined : galleryAlbumSettings(album.id);
    const revision = local?.exhibition.revision ?? settings?.revision ?? 0;
    let page;
    try { page = await getGalleryPhotosPage(album.id, { cursor, includeExcluded: true }); }
    catch (error) {
      if (cursor) return json({ ok: false, message: "写真一覧の読み込み位置が変わりました。ページを再読み込みしてください。" }, 400);
      throw error;
    }
    const excludedAssetIds = new Set(local?.exhibition.albumExcludedAssetIds);
    const excludedPhotoIds = local
      ? [...new Set(local.entries.filter(({ asset }) => excludedAssetIds.has(asset.id)).map(({ asset }) => asset.lightroomId))]
      : settings?.excludedPhotoIds ?? [];
    return json({
      ok: true, revision, excludedPhotoIds, nextCursor: page.nextCursor,
      photos: page.photos.map(photo => {
        const { id, name, src } = photoLinks(album.id, photo, true);
        return { id, name, src };
      }),
    });
  } catch {
    return json({ ok: false, message: "写真一覧を取得できませんでした。" }, 503);
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!isStaff(locals.user)) return unauthorized(!!locals.user);
  const value = await request.json().catch(() => null);
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    !Array.isArray(value.excludedPhotoIds) || value.excludedPhotoIds.length > 5000 ||
    !value.excludedPhotoIds.every((id: unknown) => typeof id === "string" && validLightroomId(id)))
    return json({ ok: false, message: "公開しない写真を5,000枚以内で選択してください。" }, 400);
  const excludedPhotoIds = [...new Set<string>(value.excludedPhotoIds)];
  try {
    const album = await accessibleAlbum(params.id ?? "", locals.user);
    if (!album) return missing();
    if (exhibitionPhotoEntries(album.id, true)) {
      await updateExhibitionStore(data => {
        requireStaff(locals.user!.id);
        const exhibition = data.exhibitions.find(e => e.albumId === album.id && e.status !== "draft");
        if (!exhibition) throw new ExhibitionError("アルバムが見つかりません。", 404);
        if (exhibition.revision !== value.revision) throw new ExhibitionError(conflictMessage, 409);
        const photos = currentExhibitionPhotos(data, exhibition.id);
        const assetByPhotoId = new Map(photos.map(({ asset }) => [asset.lightroomId, asset.id]));
        const currentAssetIds = new Set(assetByPhotoId.values());
        const historical = (exhibition.albumExcludedAssetIds ?? []).filter(id => !currentAssetIds.has(id));
        const selected = excludedPhotoIds.map(id => {
          const asset = assetByPhotoId.get(id);
          if (!asset) throw new ExhibitionError("このアルバムにある最新の提出写真から選択してください。", 400);
          return asset;
        });
        exhibition.albumExcludedAssetIds = parseAlbumExclusions([...historical, ...selected], data, exhibition);
        exhibition.revision++;
        exhibition.updatedAt = new Date().toISOString();
      });
    } else {
      const settings = galleryAlbumSettings(album.id);
      if ((settings?.revision ?? 0) !== value.revision) return json({ ok: false, message: conflictMessage }, 409);
      const previouslyExcluded = new Set(settings?.excludedPhotoIds);
      const added = excludedPhotoIds.filter(id => !previouslyExcluded.has(id));
      if (!await galleryHasRemotePhotos(album.id, added)) return json({ ok: false, message: "このアルバムにある写真から選択してください。" }, 400);
      if (!await saveGallerySettings(album.id, value.revision, { excludedPhotoIds })) return json({ ok: false, message: conflictMessage }, 409);
    }
    return json({ ok: true });
  } catch (error) {
    if (error instanceof ExhibitionError) return json({ ok: false, message: error.message }, error.status);
    return json({ ok: false, message: "公開しない写真の設定を保存できませんでした。" }, 503);
  }
};

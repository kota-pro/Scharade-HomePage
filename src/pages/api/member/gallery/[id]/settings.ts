import type { APIRoute } from "astro";
import { isStaff } from "../../../../../lib/auth.ts";
import { accessibleAlbum } from "../../../../../lib/galleryAccess.ts";
import { galleryHasPhoto } from "../../../../../lib/galleryCatalog.ts";
import { saveGallerySettings } from "../../../../../lib/gallerySettings.ts";
import { json } from "../../../../../lib/http.ts";
import { validLightroomId } from "../../../../../lib/lightroom.ts";
import { galleryAlbumCategory, galleryAlbumName } from "../../../../../lib/galleryManagement.ts";
import { ContentManagementError } from "../../../../../lib/contentManagement.ts";

export const POST: APIRoute = async ({ request, params, locals }) => {
  if (!isStaff(locals.user) || locals.adminView?.readOnly) return json({ ok: false, message: "運営以上の権限が必要です。" }, locals.user ? 403 : 401);
  const value = await request.json().catch(() => null);
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    !["public", "members", "staff"].includes(value.visibility) ||
    (value.coverPhotoId !== null && (typeof value.coverPhotoId !== "string" || !validLightroomId(value.coverPhotoId))))
    return json({ ok: false, message: "公開範囲とカバー写真を確認してください。" }, 400);
  const albumId = params.id ?? "";
  try {
    const album = await accessibleAlbum(albumId, locals.user);
    if (!album) return json({ ok: false, message: "アルバムが見つかりません。" }, 404);
    const conflict = () => json({ ok: false, message: "別の画面で設定が変更されました。ページを再読み込みしてください。" }, 409);
    if (value.revision !== album.revision) return conflict();
    const fields = {
      ...(value.name === undefined ? {} : { name: galleryAlbumName(value.name) }),
      ...(value.category === undefined ? {} : { category: galleryAlbumCategory(value.category) }),
    };
    const { coverPhotoId, visibility } = value;
    if (coverPhotoId && coverPhotoId !== album.coverPhotoId && !await galleryHasPhoto(album.id, coverPhotoId))
      return json({ ok: false, message: "このアルバムに掲載されている写真を選択してください。" }, 400);
    const updatedVisibility = visibility === album.visibility ? {} : { visibility };
    if (!await saveGallerySettings(album.id, album.revision, { ...fields, ...updatedVisibility, coverPhotoId })) return conflict();
    return json({ ok: true, revision: album.revision + 1 });
  } catch (error) {
    if (error instanceof ContentManagementError) return json({ ok: false, message: error.message }, error.status);
    return json({ ok: false, message: "アルバム設定を保存できませんでした。時間をおいて再度お試しください。" }, 503);
  }
};

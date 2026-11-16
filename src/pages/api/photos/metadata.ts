import type { APIRoute } from "astro";
import { resolvePhoto, canEditPhoto, galleryPhotoEditorId } from "../../../lib/photos.ts";
import { parsePhotoMetadata } from "../../../lib/photoMetadata.ts";
import { saveGalleryWork, savePhotoMetadata } from "../../../lib/photoState.ts";
import { exhibitionPhotoEntries, exhibitionGalleryPlacement, galleryPlacementRevision, galleryWorkKey } from "../../../lib/galleryCatalog.ts";
import { json, HttpInputError } from "../../../lib/http.ts";
import { getUserFromRequest } from "../../../lib/auth.ts";

const updateMetadata: APIRoute = async ({ request, locals }) => {
  if (!locals.user?.approved) return json({ ok: false, message: "ログインが必要です。" }, 401);
  if (locals.adminView?.readOnly) return json({ ok: false, message: "表示確認は閲覧専用です。" }, 403);
  const payload = await request.json().catch(() => null);
  try {
    const photo = await resolvePhoto(payload?.ref, locals.user);
    if (!canEditPhoto(photo, locals.user)) return json({ ok: false, message: "この写真情報を編集する権限がありません。" }, 403);
    const metadata = parsePhotoMetadata(payload?.metadata);
    const album = photo.ref.containerId;
    const galleryTarget = () => {
      const local = photo.ref.source === "gallery" ? exhibitionPhotoEntries(album) : null;
      const entry = local?.entries.find(item => item.asset.lightroomId === photo.ref.imageId);
      return { local, entry };
    };
    const authorize = ({ local, entry } = galleryTarget()) => {
      const { user, adminView } = getUserFromRequest(request);
      if (local && !entry) throw new HttpInputError("作品の公開状態が変わりました。画面を開き直してください。", 409);
      const galleryEditorId = entry ? galleryPhotoEditorId(entry.submission) : undefined;
      if (adminView?.readOnly || !canEditPhoto({ ...photo, galleryEditorId }, user)) throw new HttpInputError("編集権限が変更されました。ログイン状態を確認してください。", 403);
    };
    if (payload.scope === "work") {
      const { entry } = galleryTarget();
      if (request.method !== "PATCH" || !entry || entry.work.kind === "single") throw new HttpInputError("編集する作品を選び直してください。", 400);
      const key = galleryWorkKey(album, entry);
      await saveGalleryWork(key, metadata, () => {
        const target = galleryTarget();
        authorize(target);
        if (!target.local || !target.entry || galleryWorkKey(album, target.entry) !== key) throw new HttpInputError("作品が変更されました。画面を開き直してください。", 409);
        if (payload.layout === undefined) return;
        const placement = exhibitionGalleryPlacement(album, target.local.entries, target.entry);
        if (!placement || galleryPlacementRevision(placement.frames) !== payload.layoutRevision) throw new HttpInputError("組写真の配置が変更されました。画面を開き直してください。", 409);
        return parseLayout(payload.layout, placement);
      });
    } else {
      if (payload.scope !== undefined || payload.layout !== undefined) throw new HttpInputError("編集する作品を選び直してください。", 400);
      await savePhotoMetadata([{ ref: photo.ref, metadata, merge: request.method === "PATCH" }], authorize);
    }
    return json(request.method === "PATCH" ? { ok: true, metadata } : { ok: true });
  } catch (error) { return json({ ok: false, message: error instanceof HttpInputError ? error.message : "写真情報の入力内容と公開状態を確認してください。" }, error instanceof HttpInputError ? error.status : 400); }
};
export const POST = updateMetadata;
export const PATCH = updateMetadata;

function parseLayout(input: unknown, placement: NonNullable<ReturnType<typeof exhibitionGalleryPlacement>>) {
  const expected = new Set(placement.frames.map(frame => frame.assetId));
  const validNumber = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  const invalid = () => new HttpInputError("写真の選択と、配置・サイズの数値を確認してください。", 400);
  if (!Array.isArray(input) || input.length !== expected.size) throw invalid();
  return input.map(frame => {
    if (!frame || !expected.delete(frame.assetId)) throw invalid();
    const { assetId, x, y, width, height, rotation } = frame;
    if (!validNumber(x, -1e6, 1e6) || !validNumber(y, -1e6, 1e6) || !validNumber(width, .1, 1e5) || !validNumber(height, .1, 1e5) || !validNumber(rotation, -360, 360)) throw invalid();
    return { assetId: String(assetId), x: x + placement.bounds.x, y: y + placement.bounds.y, width, height, rotation };
  });
}

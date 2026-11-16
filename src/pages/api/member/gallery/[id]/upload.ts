import { ContentManagementError, staffContentRoute } from "../../../../../lib/contentManagement.ts";
import { GALLERY_UPLOAD_LIMIT, uploadGalleryPhoto } from "../../../../../lib/galleryManagement.ts";
import { boundedFormData, json } from "../../../../../lib/http.ts";

export const POST = staffContentRoute(async ({ params, request, locals }) => {
  const form = await boundedFormData(request, GALLERY_UPLOAD_LIMIT + 65536);
  const file = form.get("file");
  if (!(file instanceof File) || [...form.keys()].length !== 1)
    throw new ContentManagementError("画像を1枚選択してください。");
  return json({ ok: true, id: await uploadGalleryPhoto(params.id ?? "", file, locals.user!) });
});

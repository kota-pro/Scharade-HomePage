import { ContentManagementError, managementBody, staffContentRoute } from "../../../../../lib/contentManagement.ts";
import { deleteGalleryAlbum } from "../../../../../lib/galleryManagement.ts";
import { json } from "../../../../../lib/http.ts";

export const DELETE = staffContentRoute(async ({ params, request, locals }) => {
  const { revision, confirmation } = await managementBody(request);
  if (confirmation !== "delete") throw new ContentManagementError("削除する内容を確認してください。");
  await deleteGalleryAlbum(params.id ?? "", revision, locals.user!);
  return json({ ok: true });
});

import { managementBody, staffContentRoute } from "../../../../lib/contentManagement.ts";
import { createGalleryAlbum } from "../../../../lib/galleryManagement.ts";
import { json } from "../../../../lib/http.ts";

export const POST = staffContentRoute(async ({ request, locals }) =>
  json({ ok: true, id: await createGalleryAlbum(await managementBody(request), locals.user!) }, 201),
);

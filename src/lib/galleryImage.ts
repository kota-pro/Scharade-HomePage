import type { APIContext } from "astro";
import { verifyGalleryValue } from "./galleryTokens.ts";
import { accessibleAlbum } from "./galleryAccess.ts";
import { fetchRendition } from "./lightroom.ts";
export async function galleryImage(context: APIContext, size: 640 | 2048) {
  // All renditions recheck album visibility. Never let a browser/proxy retain a
  // private image after logout or after a public album is made private.
  const headers = {
    "Cache-Control": "private, no-store",
    "Content-Type": "image/jpeg",
    "X-Content-Type-Options": "nosniff",
  };
  let claim;
  try {
    claim = verifyGalleryValue(
      context.url.searchParams.get("proof") ?? "",
      "photo",
    );
    if (claim.id !== context.params.id) throw new Error("Mismatched photo");
  } catch {
    return new Response(null, { status: 404, headers });
  }
  try {
    if (!(await accessibleAlbum(claim.album, context.locals.user)))
      return new Response(null, { status: 404, headers });
    const buffer = await fetchRendition(claim.id!, size);
    return new Response(buffer, { status: buffer ? 200 : 404, headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}

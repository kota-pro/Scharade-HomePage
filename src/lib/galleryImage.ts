import type { APIContext } from "astro";
import { verifyGalleryValue } from "./galleryTokens.ts";
import { accessibleAlbum } from "./galleryAccess.ts";
import { fetchRendition } from "./lightroom.ts";
import { exhibitionPhotoEntries, galleryCoverId } from "./galleryCatalog.ts";
import { dataPath } from "./store.ts";
import fs from "node:fs/promises";
import sharp from "sharp";
import { withImageSlot } from "./imageSecurity.ts";
import { cached } from "./cache.ts";
import { isStaff } from "./auth.ts";
import { galleryAlbumSettings } from "./gallerySettings.ts";

// Check access for every request, including requests made from a page left open
// before an album was restricted.
const imageHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Type": "image/jpeg",
  "X-Content-Type-Options": "nosniff",
};

async function galleryImageBytes(albumId: string, photoId: string, size: 320 | 640 | 2048, staffPreview?: true) {
  const local = exhibitionPhotoEntries(albumId, staffPreview);
  if (!local) {
    if (!staffPreview && galleryAlbumSettings(albumId)?.excludedPhotoIds?.includes(photoId)) return null;
    const rendition = await fetchRendition(photoId, size);
    return rendition ?? (size === 320 ? await fetchRendition(photoId, 640) : null);
  }
  const entry = local.entries.find(entry => entry.asset.lightroomId === photoId);
  if (!entry) return null;
  return cached(`exhibition-gallery:${entry.asset.sha256}:${size}`, () => withImageSlot(async () => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(entry.asset.id)) throw new Error("Invalid image ID");
    const original = await fs.readFile(dataPath(`exhibition-${entry.asset.id}.bin`));
    return sharp(original, { limitInputPixels: 60_000_000 }).timeout({ seconds: 20 }).rotate().resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  }), 60_000);
}

export async function galleryCover(context: APIContext) {
  const size = context.url.searchParams.get("size");
  if (size !== null && size !== "320" && size !== "640") return new Response(null, { status: 400, headers: imageHeaders });
  try {
    const album = await accessibleAlbum(context.params.id ?? "", context.locals.user);
    if (!album) return new Response(null, { status: 404, headers: imageHeaders });
    const id = await galleryCoverId(album);
    const buffer = id ? await galleryImageBytes(album.id, id, size === "320" ? 320 : 640) : null;
    if (buffer) return new Response(buffer, { headers: imageHeaders });
    return new Response(null, { status: 302, headers: { "Cache-Control": "private, no-store", Location: "/images/temp.png" } });
  } catch {
    return new Response(null, { status: 503, headers: imageHeaders });
  }
}

export async function galleryImage(context: APIContext, size: 640 | 2048) {
  let claim;
  try {
    claim = verifyGalleryValue(
      context.url.searchParams.get("proof") ?? "",
      "photo",
    );
    if (!claim.id || claim.id !== context.params.id || (claim.staffPreview && !isStaff(context.locals.user))) throw new Error("Invalid photo");
  } catch {
    return new Response(null, { status: 404, headers: imageHeaders });
  }
  try {
    if (!(await accessibleAlbum(claim.album, context.locals.user)))
      return new Response(null, { status: 404, headers: imageHeaders });
    const buffer = await galleryImageBytes(claim.album, claim.id, size, claim.staffPreview);
    return new Response(buffer, { status: buffer ? 200 : 404, headers: imageHeaders });
  } catch {
    return new Response(null, { status: 503, headers: imageHeaders });
  }
}

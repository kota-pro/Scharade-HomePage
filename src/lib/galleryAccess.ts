import { getGalleryAlbums, galleryAlbumAllowed } from "./galleryCatalog.ts";
import type { User } from "./auth.ts";
import { galleryAlbumSettings } from "./gallerySettings.ts";
export async function accessibleAlbum(id: string, user?: User | null) {
  if (galleryAlbumSettings(id)?.deletedAt) return null;
  const album = (await getGalleryAlbums()).find((album) => album.id === id);
  return album && galleryAlbumAllowed(album, user) ? album : null;
}

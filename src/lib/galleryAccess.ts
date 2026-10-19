import { getAlbums } from "./lightroom.ts";
import type { User } from "./auth.ts";
export async function accessibleAlbum(id: string, user?: User | null) {
  const album = (await getAlbums()).find((album) => album.id === id);
  return album && (!album.hidden || user?.approved) ? album : null;
}

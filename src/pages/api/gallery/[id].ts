import type { APIRoute } from "astro";
import { getAlbumPhotosPage } from "../../../lib/lightroom.ts";
import { accessibleAlbum } from "../../../lib/galleryAccess.ts";
import { photoLinks } from "../../../lib/galleryTokens.ts";
import { json } from "../../../lib/http.ts";
export const GET: APIRoute = async ({ params, url, locals }) => {
  try {
    const album = await accessibleAlbum(params.id ?? "", locals.user);
    if (!album) return json({ error: "アルバムが見つかりません。" }, 404);
    const cursor = url.searchParams.get("cursor");
    let page;
    try {
      page = await getAlbumPhotosPage(album.id, { cursor });
    } catch (error) {
      if (cursor)
        return json(
          {
            error:
              "読み込み位置が無効か期限切れです。ページを再読み込みしてください。",
          },
          400,
        );
      throw error;
    }
    return json({
      photos: page.photos.map((photo) => photoLinks(album.id, photo)),
      nextCursor: page.nextCursor,
    });
  } catch {
    return json(
      { error: "写真を取得できません。時間をおいて再度お試しください。" },
      503,
    );
  }
};

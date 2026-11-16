import type { APIRoute } from "astro";
import { isAdmin } from "../../../lib/auth.ts";
import { getHomePhotoCatalog } from "../../../lib/homePhotos.ts";
import { json } from "../../../lib/http.ts";
import { optimizeMicrocmsImage } from "../../../utils/microcmsImage.ts";

export const GET: APIRoute = async ({ locals }) => {
  if (!isAdmin(locals.user)) return json({ ok: false, message: "管理者権限が必要です。" }, 403);
  try {
    const photos = (await getHomePhotoCatalog()).map(photo => ({
      ...photo, url: optimizeMicrocmsImage(photo.url, { width: 480, quality: 70 }),
    }));
    return json({ ok: true, photos });
  } catch {
    return json({ ok: false, message: "写真一覧を取得できませんでした。時間をおいて再読み込みしてください。" }, 503);
  }
};

import type { APIRoute } from "astro";
import { isExecutive } from "../../../lib/auth.ts";
import { getPhotoRanking, PhotoRankingError } from "../../../lib/photoRanking.ts";
import { json } from "../../../lib/http.ts";

export const GET: APIRoute = async ({ locals, url }) => {
  if (!isExecutive(locals.user)) return json({ ok: false }, 403);
  const page = url.searchParams.get("page") ?? "1";
  if (!/^[1-9]\d{0,5}$/.test(page)) return json({ ok: false, message: "ページ番号を確認してください。" }, 400);
  try {
    return json({ ok: true, ...await getPhotoRanking(locals.user!, url.searchParams.get("container") ?? "", Number(page)) });
  } catch (error) {
    if (error instanceof PhotoRankingError) return json({ ok: false, message: error.message }, error.status);
    return json({ ok: false, message: "ランキングを取得できませんでした。時間をおいて再度お試しください。" }, 503);
  }
};

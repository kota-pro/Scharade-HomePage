import type { APIRoute } from "astro";
import { resolvePhoto, photoPageUrl } from "../../../lib/photos.ts";
import { unreadPhotoGroups, readPhotoNotifications } from "../../../lib/photoState.ts";
import { json } from "../../../lib/http.ts";
export const GET: APIRoute = async ({ locals }) => {
  if (!locals.user?.approved) return json({ ok: false, message: "ログインが必要です。" }, 401);
  const groups = unreadPhotoGroups(locals.user.id);
  const notifications = await Promise.all(groups.map(async group => {
    try {
      const photo = await resolvePhoto(group.ref, locals.user, true);
      if (photo.ownerId !== locals.user!.id) throw new Error("Ownership changed");
      const url = new URL(photoPageUrl(photo.portfolioRef ?? photo.ref), "https://photo.invalid");
      url.searchParams.set("notice", group.key); url.searchParams.set("through", String(group.through));
      return { key: group.key, title: photo.title || "写真", count: group.count, likers: group.likers, src: photo.src, href: url.pathname + url.search, at: group.at, through: group.through };
    } catch { return { key: group.key, title: "現在表示できない写真", count: group.count, likers: group.likers, href: "", src: "", at: group.at, through: group.through }; }
  }));
  return json({ ok: true, unread: groups.length, notifications });
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user?.approved) return json({ ok: false, message: "ログインが必要です。" }, 401);
  const payload = await request.json().catch(() => null);
  if (!payload || !["all", "photo"].includes(payload.action) || (payload.action === "photo" && (typeof payload.key !== "string" || payload.key.length > 300 || !Number.isSafeInteger(payload.through)))) return json({ ok: false, message: "通知の操作を確認してください。" }, 400);
  try {
    const unread = await readPhotoNotifications(locals.user.id, payload.action === "photo" ? payload.key : undefined, payload.through);
    return json({ ok: true, unread });
  } catch { return json({ ok: false, message: "既読にできませんでした。時間をおいて再度お試しください。" }, 503); }
};

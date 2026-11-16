import type { APIRoute } from "astro";
import { resolvePhoto } from "../../../lib/photos.ts";
import { photoView, setPhotoLike } from "../../../lib/photoState.ts";
import { photoVisitor } from "../../../lib/photoVisitor.ts";
import { json } from "../../../lib/http.ts";
export const POST: APIRoute = async context => {
  const payload = await context.request.json().catch(() => null);
  if (typeof payload?.liked !== "boolean") return json({ ok: false, message: "いいねの操作を確認してください。" }, 400);
  try {
    const photo = await resolvePhoto(payload.ref, context.locals.user), visitor = photoVisitor(context);
    const data = await setPhotoLike(photo, visitor, payload.liked, context.locals.user);
    return json({ ok: true, photo: photoView(photo, context.locals.user, visitor, data) });
  } catch { return json({ ok: false, message: "いいねを変更できませんでした。写真の公開状態を確認して再度お試しください。" }, 409); }
};

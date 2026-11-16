import type { APIRoute } from "astro";
import { resolvePhoto } from "../../../lib/photos.ts";
import { photoView } from "../../../lib/photoState.ts";
import { photoVisitor } from "../../../lib/photoVisitor.ts";
import { json } from "../../../lib/http.ts";
export const POST: APIRoute = async context => {
  const payload = await context.request.json().catch(() => null);
  if (!Array.isArray(payload?.refs) || payload.refs.length > 100) return json({ ok: false, message: "写真を100枚以内で指定してください。" }, 400);
  const visitor = photoVisitor(context, false);
  const results = await Promise.all(payload.refs.map(async (ref: unknown) => {
    try {
      const resolved = await resolvePhoto(ref, context.locals.user, payload.details === true && payload.refs.length === 1);
      const view = photoView(resolved, context.locals.user, visitor);
      return { ok: true, photo: resolved.galleryEdit && !context.locals.adminView?.readOnly ? { ...view, galleryEdit: resolved.galleryEdit } : view };
    }
    catch { return { ok: false, message: "写真は削除されたか、現在の公開範囲では表示できません。" }; }
  }));
  return json({ ok: true, results });
};

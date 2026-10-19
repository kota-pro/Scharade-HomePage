import type { APIRoute } from "astro";
import { isAdmin } from "../../../../lib/auth.ts";
import {
  isPageKey,
  contentDocument,
  changeContent,
  ContentConflict,
} from "../../../../lib/siteContent.ts";
import { json } from "../../../../lib/http.ts";

export const GET: APIRoute = async ({ locals, params }) => {
  if (!isAdmin(locals.user)) return json({ ok: false }, 403);
  if (!params.key || !isPageKey(params.key)) return json({ ok: false }, 404);
  return json({ ok: true, document: contentDocument(params.key) });
};
export const POST: APIRoute = async ({ request, locals, params }) => {
  if (!isAdmin(locals.user)) return json({ ok: false }, 403);
  if (!params.key || !isPageKey(params.key)) return json({ ok: false }, 404);
  const body = await request.json().catch(() => null);
  if (
    !body ||
    !["save", "publish", "restore"].includes(body.action) ||
    !Number.isInteger(body.revision)
  )
    return json({ ok: false, message: "入力形式が正しくありません。" }, 400);
  try {
    const document = await changeContent(
      params.key,
      body.action,
      body.revision,
      body.data,
      locals.user!.id,
    );
    return json({ ok: true, document });
  } catch (error) {
    return json(
      { ok: false, message: (error as Error).message },
      error instanceof ContentConflict ? 409 : 400,
    );
  }
};

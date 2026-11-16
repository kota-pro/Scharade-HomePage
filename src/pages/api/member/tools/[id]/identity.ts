import type { APIRoute } from "astro";
import { json } from "../../../../../lib/http.ts";
import { identityFor, ToolError } from "../../../../../lib/memberTools.ts";
export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user?.approved)
    return json({ ok: false, message: "ログインが必要です。" }, 401);
  try {
    const p = await request.json();
    return json({
      ok: true,
      ...(await identityFor(params.id!, p.responseId, locals.user)),
    });
  } catch (e) {
    return json(
      {
        ok: false,
        message:
          e instanceof ToolError ? e.message : "名前を確認できませんでした。",
      },
      e instanceof ToolError ? e.status : 503,
    );
  }
};

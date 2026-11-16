import type { APIRoute } from "astro";
import { json } from "../../../../lib/http.ts";
import { isStaff } from "../../../../lib/roles.ts";
import {
  createTool,
  listTools,
  ToolError,
} from "../../../../lib/memberTools.ts";
export const GET: APIRoute = ({ locals }) => {
  if (!isStaff(locals.user))
    return json({ ok: false, message: "運営以上の権限が必要です。" }, 403);
  return json({
    ok: true,
    tools: listTools().map((t) => {
      return {
        id: t.id,
        question: t.question,
        kind: t.kind,
        status: t.status,
        updatedAt: t.updatedAt,
      };
    }),
  });
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!isStaff(locals.user))
    return json({ ok: false, message: "運営以上の権限が必要です。" }, 403);
  try {
    const p = await request.json();
    const t = await createTool(locals.user!, p.kind);
    return json({ ok: true, id: t.id });
  } catch (e) {
    return json(
      {
        ok: false,
        message: e instanceof ToolError ? e.message : "作成できませんでした。",
      },
      e instanceof ToolError ? e.status : 400,
    );
  }
};

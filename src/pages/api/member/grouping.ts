import type { APIRoute } from "astro";
import { groupingToolAction } from "../../../lib/groupingTools.ts";
import { ActivityError } from "../../../lib/activities.ts";
import { isStaff } from "../../../lib/auth.ts";
import { json } from "../../../lib/http.ts";
export const POST: APIRoute = async ({ locals, request }) => {
  if (!isStaff(locals.user))
    return json(
      { ok: false, message: "運営以上の権限が必要です。" },
      locals.user ? 403 : 401,
    );
  try {
    return json(
      await groupingToolAction(
        locals.user!.id,
        await request.json().catch(() => null),
      ),
    );
  } catch (error) {
    if (error instanceof ActivityError)
      return json({ ok: false, message: error.message }, error.status);
    console.error("[grouping-tool] request failed");
    return json(
      {
        ok: false,
        message: "保存できませんでした。時間をおいて再度お試しください。",
      },
      503,
    );
  }
};

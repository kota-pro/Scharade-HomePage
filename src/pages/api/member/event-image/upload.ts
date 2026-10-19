import type { APIRoute } from "astro";
import { getUserFromRequest, isStaff } from "../../../../lib/auth.ts";
import { json } from "../../../../lib/http.ts";
import { POST as upload } from "../../portfolio/upload.ts";

export const POST: APIRoute = async (context) => {
  const { user } = getUserFromRequest(context.request);
  if (!user?.approved)
    return json({ ok: false, message: "ログインが必要です。" }, 401);
  if (!isStaff(user))
    return json({ ok: false, message: "運営以上の権限が必要です。" }, 403);
  return upload(context);
};

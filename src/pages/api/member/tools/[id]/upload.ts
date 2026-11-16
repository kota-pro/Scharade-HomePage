import type { APIRoute } from "astro";
import {
  boundedFormData,
  HttpInputError,
  json,
} from "../../../../../lib/http.ts";
import { ToolError } from "../../../../../lib/memberTools.ts";
import { saveToolAsset } from "../../../../../lib/memberToolAssets.ts";
export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user?.approved)
    return json({ ok: false, message: "ログインが必要です。" }, 401);
  try {
    const p = await boundedFormData(request, 21 * 1024 * 1024),
      file = p.get("file");
    if (!(file instanceof File))
      throw new ToolError("ファイルを選んでください。");
    const purpose = p.get("purpose");
    if (purpose !== "option" && purpose !== "response")
      throw new ToolError("添付先を確認してください。");
    return json({
      ok: true,
      asset: await saveToolAsset(params.id!, locals.user, file, purpose),
    });
  } catch (e) {
    return json(
      {
        ok: false,
        message:
          e instanceof ToolError || e instanceof HttpInputError
            ? e.message
            : "アップロードできませんでした。",
      },
      e instanceof ToolError || e instanceof HttpInputError ? e.status : 503,
    );
  }
};

import type { APIRoute } from "astro";
import { exhibitionUploadForm, uploadExhibitionAsset } from "../../../../lib/exhibitions.ts";
import { ExhibitionError } from "../../../../lib/exhibitionValidation.ts";
import { json } from "../../../../lib/http.ts";

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const form = await exhibitionUploadForm(request);
    if ([...form.keys()].some(key => !["token", "assetId", "file"].includes(key)) || form.getAll("token").length !== 1 || form.getAll("assetId").length !== 1 || form.getAll("file").length !== 1) throw new ExhibitionError("添付内容を確認してください。");
    const token = form.get("token"), assetId = form.get("assetId"), file = form.get("file");
    if (typeof token !== "string" || typeof assetId !== "string" || !(file instanceof File)) throw new ExhibitionError("写真を選んでください。");
    return json(await uploadExhibitionAsset(params.id ?? "", token, assetId, file, locals.user?.id));
  } catch (error) {
    if (error instanceof ExhibitionError) return json({ ok: false, message: error.message }, error.status);
    console.error("[exhibition-upload] request failed");
    return json({ ok: false, message: "写真を保存できませんでした。同じ写真でもう一度お試しください。" }, 503);
  }
};

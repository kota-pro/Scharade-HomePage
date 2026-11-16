import type { APIRoute } from "astro";
import { exhibitionUploadForm, uploadExhibitionAsset } from "../../../../lib/exhibitions.ts";
import { ExhibitionError, exhibitionErrorBody } from "../../../../lib/exhibitionValidation.ts";
import { json } from "../../../../lib/http.ts";

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const form = await exhibitionUploadForm(request);
    if ([...form.keys()].some(key => !["token", "assetId", "file", "ownerId", "submissionId"].includes(key)) || form.getAll("token").length !== 1 || form.getAll("assetId").length !== 1 || form.getAll("file").length !== 1 || form.getAll("ownerId").length > 1 || form.getAll("submissionId").length > 1) throw new ExhibitionError("添付内容を確認してください。");
    const token = form.get("token"), assetId = form.get("assetId"), file = form.get("file");
    if (typeof token !== "string" || typeof assetId !== "string" || !(file instanceof File)) throw new ExhibitionError("写真を選んでください。");
    if (form.has("ownerId") && form.get("ownerId") !== locals.user?.id) throw new ExhibitionError("ログイン中のアカウントが変わりました。元のアカウントでログインし直してください。", 401);
    const submissionId = form.get("submissionId");
    if (submissionId !== null && typeof submissionId !== "string") throw new ExhibitionError("提出先を確認してください。");
    return json(await uploadExhibitionAsset(params.id ?? "", token, assetId, file, locals.user?.id, submissionId ?? undefined));
  } catch (error) {
    if (error instanceof ExhibitionError) return json(exhibitionErrorBody(error), error.status);
    console.error("[exhibition-upload] request failed");
    return json(exhibitionErrorBody(error, "EXH-015"), 503);
  }
};

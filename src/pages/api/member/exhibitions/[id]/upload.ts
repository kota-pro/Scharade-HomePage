import type { APIRoute } from "astro";
import { isStaff } from "../../../../../lib/auth.ts";
import {
  exhibitionUploadForm,
  uploadStaffExhibitionAsset,
} from "../../../../../lib/exhibitions.ts";
import { ExhibitionError, exhibitionErrorBody } from "../../../../../lib/exhibitionValidation.ts";
import { json } from "../../../../../lib/http.ts";
export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!isStaff(locals.user))
    return json(
      { ok: false, message: "運営以上の権限が必要です。" },
      locals.user ? 403 : 401,
    );
  try {
    const form = await exhibitionUploadForm(request),
      keys = [
        "submissionId",
        "revision",
        "exhibitionRevision",
        "assetId",
        "file",
      ];
    if (
      [...form.keys()].some((k) => !keys.includes(k)) ||
      keys.some((k) => form.getAll(k).length !== 1)
    )
      throw new ExhibitionError("添付内容を確認してください。");
    const submissionId = form.get("submissionId"),
      assetId = form.get("assetId"),
      file = form.get("file");
    const revision = Number(form.get("revision")),
      exhibitionRevision = Number(form.get("exhibitionRevision"));
    if (
      typeof submissionId !== "string" ||
      typeof assetId !== "string" ||
      !(file instanceof File) ||
      !Number.isInteger(revision) ||
      !Number.isInteger(exhibitionRevision)
    )
      throw new ExhibitionError("写真と提出先を確認してください。");
    return json(
      await uploadStaffExhibitionAsset(
        params.id ?? "",
        { submissionId, revision, exhibitionRevision },
        assetId,
        file,
        locals.user!.id,
      ),
    );
  } catch (error) {
    if (error instanceof ExhibitionError)
      return json(exhibitionErrorBody(error), error.status);
    console.error("[exhibition-staff-upload] request failed");
    return json(
      {
        ok: false,
        message: "写真を保存できませんでした。もう一度お試しください。",
      },
      503,
    );
  }
};

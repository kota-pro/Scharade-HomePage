import { parseBodyMediaScope, stageBodyAsset } from "../../../../lib/bodyMedia.ts";
import { bodyMediaLimit, validateBodyUpload } from "../../../../lib/bodyMediaUpload.ts";
import { ContentManagementError, staffContentRoute } from "../../../../lib/contentManagement.ts";
import { boundedFormData, json } from "../../../../lib/http.ts";

export const POST = staffContentRoute(async ({ request, locals }) => {
  const data = await boundedFormData(request, bodyMediaLimit + 65536);
  const file = data.get("file"), kind = data.get("kind"), raw = data.get("scope");
  if (!(file instanceof File) || (kind !== "image" && kind !== "file") ||
      typeof raw !== "string" || [...data.keys()].length !== 3)
    throw new ContentManagementError("添付するファイルと本文を確認してください。");
  let scope;
  try { scope = parseBodyMediaScope(JSON.parse(raw)); }
  catch { throw new ContentManagementError("添付先を確認してください。"); }
  const { file: validated, bytes, width, height } = await validateBodyUpload(file, kind);
  return json({ ok: true, url: stageBodyAsset(scope, locals.user!.id, validated, kind, bytes), width, height });
});

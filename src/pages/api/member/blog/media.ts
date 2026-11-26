import { isBlogAttachment, listBlogMedia, uploadBlogMedia } from "../../../../lib/blogManagement.ts";
import { ContentManagementError, memberContentRoute, staffContentRoute } from "../../../../lib/contentManagement.ts";
import { bodyMediaLimit, validateBodyUpload } from "../../../../lib/bodyMediaUpload.ts";
import { boundedFormData, json } from "../../../../lib/http.ts";

export const GET = staffContentRoute(async ({ url }) => json({
  ok: true,
  ...await listBlogMedia(url.searchParams.get("q") ?? "", url.searchParams.get("token") ?? "", url.searchParams.get("kind") !== "file"),
}));

export const POST = memberContentRoute(async ({ request }) => {
  const form = await boundedFormData(request, bodyMediaLimit + 65536);
  const file = form.get("file");
  const kind = form.get("kind");
  if (!(file instanceof File) || !file.size || (kind !== "image" && kind !== "file") || [...form.keys()].length !== 2)
    throw new ContentManagementError("ファイルを1つ選択してください。");
  const { file: validated, width, height } = await validateBodyUpload(file, kind);
  const url = await uploadBlogMedia(validated);
  if (kind === "file" && !isBlogAttachment(url))
    throw new ContentManagementError("保存したファイルのURLを確認できませんでした。", 503);
  return json({ ok: true, url, width, height });
});

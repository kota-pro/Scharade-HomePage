import sharp from "sharp";
import { isBlogAttachment, listBlogMedia, uploadBlogMedia } from "../../../../lib/blogManagement.ts";
import { ContentManagementError, staffContentRoute } from "../../../../lib/contentManagement.ts";
import { boundedFormData, json } from "../../../../lib/http.ts";
import { ImageBusyError, imageSignature, withImageSlot } from "../../../../lib/imageSecurity.ts";

const mediaLimit = 5_000_000;
const attachmentTypes: Record<string, string> = {
  pdf: "application/pdf", zip: "application/zip", txt: "text/plain", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg", mp4: "video/mp4",
};

export const GET = staffContentRoute(async ({ url }) => json({
  ok: true,
  ...await listBlogMedia(url.searchParams.get("q") ?? "", url.searchParams.get("token") ?? "", url.searchParams.get("kind") !== "file"),
}));

export const POST = staffContentRoute(async ({ request }) => {
  const form = await boundedFormData(request, mediaLimit + 65536);
  const file = form.get("file");
  const kind = form.get("kind");
  if (!(file instanceof File) || !file.size || (kind !== "image" && kind !== "file") || [...form.keys()].length !== 2)
    throw new ContentManagementError("ファイルを1つ選択してください。");
  if (file.size > mediaLimit) throw new ContentManagementError("ファイルは5MB以下にしてください。", 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 140);
  if (kind === "image") {
    const format = imageSignature(bytes);
    if (!format) throw new ContentManagementError("JPEG・PNG・WebP画像を選択してください。");
    let info;
    try { info = await withImageSlot(() => sharp(bytes, { limitInputPixels: 60_000_000 }).timeout({ seconds: 10 }).metadata()); }
    catch (error) { if (error instanceof ImageBusyError) throw error; throw new ContentManagementError("破損した画像は添付できません。"); }
    if (info.format !== format || !info.width || !info.height || info.width * info.height > 60_000_000 || (info.pages ?? 1) !== 1)
      throw new ContentManagementError("画像のサイズを確認してください。");
    const url = await uploadBlogMedia(new File([new Uint8Array(bytes)], `${name.replace(/\.[^.]*$/, "") || "photo"}.${format}`, { type: `image/${format}` }));
    const rotated = (info.orientation ?? 1) >= 5;
    return json({ ok: true, url, width: rotated ? info.height : info.width, height: rotated ? info.width : info.height });
  }
  const ext = name.toLowerCase().split(".").at(-1) ?? "";
  const type = Object.hasOwn(attachmentTypes, ext) && attachmentTypes[ext];
  if (!type || !name.includes(".")) throw new ContentManagementError("PDF、Office文書、ZIP、テキスト、MP3、MP4を選択してください。");
  const url = await uploadBlogMedia(new File([new Uint8Array(bytes)], name, { type }));
  if (!isBlogAttachment(url)) throw new ContentManagementError("保存したファイルのURLを確認できませんでした。", 503);
  return json({ ok: true, url });
});

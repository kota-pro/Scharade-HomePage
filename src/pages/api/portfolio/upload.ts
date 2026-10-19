import type { APIRoute } from "astro";
import { getUserFromRequest } from "../../../lib/auth.ts";
import sharp from "sharp";
import { fetchWithTimeout, boundedFormData, HttpInputError } from "../../../lib/http.ts";
import { imageSignature, withImageSlot, ImageBusyError } from "../../../lib/imageSecurity.ts";
import { safeMediaUrl } from "../../../lib/contentSecurity.ts";
import { env } from "../../../lib/config.ts";


const buildUploadUrl = (serviceId: string) =>
  `https://${serviceId}.microcms-management.io/api/v1/media`;

export const POST: APIRoute = async ({ request }) => {
  const SERVICE_DOMAIN = env("MICROCMS_SERVICE_DOMAIN"), MANAGEMENT_API_KEY = env("MICROCMS_SERVER_API_KEY");
  if (!SERVICE_DOMAIN || !MANAGEMENT_API_KEY) {
    return jsonResponse(
      {
        ok: false,
        message: "画像の保存先を利用できません。管理者にお問い合わせください。",
      },
      503,
    );
  }

  const { user } = getUserFromRequest(request);
  if (!user) {
    return jsonResponse(
      { ok: false, message: "Authentication required." },
      401,
    );
  }

  if (!user.approved) {
    return jsonResponse(
      { ok: false, message: "Your account is pending approval." },
      403,
    );
  }

  let formData: FormData;
  try { formData = await boundedFormData(request, 20 * 1024 * 1024 + 65536); }
  catch (error) { return jsonResponse({ ok: false, message: "画像の送信内容を確認してください。" }, error instanceof HttpInputError ? error.status : 400); }
  if ([...formData.keys()].some(key => key !== "file") || formData.getAll("file").length !== 1) return jsonResponse({ ok: false, message: "画像を1枚選んでください。" }, 400);
  const fileEntry = formData.get("file");

  if (!fileEntry) {
    return jsonResponse({ ok: false, message: "No file provided." }, 400);
  }

  const fileLike =
    typeof File !== "undefined" && fileEntry instanceof File
      ? fileEntry
      : fileEntry instanceof Blob
        ? fileEntry
        : null;

  if (!fileLike) {
    return jsonResponse(
      { ok: false, message: "Uploaded data is not a valid file." },
      400,
    );
  }

  const mime = (fileLike as any).type ? String((fileLike as any).type) : "";
  if (mime && !mime.startsWith("image/")) {
    return jsonResponse(
      { ok: false, message: "Only image files are allowed." },
      400,
    );
  }

  if (fileLike.size > 20 * 1024 * 1024)
    return jsonResponse(
      { ok: false, message: "画像は20MB以下でアップロードしてください。" },
      413,
    );

  let optimizedBuffer: Buffer;
  try {
    const bytes = Buffer.from(await fileLike.arrayBuffer());
    if (!imageSignature(bytes)) throw new Error("format");
    optimizedBuffer = await withImageSlot(async () => {
      const image = sharp(bytes, {
      limitInputPixels: 60_000_000,
      failOn: "error",
    }).timeout({ seconds: 20 });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new Error("format");
      return image
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    });
  } catch (error) {
    if (error instanceof ImageBusyError) return jsonResponse({ ok: false, message: error.message }, error.status);
    return jsonResponse(
      {
        ok: false,
        message: "空でないJPEG・PNG・WebP画像を選んでください。破損・複数フレーム・6000万画素を超える画像は添付できません。",
      },
      400,
    );
  }

  const uploadData = new FormData();
  const originalName =
    typeof File !== "undefined" && fileLike instanceof File
      ? fileLike.name
      : "upload";
  const fileName = `${originalName.replace(/\.[^.]+$/, "").replace(/[\x00-\x1f\x7f/\\<>]/g, "_").slice(0, 120) || "upload"}.webp`;
  uploadData.append(
    "file",
    new Blob([new Uint8Array(optimizedBuffer).buffer], { type: "image/webp" }),
    fileName,
  );

  let response: Response;
  const targetUrl = buildUploadUrl(SERVICE_DOMAIN);

  try {
    response = await fetchWithTimeout(targetUrl, {
      method: "POST",
      headers: {
        "X-MICROCMS-API-KEY": MANAGEMENT_API_KEY,
      },
      body: uploadData,
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: "画像の保存先に接続できませんでした。再度お試しください。",
      },
      502,
    );
  }

  if (!response.ok) {
    console.error(`[upload] microCMS status: ${response.status}`);
    return jsonResponse(
      {
        ok: false,
        message: "画像を保存できませんでした。管理者にお問い合わせください。",
      },
      502,
    );
  }

  const data = await response.json().catch(() => null);
  const uploadUrl =
    data && typeof data === "object" && "url" in data
      ? (data as any).url
      : null;

  if (!uploadUrl || typeof uploadUrl !== "string") {
    return jsonResponse(
      { ok: false, message: "microCMS did not return an upload URL." },
      500,
    );
  }

  if (!safeMediaUrl(uploadUrl)) {
    return jsonResponse(
      { ok: false, message: "microCMS returned a non-HTTPS upload URL." },
      500,
    );
  }

  return jsonResponse({ ok: true, url: uploadUrl });
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

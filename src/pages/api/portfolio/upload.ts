import type { APIRoute } from "astro";
import { getUserFromRequest } from "../../../lib/auth.ts";
import sharp from "sharp";
import { extractPhotoExif } from "../../../lib/photoExif.ts";
import { fetchWithTimeout, boundedFormData, HttpInputError, json } from "../../../lib/http.ts";
import { imageSignature, withImageSlot, ImageBusyError } from "../../../lib/imageSecurity.ts";
import { safeMediaUrl } from "../../../lib/contentSecurity.ts";
import { env } from "../../../lib/config.ts";
import { PORTFOLIO_PHOTO_SAVE_LIMIT, PORTFOLIO_UPLOAD_LIMIT } from "../../../types/portfolioUpload.ts";
import { encodePortfolioUpload } from "../../../lib/portfolioImage.ts";


const buildUploadUrl = (serviceId: string) =>
  `https://${serviceId}.microcms-management.io/api/v1/media`;

const processingTimedOut = () => json({
  ok: false,
  message: "画像の処理に時間がかかったため、まだ保存していません。画像を縮小してから、もう一度お試しください。",
}, 408);

const unknownSaveResult = () => json({ ok: false, errorCode: "SITE-009" }, 502);

// A running native encode retains its processing slot until it finishes.
// Only race the local work, so a timeout here cannot leave a pending write.
async function untilAborted<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([aborted, work()]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export const POST: APIRoute = async ({ request }) => {
  const SERVICE_DOMAIN = env("MICROCMS_SERVICE_DOMAIN"), MANAGEMENT_API_KEY = env("MICROCMS_SERVER_API_KEY");
  if (!SERVICE_DOMAIN || !MANAGEMENT_API_KEY) {
    return json(
      {
        ok: false,
        message: "画像の保存先を利用できません。管理者にお問い合わせください。",
      },
      503,
    );
  }

  const { user } = getUserFromRequest(request);
  if (!user) {
    return json(
      { ok: false, message: "Authentication required." },
      401,
    );
  }

  if (!user.approved) {
    return json(
      { ok: false, message: "Your account is pending approval." },
      403,
    );
  }

  // Leave time to return a JSON response before nginx's 60-second deadline.
  const deadline = AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]);
  let formData: FormData;
  try { formData = await boundedFormData(request, PORTFOLIO_UPLOAD_LIMIT + 65536); }
  catch (error) { return json({ ok: false, message: "画像の送信内容を確認してください。" }, error instanceof HttpInputError ? error.status : 400); }
  if ([...formData.keys()].some(key => key !== "file") || formData.getAll("file").length !== 1) return json({ ok: false, message: "画像を1枚選んでください。" }, 400);
  const fileEntry = formData.get("file");

  if (!fileEntry) {
    return json({ ok: false, message: "No file provided." }, 400);
  }

  const fileLike =
    typeof File !== "undefined" && fileEntry instanceof File
      ? fileEntry
      : fileEntry instanceof Blob
        ? fileEntry
        : null;

  if (!fileLike) {
    return json(
      { ok: false, message: "Uploaded data is not a valid file." },
      400,
    );
  }

  const mime = (fileLike as any).type ? String((fileLike as any).type) : "";
  if (mime && !mime.startsWith("image/")) {
    return json(
      { ok: false, message: "Only image files are allowed." },
      400,
    );
  }

  if (fileLike.size > PORTFOLIO_UPLOAD_LIMIT)
    return json(
      { ok: false, message: "画像は20MB以下でアップロードしてください。" },
      413,
    );

  let optimizedBuffer: Buffer;
  let photoMetadata = {};
  const url = new URL(request.url);
  const portfolio = url.pathname.replace(/\/$/, "") === "/api/portfolio/upload";
  const processingDeadline = AbortSignal.any([deadline, AbortSignal.timeout(30_000)]);
  try {
    const bytes = Buffer.from(await fileLike.arrayBuffer());
    if (!imageSignature(bytes)) throw new Error("format");
    const processed = await untilAborted(processingDeadline, () => withImageSlot(async () => {
      processingDeadline.throwIfAborted();
      const image = sharp(bytes, {
        limitInputPixels: 60_000_000,
        failOn: "error",
      }).timeout({ seconds: 20 });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new Error("format");
      processingDeadline.throwIfAborted();
      image.rotate();
      let data: Buffer;
      if (portfolio) {
        data = await encodePortfolioUpload(image, metadata.width, metadata.height, processingDeadline);
      } else {
        const standard = await image.clone()
          .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78, effort: 4 })
          .toBuffer();
        data = standard.length <= PORTFOLIO_PHOTO_SAVE_LIMIT ? standard : await encodePortfolioUpload(image, 2400, 2400, processingDeadline);
      }
      processingDeadline.throwIfAborted();
      return { data, exif: await extractPhotoExif(bytes) };
    }));
    optimizedBuffer = processed.data;
    photoMetadata = processed.exif;
  } catch (error) {
    if (processingDeadline.aborted || (error instanceof Error && /timeout|timed out/i.test(error.message))) {
      console.warn("[upload] image processing timed out before save");
      return processingTimedOut();
    }
    if (error instanceof ImageBusyError) return json({ ok: false, message: error.message }, error.status);
    return json(
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

  if (processingDeadline.aborted) return processingTimedOut();
  const saveDeadline = AbortSignal.any([deadline, AbortSignal.timeout(portfolio ? 20_000 : 8_000)]);
  try {
    const response = await fetchWithTimeout(buildUploadUrl(SERVICE_DOMAIN), {
      method: "POST",
      headers: {
        "X-MICROCMS-API-KEY": MANAGEMENT_API_KEY,
      },
      body: uploadData,
      signal: saveDeadline,
    });
    if (!response.ok) {
      console.error(`[upload] microCMS status: ${response.status}`);
      void response.body?.cancel().catch(() => {});
      if (response.status >= 500 || response.status === 408) return unknownSaveResult();
      return json({
        ok: false,
        message: "microCMSが画像の保存を受け付けませんでした。",
      }, 502);
    }
    const data: unknown = await response.json();
    const uploadUrl = data && typeof data === "object" && "url" in data ? data.url : null;
    if (typeof uploadUrl !== "string" || !safeMediaUrl(uploadUrl)) {
      console.error("[upload] microCMS returned no usable image URL");
      return unknownSaveResult();
    }
    return json({ ok: true, url: uploadUrl, photoMetadata });
  } catch {
    console.error("[upload] microCMS save result unavailable");
    return unknownSaveResult();
  }
};

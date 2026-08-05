import type { APIRoute } from "astro";
import { getUserFromRequest } from "../../../lib/auth";
import sharp from "sharp";

const SERVICE_DOMAIN =
  (import.meta as any).env?.MICROCMS_SERVICE_DOMAIN ??
  process.env.MICROCMS_SERVICE_DOMAIN;
const MANAGEMENT_API_KEY =
  (import.meta as any).env?.MICROCMS_MANAGEMENT_API_KEY ??
  process.env.MICROCMS_MANAGEMENT_API_KEY ??
  (import.meta as any).env?.MICROCMS_API_KEY ??
  process.env.MICROCMS_API_KEY;

const CONTENT_API_KEY =
  (import.meta as any).env?.MICROCMS_API_KEY ?? process.env.MICROCMS_API_KEY;

const buildUploadUrl = (serviceId: string) =>
  `https://${serviceId}.microcms-management.io/api/v1/media`;

export const POST: APIRoute = async ({ request }) => {
  if (!SERVICE_DOMAIN || !MANAGEMENT_API_KEY) {
    const missing = [
      !SERVICE_DOMAIN ? "MICROCMS_SERVICE_DOMAIN" : null,
      !MANAGEMENT_API_KEY
        ? "MICROCMS_MANAGEMENT_API_KEY (or MICROCMS_API_KEY fallback)"
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    return jsonResponse(
      {
        ok: false,
        message: `Server misconfigured. Missing microCMS credentials: ${missing}.`,
      },
      500,
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

  const formData = await request.formData();
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

  let optimizedBuffer: Buffer;
  try {
    optimizedBuffer = await sharp(Buffer.from(await fileLike.arrayBuffer()))
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
  } catch {
    return jsonResponse(
      {
        ok: false,
        message: "画像を圧縮できませんでした。別の画像をお試しください。",
      },
      400,
    );
  }

  const uploadData = new FormData();
  const originalName =
    typeof File !== "undefined" && fileLike instanceof File
      ? fileLike.name
      : "upload";
  const fileName = `${originalName.replace(/\.[^.]+$/, "") || "upload"}.webp`;
  uploadData.append(
    "file",
    new Blob([new Uint8Array(optimizedBuffer).buffer], { type: "image/webp" }),
    fileName,
  );

  let response: Response;
  const targetUrl = buildUploadUrl(SERVICE_DOMAIN);

  try {
    response = await fetch(targetUrl, {
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
        message: `microCMS upload request failed: ${(error as Error).message}`,
      },
      502,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "Upload failed.");
    const usingFallbackKey = !(
      (import.meta as any).env?.MICROCMS_MANAGEMENT_API_KEY ??
      process.env.MICROCMS_MANAGEMENT_API_KEY
    );
    const credentialHint =
      response.status === 401 || response.status === 403
        ? usingFallbackKey
          ? " The media upload endpoint usually requires a management API key with media write permission."
          : " Check whether the management API key has media write permission."
        : "";

    return jsonResponse(
      {
        ok: false,
        message: `microCMS upload error (${response.status}): ${text}${credentialHint}`,
        usingFallbackContentApiKey: usingFallbackKey,
        contentApiKeyConfigured: Boolean(CONTENT_API_KEY),
      },
      response.status,
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

  if (!uploadUrl.startsWith("https://")) {
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

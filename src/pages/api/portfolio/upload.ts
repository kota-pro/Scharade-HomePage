import type { APIRoute } from "astro";
import { getUserFromRequest } from "../../../lib/auth";

const SERVICE_DOMAIN =
  (import.meta as any).env?.MICROCMS_SERVICE_DOMAIN ??
  process.env.MICROCMS_SERVICE_DOMAIN;
const API_KEY =
  (import.meta as any).env?.MICROCMS_API_KEY ?? process.env.MICROCMS_API_KEY;

const buildUploadUrl = (serviceId: string) =>
  `https://${serviceId}.microcms-management.io/api/v1/media`;

export const POST: APIRoute = async ({ request }) => {
  if (!SERVICE_DOMAIN || !API_KEY) {
    return jsonResponse(
      { ok: false, message: "Server misconfigured. Missing microCMS credentials." },
      500,
    );
  }

  const { user } = getUserFromRequest(request);
  if (!user) {
    return jsonResponse({ ok: false, message: "Authentication required." }, 401);
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
  const size = typeof (fileLike as any).size === "number" ? (fileLike as any).size : 0;
  if (mime && !mime.startsWith("image/")) {
    return jsonResponse({ ok: false, message: "Only image files are allowed." }, 400);
  }
  if (size && size > 5 * 1024 * 1024) {
    return jsonResponse({ ok: false, message: "File too large (max 5MB)." }, 413);
  }

  const uploadData = new FormData();
  const fileName =
    typeof File !== "undefined" && fileLike instanceof File ? fileLike.name : "upload.jpg";
  uploadData.append("file", fileLike, fileName);

  let response: Response;
  const targetUrl = buildUploadUrl(SERVICE_DOMAIN);

  try {
    response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "X-MICROCMS-API-KEY": API_KEY,
      },
      body: uploadData,
    });
  } catch (error) {
    return jsonResponse(
      { ok: false, message: `microCMS upload request failed: ${(error as Error).message}` },
      502,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "Upload failed.");
    return jsonResponse(
      { ok: false, message: `microCMS upload error (${response.status}): ${text}` },
      response.status,
    );
  }

  const data = await response.json().catch(() => null);
  const uploadUrl = data && typeof data === "object" && "url" in data ? (data as any).url : null;

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

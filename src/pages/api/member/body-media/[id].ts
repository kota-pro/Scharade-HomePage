import type { APIRoute } from "astro";
import { bodyAssetBytes, readBodyAsset } from "../../../../lib/bodyMedia.ts";
import { canReadBodyAsset } from "../../../../lib/bodyMediaAccess.ts";
import { ContentManagementError } from "../../../../lib/contentManagement.ts";
import { json } from "../../../../lib/http.ts";

export const GET: APIRoute = ({ locals, params }) => {
  const unavailable = () => json({ ok: false, message: "添付ファイルが見つかりません。" }, 404);
  try {
    const asset = readBodyAsset(params.id ?? "");
    if (!asset || !canReadBodyAsset(asset, locals.user)) return unavailable();
    return new Response(new Uint8Array(bodyAssetBytes(asset)), { headers: {
      "Content-Type": asset.mime,
      "Content-Disposition": `${asset.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof ContentManagementError || (error as NodeJS.ErrnoException).code === "ENOENT") return unavailable();
    throw error;
  }
};

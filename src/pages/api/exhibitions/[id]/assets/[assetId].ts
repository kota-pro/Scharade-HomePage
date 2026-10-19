import fs from "node:fs";
import type { APIRoute } from "astro";
import { authorizeAsset, exhibitionAssetPath } from "../../../../../lib/exhibitions.ts";
import { ExhibitionError } from "../../../../../lib/exhibitionValidation.ts";
import { json } from "../../../../../lib/http.ts";

export const GET: APIRoute = async ({ params, locals, url }) => {
  try {
    const asset = authorizeAsset(params.id ?? "", params.assetId ?? "", locals.user, url.searchParams.get("token") ?? "");
    const preview = url.searchParams.get("preview") === "1";
    const file = exhibitionAssetPath(asset.id, preview);
    if (!fs.existsSync(file)) return json({ ok: false, message: "写真ファイルが見つかりません。" }, 404);
    return new Response(fs.readFileSync(file), { headers: { "Content-Type": preview ? "image/png" : asset.mimeType, "Content-Length": String(fs.statSync(file).size), "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}` } });
  } catch (error) {
    if (error instanceof ExhibitionError) return json({ ok: false, message: error.message }, error.status);
    return json({ ok: false, message: "写真を読み込めませんでした。" }, 503);
  }
};

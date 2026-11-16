import fs from "node:fs";
import type { APIRoute } from "astro";
import { authorizeAsset, exhibitionAssetPath } from "../../../../../lib/exhibitions.ts";
import { ExhibitionError, exhibitionErrorBody } from "../../../../../lib/exhibitionValidation.ts";
import { json } from "../../../../../lib/http.ts";
import {exhibitionAssetPreview} from '../../../../../lib/exhibitionAssetPreview.ts';
import {ImageBusyError} from '../../../../../lib/imageSecurity.ts';

export const GET: APIRoute = async ({ params, locals, url }) => {
  try {
    const asset = authorizeAsset(params.id ?? "", params.assetId ?? "", locals.user, url.searchParams.get("token") ?? "");
    const preview = url.searchParams.get("preview") === "1";
    const thumbnail = preview && url.searchParams.get('thumbnail') === '1';
    const file = exhibitionAssetPath(asset.id, preview && (!thumbnail || fs.existsSync(exhibitionAssetPath(asset.id,true))));
    if (!fs.existsSync(file)) return json(exhibitionErrorBody(undefined, 'EXH-014'), 503);
    const bytes=thumbnail?await exhibitionAssetPreview(asset):fs.readFileSync(file);
    const name=thumbnail?`${asset.name.replace(/\.[^.]*$/,'')}.webp`:asset.name;
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": thumbnail ? "image/webp" : preview ? "image/png" : asset.mimeType, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}` } });
  } catch (error) {
    if (error instanceof ExhibitionError) return json(exhibitionErrorBody(error), error.status);
    if (error instanceof ImageBusyError) return json({ok:false,message:error.message},error.status);
    return json({ ok: false, message: "写真を読み込めませんでした。" }, 503);
  }
};

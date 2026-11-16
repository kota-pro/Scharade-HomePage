import fs from "node:fs";
import type { APIRoute } from "astro";
import { isStaff } from "../../../../../../lib/auth.ts";
import { findExhibition, readExhibitions } from "../../../../../../lib/exhibitions.ts";
import { exhibitionOutputPath } from "../../../../../../lib/exhibitionDrive.ts";
import { ExhibitionError, id, exhibitionErrorBody } from "../../../../../../lib/exhibitionValidation.ts";
import { json } from "../../../../../../lib/http.ts";

/** Read an existing saved output. Viewing never regenerates or queues a file. */
export const GET: APIRoute = ({ locals, params }) => {
  if (!isStaff(locals.user)) return json({ ok: false, message: "運営以上の権限が必要です。" }, locals.user ? 403 : 401);
  try {
    const data = readExhibitions(), exhibition = findExhibition(data, id(params.id)), outputId = id(params.outputId);
    const output = data.outputs?.find(item => item.id === outputId && item.exhibitionId === exhibition.id);
    if (!output) return json({ ok: false, message: "出力ファイルが見つかりません。" }, 404);
    if (!fs.existsSync(exhibitionOutputPath(outputId))) return json(exhibitionErrorBody(undefined, 'EXH-014'), 503);
    const image = ["image/png", "image/jpeg"].includes(output.mimeType);
    return new Response(fs.readFileSync(exhibitionOutputPath(outputId)), { headers: {
      "Content-Type": image ? output.mimeType : "application/octet-stream", "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(output.name)}`,
    } });
  } catch (error) { return json(exhibitionErrorBody(error, 'EXH-014'), error instanceof ExhibitionError ? error.status : 503); }
};

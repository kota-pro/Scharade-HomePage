import type { APIRoute } from "astro";
import fs from "node:fs";
import { json } from "../../../../../../lib/http.ts";
import { readTool, ToolError } from "../../../../../../lib/memberTools.ts";
import {
  authorizedToolAsset,
  toolAssetPath,
} from "../../../../../../lib/memberToolAssets.ts";
export const GET: APIRoute = ({ locals, params }) => {
  try {
    const a = authorizedToolAsset(
      readTool(params.id!),
      params.assetId!,
      locals.user,
    );
    return new Response(fs.readFileSync(toolAssetPath(a.id)), {
      headers: {
        "Content-Type": a.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${a.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      },
    });
  } catch (e) {
    return json(
      {
        ok: false,
        message:
          e instanceof ToolError
            ? e.message
            : "ファイルを読み込めませんでした。",
      },
      e instanceof ToolError ? e.status : 503,
    );
  }
};

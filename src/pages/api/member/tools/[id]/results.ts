import type { APIRoute } from "astro";
import { json } from "../../../../../lib/http.ts";
import {
  readTool,
  resultsFor,
  ToolError,
} from "../../../../../lib/memberTools.ts";
import { toolAssetDTO } from "../../../../../lib/memberToolAssets.ts";
export const GET: APIRoute = ({ locals, params }) => {
  try {
    const t = readTool(params.id!),
      results = resultsFor(t, locals.user);
    return json({
      ok: true,
      results,
      assets: toolAssetDTO(t, [
        ...results.options.map((o) => o.imageId || ""),
        ...results.responses.flatMap((r) => r.assetIds),
      ]),
    });
  } catch (e) {
    return json(
      {
        ok: false,
        message:
          e instanceof ToolError ? e.message : "結果を読み込めませんでした。",
      },
      e instanceof ToolError ? e.status : 503,
    );
  }
};

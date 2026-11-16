import type { APIRoute } from "astro";
import { json } from "../../../../../lib/http.ts";
import {
  readTool,
  questionFor,
  toolAction,
  ToolError,
  deleteTool,
} from "../../../../../lib/memberTools.ts";
import { toolAssetDTO } from "../../../../../lib/memberToolAssets.ts";
import { drainToolNotices } from "../../../../../lib/memberToolNotices.ts";
export const GET: APIRoute = ({ locals, params }) => {
  try {
    const t = readTool(params.id!);
    const tool = questionFor(t, locals.user);
    return json({
      ok: true,
      tool,
      assets: toolAssetDTO(
        t,
        tool.own.flatMap((r) => r.assetIds),
      ),
    });
  } catch (e) {
    return json(
      {
        ok: false,
        message: e instanceof ToolError ? e.message : "読み込めませんでした。",
      },
      e instanceof ToolError ? e.status : 503,
    );
  }
};
export const DELETE: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user?.approved)
    return json({ ok: false, message: "ログインが必要です。" }, 401);
  try {
    await deleteTool(params.id!, locals.user, await request.json());
    return json({ ok: true });
  } catch (e) {
    return json(
      {
        ok: false,
        message:
          e instanceof ToolError
            ? e.message
            : "削除を完了できませんでした。もう一度お試しください。",
      },
      e instanceof ToolError ? e.status : 503,
    );
  }
};
export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!locals.user?.approved)
    return json({ ok: false, message: "ログインが必要です。" }, 401);
  try {
    const p = await request.json();
    const tool = await toolAction(params.id!, locals.user, p);
    if (p.action === "publish")
      await drainToolNotices().catch(() =>
        console.error("[member-tools] notification pending"),
      );
    return json({ ok: true, tool });
  } catch (e) {
    return json(
      {
        ok: false,
        message: e instanceof ToolError ? e.message : "保存できませんでした。",
      },
      e instanceof ToolError ? e.status : 503,
    );
  }
};

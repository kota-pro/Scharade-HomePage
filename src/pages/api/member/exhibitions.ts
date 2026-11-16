import { publicExhibition } from "../../../lib/exhibitionLayoutHistory.ts";
import type { APIRoute } from "astro";
import { exhibitionAction, findExhibition, readExhibitions } from "../../../lib/exhibitions.ts";
import { ExhibitionError, exhibitionErrorBody } from "../../../lib/exhibitionValidation.ts";
import { isStaff } from "../../../lib/auth.ts";
import { createExhibitionAlbum, createExhibitionGoogleForm, importExistingExhibitionSheet } from "../../../lib/exhibitionIntegrations.ts";
import { siteOrigin } from "../../../lib/config.ts";
import { json } from "../../../lib/http.ts";
import { deleteExhibition } from "../../../lib/exhibitionDeletion.ts";
export const GET: APIRoute = async ({ locals }) => {
  if (!isStaff(locals.user)) return json({ ok: false, message: "運営以上の権限が必要です。" }, locals.user ? 403 : 401);
  const data = readExhibitions();
  return json({ ok: true, exhibitions: data.exhibitions.map(e => ({ ...publicExhibition(e), submissions: data.submissions.filter(s => s.exhibitionId === e.id).length, works: data.submissions.filter(s => s.exhibitionId === e.id).reduce((n, s) => n + (s.versions.at(-1)?.content.works.length ?? 0), 0) })) });
};
export const POST: APIRoute = async ({ locals, request }) => {
  if (!isStaff(locals.user)) return json({ ok: false, message: "運営以上の権限が必要です。" }, locals.user ? 403 : 401);
  try {
    const body = await request.json().catch(() => null) as { action?: string; exhibitionId?: string; revision?: number } | null;
    if(body?.action === "delete") return json(await deleteExhibition(locals.user!.id,body.exhibitionId??"",body.revision,(body as any).confirmation));
    if (body?.action === "google.create" || body?.action === "google.import" || body?.action === "lightroom.create") {
      const exhibition = findExhibition(readExhibitions(), body.exhibitionId ?? "");
      if (exhibition.revision !== body.revision) throw new ExhibitionError("別の画面で変更されています。再読み込みして確認してください。", 409);
      if (body.action === "google.create") return json({ ok: true, googleForm: await createExhibitionGoogleForm(exhibition.id) });
      if (body.action === "google.import") return json({ ok: true, imported: await importExistingExhibitionSheet(exhibition.id, String((body as any).sourceSpreadsheetId ?? "")) });
      return json({ ok: true, albumId: await createExhibitionAlbum(exhibition.id, siteOrigin(request),Object.hasOwn(body,'excludedAssetIds')?{actorId:locals.user!.id,revision:body.revision,excludedAssetIds:(body as any).excludedAssetIds}:undefined) });
    }
    return json(await exhibitionAction(locals.user!.id, body));
  }
  catch (error) {
    if (error instanceof ExhibitionError) return json(exhibitionErrorBody(error), error.status);
    console.error("[exhibition-admin] request failed");
    return json({ ok: false, message: "写真展の設定を保存できませんでした。" }, 503);
  }
};

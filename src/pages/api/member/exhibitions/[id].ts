import {layoutSnapshot} from '../../../../lib/exhibitionCollaboration.ts';
import {boardDesignScene} from '../../../../lib/exhibitionBoardDesign.ts';
import {measureBoardText} from '../../../../lib/exhibitionTextMetrics.ts';
import { isMemberAccount } from "../../../../lib/accountVisibility.ts";
import { publicExhibition } from "../../../../lib/exhibitionLayoutHistory.ts";
import { exhibitionQrPng } from "../../../../lib/exhibitionQr.ts";
import { submissionQrTarget } from "../../../../lib/exhibitionQrTarget.ts";
import type { APIRoute } from "astro";
import { findExhibition, portfolioCandidates, readExhibitions } from "../../../../lib/exhibitions.ts";
import { ExhibitionError, exhibitionErrorBody } from "../../../../lib/exhibitionValidation.ts";
import { isStaff, readUsers } from "../../../../lib/auth.ts";
import { latestContent } from "../../../../lib/exhibitionTypes.ts";
import { titleBoardLayoutSummary, qrFor } from "../../../../lib/exhibitionOutputs.ts";
import { siteOrigin } from "../../../../lib/config.ts";
import { json } from "../../../../lib/http.ts";
import { readActivities } from "../../../../lib/activities.ts";
import { notificationRecipient } from "../../../../lib/notificationRecipients.ts";
export const GET: APIRoute = async ({ locals, params, request, url }) => {
  if (!isStaff(locals.user)) return json({ ok: false, message: "運営以上の権限が必要です。" }, locals.user ? 403 : 401);
  try {
    const data = readExhibitions(), exhibition = findExhibition(data, params.id ?? ""), activities = readActivities(),users=readUsers(),detail=!["overview","form","participants"].includes(url.searchParams.get("view")??"");
    if(url.searchParams.get('view')==='layout'){
      const snapshot=layoutSnapshot(data,exhibition);
      return json({ok:true,viewerId:locals.user!.id,exhibition:publicExhibition(exhibition),layoutWorks:snapshot.works,layoutAssets:snapshot.layoutAssets,submissions:[],users:[],outputs:[],assets:[]});
    }
    return json({ ok: true, exhibition:publicExhibition(exhibition), submissions: await Promise.all(data.submissions.filter(s => s.exhibitionId === exhibition.id).map(async s => {
      const content = latestContent(s), target = submissionQrTarget(s, siteOrigin(request)), qrUrl = content ? qrFor(s, siteOrigin(request)) : "";
      return { qrUrl, qrImage: detail && target.confirmed && qrUrl ? `data:image/png;base64,${(await exhibitionQrPng(qrUrl,siteOrigin(request))).toString("base64")}` : null, id: s.id, schemaVersion:s.schemaVersion, revision: s.revision, updatedAt: s.updatedAt, userId: s.userId ?? null, inactive: !!s.inactive, imported: !!s.sheetSource, draft: s.draft, hasUnsubmittedChanges: !!content && JSON.stringify(s.draft) !== JSON.stringify(content), qrConfirmed: target.confirmed, portfolioId: target.portfolioId ?? null, candidates: detail&&content ? portfolioCandidates(content.name) : [], content: content ? { ...content, works: detail?content.works.map(w => ({ ...w, boardIssues:boardDesignScene(content,w,measureBoardText,exhibition.boardDesigns?.[w.id]).issues, layout: titleBoardLayoutSummary(w) })):content.works } : null, versions: s.versions.map(v => ({ version: v.version, at: v.at, delivery: v.delivery, error: v.error, source: v.source, editorName: v.editedBy ? users.find(u => u.id === v.editedBy)?.name ?? "運営" : undefined })) };
    })), users: users.filter(isMemberAccount).map(u => notificationRecipient(u, activities)), outputs: (data.outputs ?? []).filter(o => o.exhibitionId === exhibition.id).map(({ id, kind, name, mimeType, createdAt, drive }) => ({ id, kind, name, mimeType, createdAt, drive: { status: drive.status, url: drive.url, error: drive.error } })), assets: data.assets.filter(a => a.exhibitionId === exhibition.id).map(({ id, submissionId, name, bytes, width, height, uploaded, albumAdded, lightroomId, drive, photoMetadata }) => ({ id, submissionId, name, bytes, width, height, uploaded, albumAdded, lightroomId, photoMetadata, drive: drive ? { status: drive.status, url: drive.url, error: drive.error } : null })) });
  } catch (error) {
    if (error instanceof ExhibitionError) return json(exhibitionErrorBody(error), error.status);
    return json({ ok: false, message: "写真展を読み込めませんでした。" }, 503);
  }
};

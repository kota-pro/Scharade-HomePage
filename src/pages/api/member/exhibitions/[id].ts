import { publicExhibition } from "../../../../lib/exhibitionLayoutHistory.ts";
import { exhibitionQrPng } from "../../../../lib/exhibitionQr.ts";
import type { APIRoute } from "astro";
import { findExhibition, portfolioCandidates, readExhibitions } from "../../../../lib/exhibitions.ts";
import { ExhibitionError } from "../../../../lib/exhibitionValidation.ts";
import { isStaff, readUsers } from "../../../../lib/auth.ts";
import { latestContent } from "../../../../lib/exhibitionTypes.ts";
import { titleBoardLayoutSummary, qrFor } from "../../../../lib/exhibitionOutputs.ts";
import { siteOrigin } from "../../../../lib/config.ts";
import { json } from "../../../../lib/http.ts";
import { readActivities } from "../../../../lib/activities.ts";
import { notificationRecipient } from "../../../../lib/notificationRecipients.ts";
export const GET: APIRoute = async ({ locals, params, request }) => {
  if (!isStaff(locals.user)) return json({ ok: false, message: "運営以上の権限が必要です。" }, locals.user ? 403 : 401);
  try {
    const data = readExhibitions(), exhibition = findExhibition(data, params.id ?? ""), activities = readActivities();
    return json({ ok: true, exhibition:publicExhibition(exhibition), submissions: await Promise.all(data.submissions.filter(s => s.exhibitionId === exhibition.id).map(async s => {
      const content = latestContent(s), qrUrl = content ? qrFor(s, siteOrigin(request)) : "";
      return { qrUrl, qrImage: s.qrConfirmed && qrUrl ? `data:image/png;base64,${(await exhibitionQrPng(qrUrl,siteOrigin(request))).toString("base64")}` : null, id: s.id, revision: s.revision, updatedAt: s.updatedAt, userId: s.userId ?? null, inactive: !!s.inactive, imported: !!s.sheetSource, draft: s.draft, qrConfirmed: !!s.qrConfirmed, portfolioId: s.portfolioId ?? null, candidates: content ? portfolioCandidates(content.name) : [], content: content ? { ...content, works: content.works.map(w => ({ ...w, layout: titleBoardLayoutSummary(w) })) } : null, versions: s.versions.map(v => ({ version: v.version, at: v.at, delivery: v.delivery, error: v.error })) };
    })), users: readUsers().filter(u => u.approved).map(u => notificationRecipient(u, activities)), outputs: (data.outputs ?? []).filter(o => o.exhibitionId === exhibition.id).map(({ id, kind, name, createdAt, drive }) => ({ id, kind, name, createdAt, drive: { status: drive.status, url: drive.url, error: drive.error } })), assets: data.assets.filter(a => a.exhibitionId === exhibition.id).map(({ id, submissionId, name, width, height, uploaded, albumAdded, lightroomId, drive }) => ({ id, submissionId, name, width, height, uploaded, albumAdded, lightroomId, drive: drive ? { status: drive.status, url: drive.url, error: drive.error } : null })) });
  } catch (error) {
    if (error instanceof ExhibitionError) return json({ ok: false, message: error.message }, error.status);
    return json({ ok: false, message: "写真展を読み込めませんでした。" }, 503);
  }
};

import { exhibitionAccountGrade } from "../../../lib/exhibitionAccountGrade.ts";
import type { APIRoute } from "astro";
import { findExhibition, publicAction, publicSubmission, readExhibitions, tokenSubmission } from "../../../lib/exhibitions.ts";
import { ExhibitionError, exhibitionErrorBody } from "../../../lib/exhibitionValidation.ts";
import { currentSchema } from "../../../lib/exhibitionTypes.ts";
import { json } from "../../../lib/http.ts";
import { exhibitionMember, ownSubmission, participationState, requireExhibitionRecipient } from "../../../lib/exhibitionParticipation.ts";
import { emptySubmission } from "../../../lib/exhibitionTypes.ts";
import { isStaff } from "../../../lib/auth.ts";
import { effectiveSubmissionLimits } from '../../../lib/exhibitionSubmissionLimits.ts';
import { previewOwnTitleBoard } from '../../../lib/exhibitionTitleBoardPreview.ts';
import { siteOrigin } from '../../../lib/config.ts';

export const GET: APIRoute = async ({ params, url, locals }) => {
  try {
    const data = readExhibitions(), exhibition = findExhibition(data, params.id ?? "");
    const user = exhibitionMember(locals.user?.id);
    if (url.searchParams.get("preview") === "1" && isStaff(user)) return json({ ok: true, viewerId: user.id, preview: true, exhibition: { id: exhibition.id, title: exhibition.title, accepting: true, opensAt: exhibition.opensAt, closesAt: exhibition.closesAt }, schema: currentSchema(exhibition), effectiveLimits: effectiveSubmissionLimits(exhibition.schemas), submission: { id: "preview", revision: 0, draft: emptySubmission(), versions: [] }, assets: [] });
    requireExhibitionRecipient(exhibition, user);
    const state = participationState(exhibition, user);
    const token = url.searchParams.get("token");
    const submission = state.eligible ? ownSubmission(data, exhibition, user.id, token ? tokenSubmission(data, exhibition.id, token) : undefined) : undefined;
    const initialGrade = submission && !submission.draft.grade?.trim() && state.accepting ? await exhibitionAccountGrade(user) : "";
    return json({ ok: true, participation: state, ...(initialGrade ? { initialGrade } : {}), ...(submission ? publicSubmission(data, exhibition, submission, user.id) : { viewerId: user.id, exhibition: { id: exhibition.id, title: exhibition.title, accepting: state.accepting, opensAt: exhibition.opensAt, closesAt: exhibition.closesAt }, schema: currentSchema(exhibition), effectiveLimits: effectiveSubmissionLimits(exhibition.schemas), submission: null }) });
  } catch (error) {
    if (error instanceof ExhibitionError) return json(exhibitionErrorBody(error), error.status);
    console.error("[exhibition-public-read] request failed");
    return json(exhibitionErrorBody(error, "EXH-014"), 503);
  }
};
export const POST: APIRoute = async ({ params, request, locals }) => {
  let preview=false;
  try {
    const body = await request.json().catch(() => null) as { token?: unknown; action?: unknown; content?: unknown; ownerId?: unknown } | null;
    if (body?.ownerId !== undefined && body.ownerId !== locals.user?.id) throw new ExhibitionError("ログイン中のアカウントが変わりました。元のアカウントでログインし直してください。", 401);
    const token = typeof body?.token === "string" ? body.token : "";
    preview=body?.action==="boards.preview";
    if(preview)return json(await previewOwnTitleBoard(params.id??"",token,body?.content,locals.user?.id,siteOrigin(request)));
    const result = await publicAction(params.id ?? "", token, body ?? {}, locals.user?.id);
    return json(result);
  } catch (error) {
    if (error instanceof ExhibitionError) return json(exhibitionErrorBody(error), error.status);
    console.error("[exhibition-public-save] request failed");
    return json(exhibitionErrorBody(error, preview ? "EXH-016" : "EXH-015"), 503);
  }
};

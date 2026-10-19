import type { APIRoute } from "astro";
import { findExhibition, publicAction, publicSubmission, readExhibitions, tokenSubmission } from "../../../lib/exhibitions.ts";
import { ExhibitionError } from "../../../lib/exhibitionValidation.ts";
import { currentSchema } from "../../../lib/exhibitionTypes.ts";
import { json } from "../../../lib/http.ts";
import { exhibitionMember, ownSubmission, participationState, requireExhibitionRecipient } from "../../../lib/exhibitionParticipation.ts";
import { emptySubmission } from "../../../lib/exhibitionTypes.ts";
import { isStaff } from "../../../lib/auth.ts";
import { effectiveSubmissionLimits } from '../../../lib/exhibitionSubmissionLimits.ts';

export const GET: APIRoute = async ({ params, url, locals }) => {
  try {
    const data = readExhibitions(), exhibition = findExhibition(data, params.id ?? "");
    const user = exhibitionMember(locals.user?.id);
    if (url.searchParams.get("preview") === "1" && isStaff(user)) return json({ ok: true, preview: true, exhibition: { id: exhibition.id, title: exhibition.title, accepting: true, opensAt: exhibition.opensAt, closesAt: exhibition.closesAt }, schema: currentSchema(exhibition), effectiveLimits: effectiveSubmissionLimits(exhibition.schemas), submission: { id: "preview", revision: 0, draft: emptySubmission(), versions: [] }, assets: [] });
    requireExhibitionRecipient(exhibition, user);
    const state = participationState(exhibition, user);
    const token = url.searchParams.get("token");
    const submission = state.eligible ? ownSubmission(data, exhibition, user.id, token ? tokenSubmission(data, exhibition.id, token) : undefined) : undefined;
    return json({ ok: true, participation: state, ...(submission ? publicSubmission(data, exhibition, submission, user.id) : { exhibition: { id: exhibition.id, title: exhibition.title, accepting: state.accepting, opensAt: exhibition.opensAt, closesAt: exhibition.closesAt }, schema: currentSchema(exhibition), effectiveLimits: effectiveSubmissionLimits(exhibition.schemas), submission: null }) });
  } catch (error) {
    if (error instanceof ExhibitionError) return json({ ok: false, message: error.message, ...(error.issues?{issues:error.issues}:{}), ...(error.limitIssues?{limitIssues:error.limitIssues,effectiveLimits:error.effectiveLimits}:{}) }, error.status);
    console.error("[exhibition-public-read] request failed");
    return json({ ok: false, message: "写真展フォームを読み込めませんでした。" }, 503);
  }
};
export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const body = await request.json().catch(() => null) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const result = await publicAction(params.id ?? "", token, body ?? {}, locals.user?.id);
    return json(result);
  } catch (error) {
    if (error instanceof ExhibitionError) return json({ ok: false, message: error.message, ...(error.issues?{issues:error.issues}:{}), ...(error.limitIssues?{limitIssues:error.limitIssues,effectiveLimits:error.effectiveLimits}:{}) }, error.status);
    console.error("[exhibition-public-save] request failed");
    return json({ ok: false, message: "保存できませんでした。時間をおいて再度お試しください。" }, 503);
  }
};

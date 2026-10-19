import type { APIRoute } from "astro";
import { findExhibition, readExhibitions, voteExhibition } from "../../../../../lib/exhibitions.ts";
import { exhibitionMember, participationState, requireExhibitionRecipient } from "../../../../../lib/exhibitionParticipation.ts";
import { ExhibitionError } from "../../../../../lib/exhibitionValidation.ts";
import { json } from "../../../../../lib/http.ts";

export const GET: APIRoute = ({ params, locals }) => {
  try {
    const e = findExhibition(readExhibitions(), params.id ?? ""), user = exhibitionMember(locals.user?.id);
    requireExhibitionRecipient(e, user);
    return json({ ok: true, id: e.id, title: e.title, opensAt: e.opensAt, closesAt: e.closesAt, ...participationState(e, user) });
  } catch (error) { return problem(error); }
};
export const POST: APIRoute = async ({ params, locals, request }) => {
  try {
    const user = exhibitionMember(locals.user?.id), body = await request.json().catch(() => null);
    return json(await voteExhibition(user.id, params.id ?? "", body?.vote));
  } catch (error) { return problem(error); }
};
function problem(error: unknown) {
  return json({ ok: false, message: error instanceof ExhibitionError ? error.message : "参加投票を処理できませんでした。" }, error instanceof ExhibitionError ? error.status : 503);
}

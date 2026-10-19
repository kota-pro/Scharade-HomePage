import { readUsers, isStaff, type User } from "./auth.ts";
import { isAcceptingSubmissions, type Exhibition, type ExhibitionStore, type Submission } from "./exhibitionTypes.ts";
import { ExhibitionError } from "./exhibitionValidation.ts";

export function exhibitionMember(actorId?: string): User {
  if (!actorId) throw new ExhibitionError("ログインが必要です。", 401);
  const user = readUsers().find(user => user.id === actorId && user.approved);
  if (!user) throw new ExhibitionError("承認済みのアカウントでログインしてください。", 403);
  return user;
}
export function participationState(exhibition: Exhibition, user: User, now = Date.now()) {
  const p = exhibition.participation;
  const invited = Boolean(p?.recipientIds.includes(user.id));
  const published = p?.state === "published";
  const vote: "attending" | "absent" | "undecided" | "unanswered" = p?.votes[user.id]?.value ?? "unanswered";
  const canVote = Boolean(invited && published && Date.parse(p!.opensAt) <= now && now < Date.parse(p!.closesAt));
  const eligible = Boolean(invited && published && vote === "attending" && now >= Date.parse(p!.closesAt));
  const accepting = eligible && isAcceptingSubmissions(exhibition, now);
  let message = "";
  if (!published) message = "参加投票の準備中です。運営からの通知をお待ちください。";
  else if (!invited) message = "この写真展の通知対象者ではありません。";
  else if (vote !== "attending") message = "参加投票で「参加」と回答した方がフォームを入力できます。";
  else if (now < Date.parse(p!.closesAt)) message = "参加投票の終了後にフォーム入力を開始できます。";
  else if (!isAcceptingSubmissions(exhibition, now)) message = "現在はフォームの入力期間外です。";
  return { invited, vote, canVote, eligible, accepting, message, voteOpensAt: p?.opensAt ?? "", voteClosesAt: p?.closesAt ?? "" };
}
export function requireExhibitionInput(exhibition: Exhibition, actorId?: string, now = Date.now()) {
  const user = exhibitionMember(actorId), state = participationState(exhibition, user, now);
  if (!state.accepting) throw new ExhibitionError(state.message, 403);
  return user;
}
export function ownSubmission(data: ExhibitionStore, exhibition: Exhibition, actorId: string, tokenSubmission?: Submission) {
  const user = exhibitionMember(actorId);
  const state = participationState(exhibition, user);
  if (!state.eligible) throw new ExhibitionError(state.message, 403);
  if (tokenSubmission && (tokenSubmission.userId !== user.id || tokenSubmission.inactive)) throw new ExhibitionError("この編集リンクは自分の提出に紐付いていません。運営に確認してください。", 403);
  return tokenSubmission ?? data.submissions.find(s => s.exhibitionId === exhibition.id && s.userId === user.id && !s.inactive);
}
export function requireExhibitionRecipient(exhibition: Exhibition, user: User) {
  if (!isStaff(user) && !exhibition.participation?.recipientIds.includes(user.id)) throw new ExhibitionError("この写真展を閲覧できません。", 403);
}

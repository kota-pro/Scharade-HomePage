import { type User, readUsers, updateUsers, isExecutive, canManageAccount } from "./auth.ts";
import { accountRevision, AccountUpdateError } from './accountManagement.ts';
import { withStoreLock, writeData } from "./store.ts";
import { prepareAccountSetup, completeAccountSetup } from "./accountSetup.ts";
import { mailTransport, CONTACT_EMAIL } from "./mail.ts";
import { siteOrigin } from "./config.ts";
import { audit } from "./audit.ts";
import type { ReviewAction } from "./signupReview.ts";
import { readDeletionRequests } from './accountDeletionRequests.ts';

async function sendApprovalMail(user: User) {
  await mailTransport().sendMail({
    from: `"写団シャレード" <${CONTACT_EMAIL}>`,
    to: user.email,
    subject: "【写団シャレード】アカウント開設完了のお知らせ",
    text: `${user.name} 様\n\nアカウントの申請が承認され、開設が完了しました。\n以下のページから、ご登録のメールアドレスとパスワードでログインできます。\n\n${new URL("/Login", siteOrigin())}\n\n※このメールはシステムからの自動送信です。`,
  });
}

export async function applyAccountReview(
  userId: string,
  action: ReviewAction,
  send: (user: User) => Promise<unknown> = sendApprovalMail,
  actor?: { id: string; revision: string },
) {
  // Serialize repeated confirmations without holding the global auth lock over SMTP.
  return withStoreLock("account-review", async () => {
    let target: User | undefined;
    await withStoreLock("auth", () =>
      withStoreLock("exhibitions", () =>
        withStoreLock("member-activities", () => {
          const users = readUsers();
          const user = users.find((u) => u.id === userId);
          if (actor) {
            const operator = users.find(u => u.id === actor.id);
            if (!isExecutive(operator) || !user || !canManageAccount(operator, user))
              throw new AccountUpdateError('この申請を承認する権限がありません。', 403);
            if (action !== 'approve' || accountRevision(user) !== actor.revision)
              throw new AccountUpdateError('登録内容が更新されました。最新の内容を確認してください。', 409);
          }
          if (!user || user.role === "admin") return;
          // A retry finishes setup for an approved account; it never reactivates a
          // stopped account or overrides the member's pending deletion request.
          if (user.approvalReviewAction === 'approve' && user.approvalReviewedAt && !user.approved) return;
          if (action === 'approve' && readDeletionRequests().requests.some(r => r.userId === userId && r.status !== 'complete')) return;
          if (user.approvalReviewedAt && user.approvalReviewAction !== action)
            return;
          if (!user.approvalReviewedAt && user.approved) return;
          if (action === "approve" && !user.approved)
            user.approvalSetup ??= prepareAccountSetup(users);
          user.approvalReviewedAt ??= new Date().toISOString();
          user.approvalReviewAction = action;
          const approved = action === "approve";
          if (user.approved !== approved) {
            user.approved = approved;
            user.authVersion = (user.authVersion ?? 0) + 1;
          }
          target = { ...user };
          writeData("users.json", users);
        }),
      ),
    );
    if (!target) return "invalid";
    await audit(actor?.id ?? "signed-review-link", action, userId);
    const setupResult =
      action === "approve" ? await completeAccountSetup(userId) : "updated";
    if (action === "approve" && !target.approvalNotifiedAt) {
      try {
        await send(target);
      } catch {
        console.error("[auth/review] approval notification failed");
        return "email-failed";
      }
      await updateUsers((users) => {
        const user = users.find((u) => u.id === userId);
        if (user) user.approvalNotifiedAt = new Date().toISOString();
      });
    }
    return setupResult;
  });
}

export function canApproveRegistration(actor: User | null | undefined, target: User) {
  return isExecutive(actor) && canManageAccount(actor, target) && target.role !== 'admin' &&
    ((!target.approved && !target.approvalReviewedAt) || target.approved && target.approvalReviewAction === 'approve');
}

export async function approveRegistration(actorId: string, userId: string, revision: unknown) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))
    throw new AccountUpdateError('最新の登録内容を確認してください。', 400);
  const result = await applyAccountReview(userId, 'approve', sendApprovalMail, { id: actorId, revision });
  if (result === 'invalid') throw new AccountUpdateError('この申請はすでに処理済みか、承認対象ではありません。', 409);
  return result;
}

import { type User, updateUsers } from "./auth.ts";
import { withStoreLock } from "./store.ts";
import { mailTransport, CONTACT_EMAIL } from "./mail.ts";
import { siteOrigin } from "./config.ts";
import { audit } from "./audit.ts";
import type { ReviewAction } from "./signupReview.ts";

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
) {
  // Serialize repeated confirmations without holding the global auth lock over SMTP.
  return withStoreLock("account-review", async () => {
    let target: User | undefined;
    await updateUsers((users) => {
      const user = users.find((u) => u.id === userId);
      if (!user || user.role === "admin") return;
      if (user.approvalReviewedAt && user.approvalReviewAction !== action) return;
      if (!user.approvalReviewedAt && user.approved) return;
      user.approvalReviewedAt ??= new Date().toISOString();
      user.approvalReviewAction = action;
      const approved = action === "approve";
      if (user.approved !== approved) {
        user.approved = approved;
        user.authVersion = (user.authVersion ?? 0) + 1;
      }
      target = { ...user };
    });
    if (!target) return "invalid";
    await audit("signed-review-link", action, userId);
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
    return "updated";
  });
}

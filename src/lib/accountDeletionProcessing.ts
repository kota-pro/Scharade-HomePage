import crypto from "node:crypto";
import { readUsers, readSessions, isAdmin } from "./auth.ts";
import {
  readDeletionRequests,
  writeDeletionRequests,
  DeletionRequestError,
} from "./accountDeletionRequests.ts";
import {
  deletionInventory,
  cleanupAccountReferences,
  deletionChecks,
} from "./deletionPrivacy.ts";
import { accountDeletionRevision, deleteAccount } from "./accountDeletion.ts";
import { readPushDevices, writePushDevices } from "./pushDeviceState.ts";
import { withStoreLock, writeData } from "./store.ts";
import { mailTransport, CONTACT_EMAIL } from "./mail.ts";

export async function startDeletionProcessing(
  actorId: string,
  requestId: string,
  now = Date.now(),
) {
  const request = await withStoreLock("auth", () =>
    withStoreLock("account-deletion-requests", () =>
      withStoreLock("exhibitions", () =>
        withStoreLock("member-activities", async () => {
          const users = readUsers();
          if (!isAdmin(users.find((u) => u.id === actorId)))
            throw new DeletionRequestError("管理者権限が必要です。", 403);
          const data = readDeletionRequests(),
            r = data.requests.find((r) => r.id === requestId);
          if (!r) throw new DeletionRequestError("申請が見つかりません。", 404);
          if (r.status === "complete") return r;
          if (r.userId === actorId)
            throw new DeletionRequestError(
              "自分の申請は別の管理者に処理を依頼してください。最後の管理者は先に引き継ぎを行ってください。",
              409,
            );
          const user = users.find((u) => u.id === r.userId);
          if (
            user &&
            user.email.trim().toLowerCase() !== r.email.trim().toLowerCase()
          )
            throw new DeletionRequestError(
              "登録メールが変更されています。本人が現在のメールで申請を再確認してください。",
              409,
            );
          if (r.status === "pending") {
            r.inventory = deletionInventory(r.userId, r.portfolioId);
            r.status = "processing";
            r.startedBy = actorId;
            r.notBefore = now + 15 * 60_000;
            writeDeletionRequests(data);
          }
          // A persisted processing marker makes partial failures resumable; no external calls under these locks.
          if (user) {
            user.approved = false;
            user.authVersion = (user.authVersion ?? 0) + 1;
            writeData("users.json", users);
          }
          writeData(
            "sessions.json",
            readSessions().filter((s) => s.userId !== r.userId),
          );
          await withStoreLock("push-devices", () => {
            const devices = readPushDevices();
            devices.devices = devices.devices.filter(
              (d) => d.userId !== r.userId,
            );
            writePushDevices(devices);
          });
          return structuredClone(r);
        }),
      ),
    ),
  );
  if (request.status === "processing")
    await cleanupAccountReferences(
      request.userId,
      request.inventory?.rosterKey ?? null,
      request.id,
      request.inventory,
    );
  return request;
}
export async function completeDeletionProcessing(
  actorId: string,
  requestId: string,
  input: unknown,
  now = Date.now(),
) {
  const p = input as { confirmationEmail?: unknown; checks?: unknown } | null;
  if (
    !p ||
    typeof p !== "object" ||
    Object.keys(p).some((k) => !["confirmationEmail", "checks"].includes(k)) ||
    typeof p.confirmationEmail !== "string" ||
    !Array.isArray(p.checks) ||
    p.checks.length !== Object.keys(deletionChecks).length ||
    Object.keys(deletionChecks).some(
      (key) => !(p.checks as unknown[]).includes(key),
    )
  )
    throw new DeletionRequestError(
      "関連データの削除をすべて確認してください。",
    );
  const r = await withStoreLock("auth", () =>
    withStoreLock("account-deletion-requests", () => {
      if (!isAdmin(readUsers().find((u) => u.id === actorId)))
        throw new DeletionRequestError("管理者権限が必要です。", 403);
      const r = readDeletionRequests().requests.find((r) => r.id === requestId);
      if (!r) throw new DeletionRequestError("申請が見つかりません。", 404);
      if (r.status !== "processing" || (r.notBefore ?? Infinity) > now)
        throw new DeletionRequestError(
          "処理開始後15分以上待ち、進行中の外部送信が終了してから外部データとバックアップを確認してください。",
          409,
        );
      if (
        r.userId === actorId ||
        (p.confirmationEmail as string).trim().toLowerCase() !==
          r.email.trim().toLowerCase()
      )
        throw new DeletionRequestError(
          "削除対象の確認内容を確認してください。",
          409,
        );
      return structuredClone(r);
    }),
  );
  await cleanupAccountReferences(
    r.userId,
    r.inventory?.rosterKey ?? null,
    r.id,
    r.inventory,
  );
  const user = readUsers().find((u) => u.id === r.userId);
  if (user) {
    if (user.email.trim().toLowerCase() !== r.email.trim().toLowerCase())
      throw new DeletionRequestError(
        "登録メールが変更されています。本人による申請の再確認が必要です。",
        409,
      );
    await deleteAccount(actorId, user.id, {
      revision: accountDeletionRevision(user),
      confirmationEmail: user.email,
    });
  }
  await withStoreLock("auth", () =>
    withStoreLock("account-deletion-requests", () => {
      if (!isAdmin(readUsers().find((u) => u.id === actorId)))
        throw new DeletionRequestError("管理者権限が必要です。", 403);
      if (readUsers().some((u) => u.id === r.userId))
        throw new DeletionRequestError(
          "アカウントの削除を完了できていません。",
          409,
        );
      const data = readDeletionRequests(),
        current = data.requests.find((v) => v.id === r.id)!;
      current.status = "complete";
      current.completedAt = now;
      current.completedBy = actorId;
      current.mailRetryAt = now;
      writeDeletionRequests(data);
    }),
  );
  return { ok: true };
}

type SendCompletion = (email: string, requestId: string) => Promise<void>;
const sendCompletion: SendCompletion = async (email, requestId) => {
  await mailTransport().sendMail({
    from: `"写団シャレード" <${CONTACT_EMAIL}>`,
    to: email,
    messageId: `<deletion-complete.${requestId}@scharade.jp>`,
    subject: "【Scharade】アカウント削除が完了しました",
    text: "ご申請いただいたScharadeのアカウントと関連する個人データの削除が完了しました。\n本メールをもって完了のお知らせといたします。\nお問い合わせ：contact@scharade.jp",
  });
};
export async function drainDeletionEmails(
  send: SendCompletion = sendCompletion,
  clock = Date.now,
  stopped = () => false,
) {
  let sent = 0;
  for (const pending of readDeletionRequests()
    .requests.filter(
      (r) =>
        r.status === "complete" &&
        !r.mailSentAt &&
        (r.mailRetryAt ?? 0) <= clock(),
    )
    .slice(0, 10)) {
    if (stopped()) break;
    const lease = crypto.randomUUID();
    const claim = await withStoreLock("account-deletion-requests", () => {
      const data = readDeletionRequests(),
        r = data.requests.find((r) => r.id === pending.id);
      if (!r || r.mailSentAt || (r.mailLeaseUntil ?? 0) > clock()) return null;
      r.mailLease = lease;
      r.mailLeaseUntil = clock() + 60000;
      r.mailAttempts = (r.mailAttempts ?? 0) + 1;
      writeDeletionRequests(data);
      return { email: r.email, id: r.id };
    });
    if (!claim) continue;
    let success = false;
    try {
      await send(claim.email, claim.id);
      success = true;
    } catch {
      /* Retried without exposing mailbox addresses in logs. */
    }
    await withStoreLock("account-deletion-requests", () => {
      const data = readDeletionRequests(),
        r = data.requests.find((r) => r.id === claim.id);
      if (r?.mailLease !== lease) return;
      delete r.mailLease;
      delete r.mailLeaseUntil;
      if (success) {
        r.mailSentAt = clock();
        r.email = "";
        r.name = "";
        r.portfolioId = null;
        delete r.inventory;
        for (const [key, challenge] of Object.entries(data.challenges))
          if (challenge.userId === r.userId) delete data.challenges[key];
      } else
        r.mailRetryAt =
          clock() +
          Math.min(900000, 60000 * 2 ** Math.min(r.mailAttempts ?? 1, 4));
      writeDeletionRequests(data);
    });
    if (success) sent++;
  }
  return sent;
}

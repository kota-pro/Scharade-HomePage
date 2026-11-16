import { isMemberAccount } from "./accountVisibility.ts";
import crypto from "node:crypto";
import { readUsers, updateUsers, type User } from "./auth.ts";
import { readActivities } from "./activities.ts";
import {
  activityRosterSource,
  applyRosterProfiles,
  fetchActivityRoster,
  rosterSuggestions,
  type RosterSource,
} from "./activityRoster.ts";
import { readExhibitions } from "./exhibitions.ts";
import {
  linkedPortfolioGrade,
  queueRosterPortfolioGrades,
} from "./portfolioRosterGrade.ts";
import { reconcileRoster } from "./rosterReconciliation.ts";
import { enqueuePushNotice } from "./pushQueue.ts";
import { withStoreLock, writeData } from "./store.ts";

export type AccountSetup = {
  eventIds: string[];
  notificationIds: string[];
  exhibitionIds: string[];
  exhibitionNoticeIds: string[];
  recipientsCompletedAt?: string;
  rosterStatus: "pending" | "linked" | "unlinked";
  attempts: number;
  nextAttemptAt: number;
};

/** Take this snapshot under auth -> exhibitions -> member-activities locks, before approval. */
export function prepareAccountSetup(users: User[]): AccountSetup {
  const approvedIds = users
    .filter(isMemberAccount)
    .map((user) => user.id);
  const everyone = (ids: string[]) => {
    const selected = new Set(ids);
    return (
      approvedIds.length > 0 && approvedIds.every((id) => selected.has(id))
    );
  };
  const activities = readActivities(),
    exhibitions = readExhibitions();
  return {
    eventIds: activities.events
      .filter((event) => everyone(event.recipientIds))
      .map((event) => event.id),
    notificationIds: activities.notifications
      .filter((notice) => everyone(notice.recipientIds))
      .map((notice) => notice.id),
    exhibitionIds: exhibitions.exhibitions
      .filter((exhibition) =>
        everyone(exhibition.participation?.recipientIds ?? []),
      )
      .map((exhibition) => exhibition.id),
    exhibitionNoticeIds: exhibitions.exhibitions.flatMap((exhibition) =>
      (exhibition.notices ?? [])
        .filter((notice) => everyone(notice.recipientIds))
        .map((notice) => notice.id),
    ),
    rosterStatus: "pending",
    attempts: 0,
    nextAttemptAt: 0,
  };
}

async function addAccountRecipients(userId: string) {
  return withStoreLock("auth", () =>
    withStoreLock("exhibitions", () =>
      withStoreLock("member-activities", () => {
        const users = readUsers(),
          user = users.find((user) => user.id === userId && isMemberAccount(user));
        const setup = user?.approvalSetup;
        if (!setup || setup.recipientsCompletedAt) return;
        const activities = readActivities(),
          exhibitions = readExhibitions(),
          at = new Date().toISOString();
        const add = (ids: string[]) => {
          if (ids.includes(userId)) return false;
          ids.push(userId);
          return true;
        };
        for (const event of activities.events) {
          if (setup.eventIds.includes(event.id) && add(event.recipientIds)) {
            event.revision++;
            event.updatedAt = at;
          }
        }
        for (const exhibition of exhibitions.exhibitions) {
          let changed = false;
          if (
            exhibition.participation &&
            setup.exhibitionIds.includes(exhibition.id)
          )
            changed = add(exhibition.participation.recipientIds) || changed;
          for (const notice of exhibition.notices ?? []) {
            if (!setup.exhibitionNoticeIds.includes(notice.id)) continue;
            changed = add(notice.recipientIds) || changed;
            const existing = activities.notifications.find(
              (item) => item.id === notice.id,
            );
            if (existing) {
              if (existing.exhibitionId !== exhibition.id)
                throw new Error("通知IDが重複しています。");
              add(existing.recipientIds);
            } else {
              // Materialize the persisted outbox entry, so an in-flight delivery using
              // an older snapshot cannot overwrite the new member's access.
              const notification = {
                id: notice.id,
                exhibitionId: exhibition.id,
                title: notice.title,
                body: notice.body,
                senderId: notice.senderId,
                senderName: notice.senderName,
                createdAt: notice.createdAt,
                recipientIds: [...notice.recipientIds],
                readBy: {},
                kind: "exhibition" as const,
              };
              activities.notifications.push(notification);
              enqueuePushNotice(activities, notification);
            }
          }
          if (changed) {
            exhibition.revision++;
            exhibition.updatedAt = at;
          }
        }
        for (const notice of activities.notifications)
          if (setup.notificationIds.includes(notice.id))
            add(notice.recipientIds);
        // The plan is saved with approval. If any write fails, replaying it is safe.
        writeData("exhibitions.json", exhibitions);
        writeData("member-activities.json", activities);
        setup.recipientsCompletedAt = at;
        writeData("users.json", users);
      }),
    ),
  );
}

async function linkAccountRoster(userId: string, relinkId?: string) {
  const expected = readUsers().find((user) => user.id === userId);
  if (relinkId && expected?.rosterRelink?.id !== relinkId) return;
  const before = readActivities().roster;
  const source: RosterSource = before ?? activityRosterSource;
  const incoming = await fetchActivityRoster(source);
  return withStoreLock("auth", () =>
    withStoreLock("member-activities", () => {
      const users = readUsers(),
        user = users.find((user) => user.id === userId && isMemberAccount(user));
      if (!user || (relinkId ? user.rosterRelink?.id !== relinkId || user.name !== expected?.name : !user.approvalSetup)) return;
      const data = readActivities(),
        current = data.roster ?? activityRosterSource;
      if (
        current.spreadsheetId !== source.spreadsheetId ||
        current.sheetId !== source.sheetId ||
        (data.roster?.revision ?? 0) !== (before?.revision ?? 0)
      )
        throw new Error("取得中に名簿が更新されました。");
      const at = new Date().toISOString(),
        next = reconcileRoster(data.roster, incoming.records, source, at);
      if (data.roster?.managedSource && next.departed.length)
        throw new Error(
          "名簿から外れた人がいます。管理者が変更内容を確認してください。",
        );
      if (source.term && next.gradeChanges.length)
        throw new Error("学年・復会の変更があります。幹部が名簿の変更内容を確認してください。");
      data.roster = {
        ...data.roster,
        spreadsheetId: source.spreadsheetId,
        sheetId: source.sheetId,
        ...incoming,
        records: data.roster?.managedSource ? next.records : incoming.records,
        retiredRecords: data.roster?.managedSource
          ? next.retiredRecords
          : data.roster?.retiredRecords,
        fetchedAt: at,
        fetchedBy: relinkId ? "account-name-update" : "account-approval",
        revision: (data.roster?.revision ?? 0) + 1,
        bindings: data.roster?.bindings ?? {},
      };
      const previousKey = data.roster.bindings[userId];
      if (relinkId) delete data.roster.bindings[userId];
      const candidates = relinkId ? users.map((owner) => owner.id === userId ? { ...owner, portfolioName: "" } : owner) : users;
      const key = (relinkId ? undefined : previousKey) || rosterSuggestions(data, candidates)[userId];
      if (key) data.roster.bindings[userId] = key;
      applyRosterProfiles(data, users);
      // A later approval also refreshes the roster. Keep still-valid queued grades
      // eligible, so it cannot cancel an earlier new member's initialization.
      for (const job of data.rosterPortfolioUpdates ?? []) {
        if (
          job.targetGrade &&
          (job.status === "pending" || job.status === "error") &&
          users.some(
            (owner) =>
              owner.id === job.userId && owner.portfolioId === job.portfolioId,
          ) &&
          data.roster.bindings[job.userId] === job.rosterKey &&
          linkedPortfolioGrade(job.portfolioId, users, data.roster) ===
            job.targetGrade
        )
          job.rosterFetchedAt = at;
      }
      if (relinkId && key)
        queueRosterPortfolioGrades(data, users, at, undefined, new Set([userId]));
      else if (previousKey !== key && key)
        queueRosterPortfolioGrades(data, users, at, new Set([userId]));
      if (source.term && next.added.length) {
        const exports = (data.rosterExports ??= []);
        for (const job of exports) if (job.term.year === source.term.year && job.term.season === source.term.season && job.status !== "done") job.status = "cancelled";
        exports.push({ id: crypto.randomUUID(), term: source.term, revision: data.roster.revision,
          records: structuredClone(data.roster.records), retiredRecords: structuredClone(data.roster.retiredRecords ?? []),
          status: "pending", attempts: 0, nextAttemptAt: 0 });
      }
      // Confirm only an active linked answer. Missing/ambiguous names need a person to resolve them.
      const status =
        key && data.roster.records.some((row) => row.key === key && row.active)
          ? "linked"
          : "unlinked";
      if (user.approvalSetup) user.approvalSetup.rosterStatus = status;
      if (relinkId) delete user.rosterRelink;
      writeData("member-activities.json", data);
      writeData("users.json", users);
      return status as "linked" | "unlinked";
    }),
  );
}

async function completeAccountRosterRelink(userId: string) {
  const request = readUsers().find((user) => user.id === userId && isMemberAccount(user))?.rosterRelink;
  if (!request) return undefined;
  try {
    return await linkAccountRoster(userId, request.id);
  } catch {
    await updateUsers((users) => {
      const current = users.find((user) => user.id === userId)?.rosterRelink;
      if (!current || current.id !== request.id) return;
      current.attempts++;
      current.nextAttemptAt = Date.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(current.attempts - 1, 7));
    });
    return "pending" as const;
  }
}

/** Persist the name first; retries never repeat approval, enrollment or email delivery. */
export async function syncAccountRosterAfterRename(userId: string) {
  return withStoreLock("account-review", () => completeAccountRosterRelink(userId));
}

/** Caller holds account-review; network calls never hold the auth or activities locks. */
export async function completeAccountSetup(userId: string) {
  const user = readUsers().find((user) => user.id === userId && isMemberAccount(user));
  if (!user?.approvalSetup) return "updated" as const;
  try {
    await addAccountRecipients(userId);
    if (user.approvalSetup.rosterStatus !== "linked")
      await linkAccountRoster(userId);
    await updateUsers((users) => {
      const setup = users.find((user) => user.id === userId)?.approvalSetup;
      if (setup) {
        setup.attempts = 0;
        setup.nextAttemptAt = 0;
      }
    });
  } catch {
    console.error("[account/setup] initial setup pending; retry scheduled");
    await updateUsers((users) => {
      const setup = users.find((user) => user.id === userId)?.approvalSetup;
      if (setup) {
        if (setup.rosterStatus !== "linked") setup.rosterStatus = "pending";
        setup.attempts++;
        setup.nextAttemptAt =
          Date.now() +
          Math.min(3600_000, 30_000 * 2 ** Math.min(setup.attempts - 1, 7));
      }
    });
    return "setup-failed" as const;
  }
  return readUsers().find((user) => user.id === userId)?.approvalSetup
    ?.rosterStatus === "unlinked"
    ? ("setup-unlinked" as const)
    : ("updated" as const);
}

/** Resume only recorded approvals; existing accounts are never enrolled retroactively. */
export async function drainAccountSetups(limit = 3, shouldStop = () => false) {
  let attempted = 0;
  const ids = readUsers()
    .filter(
      (user) =>
        isMemberAccount(user) &&
        ((user.rosterRelink && user.rosterRelink.nextAttemptAt <= Date.now()) || (user.approvalSetup &&
        (!user.approvalSetup.recipientsCompletedAt ||
          user.approvalSetup.rosterStatus === "pending") &&
        user.approvalSetup.nextAttemptAt <= Date.now())),
    )
    .slice(0, limit)
    .map((user) => user.id);
  for (const id of ids) {
    if (shouldStop()) break;
    await withStoreLock("account-review", async () => {
      const relink = readUsers().find((user) => user.id === id && isMemberAccount(user))?.rosterRelink;
      if (relink && relink.nextAttemptAt <= Date.now()) {
        attempted++;
        await completeAccountRosterRelink(id);
        return;
      }
      const setup = readUsers().find(
        (user) => user.id === id && isMemberAccount(user),
      )?.approvalSetup;
      if (
        !setup ||
        (setup.recipientsCompletedAt && setup.rosterStatus !== "pending") ||
        setup.nextAttemptAt > Date.now()
      )
        return;
      attempted++;
      await completeAccountSetup(id);
    });
  }
  return { attempted };
}

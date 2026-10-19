import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readActivities } from "./activities.ts";
import { readExhibitions, exhibitionAssetPath } from "./exhibitions.ts";
import { exhibitionOutputPath } from "./exhibitionDrive.ts";
import { dataPath, readData, writeData, withStoreLock } from "./store.ts";
import type { PublishedGroups, GroupRules } from "./activityTypes.ts";
import type { GroupingTools } from "./groupingTools.ts";
import type { AdvanceRequest } from "./advanceRequests.ts";
import { recordLayoutVersion } from "./exhibitionLayoutHistory.ts";

export const deletionChecks = {
  external:
    "Google Forms・Sheets・Drive・Lightroomにある本人の提出データ、写真、本人情報を含む出力を削除しました。",
  media:
    "microCMSの本人の画像原本・個人情報を確認し、共有参照を確認したうえで削除しました。",
  accounting:
    "会計担当者と確認し、本人の立替申請・領収書・送金情報を外部保存先から削除しました。",
  backups:
    "本人情報を含む旧バックアップを削除または匿名化し、削除後の状態を復元しない運用にしました。",
  shared:
    "組織で共有する文章・写真・名簿の参照元を確認し、本人を特定できる情報を削除しました。",
};
function receipts(userId: string) {
  const directory = path.dirname(dataPath("users.json"));
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => /^REC-[a-f0-9]{32}\.json$/.test(name))
    .flatMap((name) => {
      const value = readData<{
        ownerId: string;
        id: string;
        driveFileId?: string;
        url?: string;
      }>(name, { ownerId: "", id: "" });
      return value.ownerId === userId ? [value] : [];
    });
}
/** The inventory stays in the restricted admin request until external cleanup is confirmed. */
export function deletionInventory(userId: string, portfolioId: string | null) {
  const activity = readActivities(),
    data = readExhibitions(),
    submissions = data.submissions.filter((s) => s.userId === userId);
  const submissionIds = new Set(submissions.map((s) => s.id)),
    affected = new Set(submissions.map((s) => s.exhibitionId));
  return {
    portfolioId,
    rosterKey: activity.roster?.bindings[userId] ?? null,
    exhibitions: data.exhibitions
      .filter((e) => affected.has(e.id))
      .map((e) => ({
        id: e.id,
        title: e.title,
        googleForms: e.googleForms,
        driveFolder: e.driveFolders?.folderId ?? null,
        albumId: e.albumId,
        submissionIds: submissions
          .filter((s) => s.exhibitionId === e.id)
          .map((s) => s.id),
        workIds: [
          ...new Set(
            submissions
              .filter((s) => s.exhibitionId === e.id)
              .flatMap((s) =>
                [s.draft, ...s.versions.map((v) => v.content)].flatMap((c) =>
                  c.works.map((w) => w.id),
                ),
              ),
          ),
        ],
        assets: data.assets
          .filter((a) => submissionIds.has(a.submissionId))
          .map((a) => ({
            id: a.id,
            lightroomId: a.lightroomId,
            driveFileId: a.drive?.fileId ?? null,
          })),
        outputs: (data.outputs ?? [])
          .filter((o) => o.exhibitionId === e.id)
          .map((o) => ({
            id: o.id,
            name: o.name,
            driveFileId: o.drive.fileId ?? null,
          })),
      })),
    receipts: receipts(userId).map((r) => ({
      id: r.id,
      driveFileId: r.driveFileId ?? null,
      url: r.url ?? null,
    })),
  };
}
export type DeletionInventory = ReturnType<typeof deletionInventory>;
function cleanRules(rules: GroupRules, ids: Set<string>) {
  rules.leaders = rules.leaders.filter((id) => !ids.has(id));
  rules.together = rules.together
    .map((pair) => pair.filter((id) => !ids.has(id)))
    .filter((pair) => pair.length > 1);
  rules.apart = rules.apart
    .map((pair) => pair.filter((id) => !ids.has(id)))
    .filter((pair) => pair.length > 1);
}
function anonymizeGroups(
  groups: PublishedGroups | undefined,
  ids: Set<string>,
  anonymous: string,
) {
  if (!groups) return;
  for (const id of ids)
    if (Object.hasOwn(groups.names, id)) {
      delete groups.names[id];
      groups.names[anonymous] = "削除済みメンバー";
    }
  if (groups.people)
    groups.people = groups.people.filter((p) => !ids.has(p.id));
  for (const group of groups.groups) {
    if (ids.has(group.leaderId)) group.leaderId = anonymous;
    group.memberIds = group.memberIds.map((id) =>
      ids.has(id) ? anonymous : id,
    );
  }
  if (groups.rules) cleanRules(groups.rules, ids);
  for (const group of groups.previousGroups ?? []) {
    if (ids.has(group.leaderId)) group.leaderId = anonymous;
    group.memberIds = group.memberIds.map((id) =>
      ids.has(id) ? anonymous : id,
    );
  }
}
/** Idempotent local cleanup. External services and backup copies require the admin checklist. */
export async function cleanupAccountReferences(
  userId: string,
  rosterKey: string | null,
  requestId: string,
  inventory?: DeletionInventory,
) {
  const ids = new Set([userId, ...(rosterKey ? [rosterKey] : [])]);
  const anonymous = `deleted-${crypto.createHash("sha256").update(requestId).digest("hex").slice(0, 20)}`;
  await withStoreLock("member-activities", () => {
    const data = readActivities();
    delete data.profiles[userId];
    if (data.roster) {
      const before = JSON.stringify(data.roster);
      delete data.roster.bindings[userId];
      data.roster.records = data.roster.records.filter((r) => !ids.has(r.key));
      if (data.roster.retiredRecords)
        data.roster.retiredRecords = data.roster.retiredRecords.filter(
          (r) => !ids.has(r.key),
        );
      if (before !== JSON.stringify(data.roster)) data.roster.revision++;
    }
    data.rosterPortfolioUpdates = data.rosterPortfolioUpdates?.filter(
      (r) => r.userId !== userId,
    );
    data.notifications = data.notifications.filter(
      (n) => !(n.recipientIds.length === 1 && n.recipientIds[0] === userId),
    );
    for (const n of data.notifications) {
      n.recipientIds = n.recipientIds.filter((id) => id !== userId);
      delete n.readBy[userId];
      if (n.senderId === userId) {
        n.senderId = anonymous;
        n.senderName = "削除済みメンバー";
      }
    }
    for (const e of data.events) {
      const before = JSON.stringify(e);
      e.recipientIds = e.recipientIds.filter((id) => id !== userId);
      delete e.votes[userId];
      if (e.ownerId === userId) {
        e.ownerId = anonymous;
        e.ownerName = "削除済みメンバー";
      }
      if (
        e.draftGroups?.groups.some((g) => g.memberIds.some((id) => ids.has(id)))
      )
        delete e.draftGroups;
      cleanRules(e.rules, ids);
      anonymizeGroups(e.publishedGroups, ids, anonymous);
      for (const group of e.groupHistory)
        anonymizeGroups(group, ids, anonymous);
      if (before !== JSON.stringify(e)) e.revision++;
    }
    for (const e of data.eventGroupingHistory ?? [])
      anonymizeGroups(e.publishedGroups, ids, anonymous);
    writeData("member-activities.json", data);
  });
  await withStoreLock("grouping-tools", () => {
    const data = readData<GroupingTools>("grouping-tools.json", {
      version: 1,
      runs: [],
    });
    if (data.version !== 1 || !Array.isArray(data.runs))
      throw new Error("班分け履歴を読み込めません。");
    for (const run of data.runs) {
      const before = JSON.stringify(run);
      run.participantIds = run.participantIds.filter((id) => !ids.has(id));
      run.guests = run.guests?.filter((p) => !ids.has(p.id));
      cleanRules(run.rules, ids);
      if (
        run.draftGroups?.groups.some((group) =>
          group.memberIds.some((id) => ids.has(id)),
        )
      )
        delete run.draftGroups;
      anonymizeGroups(run.publishedGroups, ids, anonymous);
      anonymizeGroups(run.previousSnapshot?.publishedGroups, ids, anonymous);
      if (before !== JSON.stringify(run)) run.revision++;
    }
    writeData("grouping-tools.json", data);
  });
  await withStoreLock("exhibitions", () => {
    const data = readExhibitions(),
      removed = data.submissions.filter((s) => s.userId === userId),
      submissionIds = new Set([
        ...removed.map((s) => s.id),
        ...(inventory?.exhibitions ?? []).flatMap((e) => e.submissionIds ?? []),
      ]);
    const affected = new Set([
        ...removed.map((s) => s.exhibitionId),
        ...(inventory?.exhibitions ?? []).map((e) => e.id),
      ]),
      workIds = new Set([
        ...(inventory?.exhibitions ?? []).flatMap((e) => e.workIds ?? []),
        ...removed.flatMap((s) =>
          [s.draft, ...s.versions.map((v) => v.content)].flatMap((c) =>
            c.works.map((w) => w.id),
          ),
        ),
      ]);
    for (const a of data.assets.filter((a) =>
      submissionIds.has(a.submissionId),
    )) {
      fs.rmSync(exhibitionAssetPath(a.id), { force: true });
      fs.rmSync(exhibitionAssetPath(a.id, true), { force: true });
    }
    for (const o of (data.outputs ?? []).filter((o) =>
      affected.has(o.exhibitionId),
    ))
      fs.rmSync(exhibitionOutputPath(o.id), { force: true });
    data.submissions = data.submissions.filter((s) => !submissionIds.has(s.id));
    data.assets = data.assets.filter((a) => !submissionIds.has(a.submissionId));
    data.outputs = data.outputs?.filter((o) => !affected.has(o.exhibitionId));
    for (const a of data.layoutAssets ?? [])
      if (a.actorId === userId) a.actorId = anonymous;
    for (const e of data.exhibitions) {
      const before = JSON.stringify(e),
        roomsBefore = JSON.stringify(e.rooms);
      if (e.participation) {
        e.participation.recipientIds = e.participation.recipientIds.filter(
          (id) => id !== userId,
        );
        delete e.participation.votes[userId];
      }
      if (e.notices)
        for (const n of e.notices) {
          n.recipientIds = n.recipientIds.filter((id) => id !== userId);
          if (n.senderId === userId) {
            n.senderId = anonymous;
            n.senderName = "削除済みメンバー";
          }
        }
      for (const room of [
        ...e.rooms,
        ...(e.layoutHistory ?? []).flatMap((v) => v.rooms),
      ]) {
        room.placements = room.placements.filter((p) => !workIds.has(p.workId));
        room.books = room.books.filter((p) => !workIds.has(p.workId));
        room.boardPlacements = room.boardPlacements?.filter(
          (p) => !workIds.has(p.workId),
        );
        room.titleBoards = room.titleBoards?.filter(
          (p) => !workIds.has(p.workId),
        );
      }
      for (const history of [e.layoutCurrent, ...(e.layoutHistory ?? [])])
        if (history?.actorId === userId) {
          history.actorId = anonymous;
          history.actorName = "削除済みメンバー";
        }
      e.layoutReceipts = e.layoutReceipts?.filter(
        (receipt) => receipt.actorId !== userId,
      );
      // Commit sanitized rooms through the collaboration protocol; never snapshot the unsanitized rooms.
      if (roomsBefore !== JSON.stringify(e.rooms))
        recordLayoutVersion(e, e.rooms, {
          id: anonymous,
          name: "個人データの削除",
        });
      if (before !== JSON.stringify(e)) e.revision++;
    }
    writeData("exhibitions.json", data);
  });
  await withStoreLock("advance-requests", () => {
    const data = readData<AdvanceRequest[]>("advance-requests.json", []);
    if (!Array.isArray(data)) throw new Error("立替申請を読み込めません。");
    writeData(
      "advance-requests.json",
      data.filter((r) => r.payload.websiteUserId !== userId),
    );
  });
  for (const r of receipts(userId))
    await withStoreLock(r.id, () => {
      fs.rmSync(dataPath(`${r.id}.bin`), { force: true });
      fs.rmSync(dataPath(`${r.id}.json`), { force: true });
    });
}

import crypto from "node:crypto";
import { readUsers, isExecutive, type User } from "./auth.ts";
import { readActivities, ActivityError } from "./activities.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import {
  parseRosterSource,
  fetchActivityRoster,
  applyRosterProfiles,
  rosterSuggestions,
  activityRosterSource,
  type RosterSource,
} from "./activityRoster.ts";
import {
  reconcileRoster,
  removeDepartedRules,
} from "./rosterReconciliation.ts";
import { audit } from "./audit.ts";
import { queueRosterPortfolioGrades } from "./portfolioRosterGrade.ts";
import { resolveTermSource, rosterSourceIdentity } from "./termRoster.ts";
import { unavailableClubFormSource } from "./clubFormDeletion.ts";

type Preview = {
  id: string;
  actorId: string;
  createdAt: number;
  revision: number;
  usersHash: string;
  source: RosterSource;
  incoming: Awaited<ReturnType<typeof fetchActivityRoster>>;
};
const hash = (data: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
const usersHash = (users: User[]) =>
  hash(
    users.map((u) => [
      u.id,
      u.name,
      u.portfolioName,
      u.approved,
      u.portfolioId,
    ]),
  );
const previewFile = "roster-previews.json";
function rosterSourceChanged(
  previous: RosterSource | undefined,
  next: RosterSource,
) {
  const current = previous || activityRosterSource;
  return rosterSourceIdentity(current) !== rosterSourceIdentity(next);
}
function previews() {
  return readData<Preview[]>(previewFile, []).filter(
    (p) => Date.now() - p.createdAt < 20 * 60_000,
  );
}
function administrator(id: string) {
  const users = readUsers();
  if (!isExecutive(users.find((u) => u.id === id)))
    throw new ActivityError("名簿の参照先変更は幹部以上のみ行えます。", 403);
  return users;
}
export function readRosterPreview(actorId: string, id: string) {
  administrator(actorId);
  return previews().find((p) => p.id === id && p.actorId === actorId);
}
export function rosterPreviewSummary(preview: Preview) {
  const data = readActivities(),
    users = readUsers();
  const result = reconcileRoster(
    data.roster,
    preview.incoming.records,
    preview.source,
    new Date(preview.createdAt).toISOString(),
  );
  return {
    ...result,
    sourceChanged: rosterSourceChanged(data.roster, preview.source),
    departures: result.departed.map((row) => ({
      ...row,
      accounts: users
        .filter((u) => data.roster?.bindings[u.id] === row.key)
        .map((u) => ({ name: u.name, portfolioId: u.portfolioId })),
    })),
    linkCandidates: preview.source.term
      ? Object.entries(
          rosterSuggestions(
            {
              ...data,
              roster: {
                ...preview.source,
                ...preview.incoming,
                records: result.records,
                bindings: { ...data.roster?.bindings },
                revision: 0,
                fetchedAt: "",
                fetchedBy: "",
              },
            },
            users,
          ),
        ).map(([userId, key]) => ({
          userId,
          name: users.find((user) => user.id === userId)?.name ?? "",
          rosterName: result.records.find((row) => row.key === key)?.name ?? "",
        }))
      : [],
  };
}
export async function rosterChangeAction(
  actorId: string,
  p: Record<string, unknown>,
) {
  const users = administrator(actorId),
    before = readActivities();
  if (p.action === "roster.retry") {
    return withStoreLock("auth", () =>
      withStoreLock("member-activities", () => {
        administrator(actorId);
        const data = readActivities();
        for (const job of data.rosterPortfolioUpdates || [])
          if (job.status === "error") {
            job.status = "pending";
            job.attempts = 0;
            job.message = undefined;
          }
        for (const job of data.rosterExports ?? [])
          if (job.status === "error") {
            job.status = "pending";
            job.attempts = 0;
            job.nextAttemptAt = 0;
            delete job.error;
          }
        writeData("member-activities.json", data);
        return { ok: true };
      }),
    );
  }
  if (p.action === "roster.preview") {
    if (p.revision !== (before.roster?.revision ?? 0))
      throw new ActivityError(
        "名簿が更新されています。再読み込みしてください。",
        409,
      );
    let source: RosterSource, incoming: Preview["incoming"];
    try {
      source =
        p.mode === "term"
          ? await resolveTermSource(
              p.year,
              p.season,
              p.admissionUrl,
              p.continuationUrl,
            )
          : parseRosterSource(p.url);
      if (unavailableClubFormSource(source))
        throw new Error(
          "削除中または削除済みのフォームを名簿に使用できません。",
        );
      incoming = await fetchActivityRoster(source);
    } catch (error) {
      throw new ActivityError(
        error instanceof Error ? error.message : "名簿を取得できませんでした。",
        400,
      );
    }
    return withStoreLock("auth", () =>
      withStoreLock("member-activities", () => {
        const current = administrator(actorId);
        if (
          p.revision !== (readActivities().roster?.revision ?? 0) ||
          usersHash(current) !== usersHash(users)
        )
          throw new ActivityError(
            "取得中に名簿またはアカウントが更新されました。再確認してください。",
            409,
          );
        const preview: Preview = {
          id: crypto.randomUUID(),
          actorId,
          createdAt: Date.now(),
          revision: Number(p.revision),
          usersHash: usersHash(current),
          source,
          incoming,
        };
        writeData(previewFile, [
          ...previews()
            .filter((x) => x.actorId !== actorId)
            .slice(-9),
          preview,
        ]);
        return { ok: true, previewId: preview.id };
      }),
    );
  }
  if (
    p.action !== "roster.apply" ||
    typeof p.previewId !== "string" ||
    p.confirm !== true
  )
    throw new ActivityError("名簿の変更内容と退会対象を確認してください。");
  if (before.rosterChangeId === p.previewId) return { ok: true };
  const preview = readRosterPreview(actorId, p.previewId);
  if (!preview)
    throw new ActivityError(
      "確認画面の有効期限が切れました。変更内容を取得し直してください。",
      409,
    );
  if (unavailableClubFormSource(preview.source))
    throw new ActivityError(
      "削除中または削除済みのフォームを名簿に使用できません。",
      409,
    );
  const fresh = await fetchActivityRoster(preview.source);
  if (hash(fresh) !== hash(preview.incoming))
    throw new ActivityError(
      "確認後にGoogle名簿が変わりました。変更内容を取得し直してください。",
      409,
    );
  const result = await withStoreLock("auth", () =>
    withStoreLock("member-activities", () => {
      const current = administrator(actorId),
        data = readActivities();
      if (data.rosterChangeId === preview.id) return { ok: true };
      if (unavailableClubFormSource(preview.source))
        throw new ActivityError(
          "削除中または削除済みのフォームを名簿に使用できません。",
          409,
        );
      if (
        preview.revision !== (data.roster?.revision ?? 0) ||
        preview.usersHash !== usersHash(current)
      )
        throw new ActivityError(
          "確認後に名簿またはアカウントが更新されました。変更内容を取得し直してください。",
          409,
        );
      const at = new Date().toISOString(),
        next = reconcileRoster(data.roster, fresh.records, preview.source, at);
      const sourceChanged = rosterSourceChanged(data.roster, preview.source);
      writeData(`roster-backup-${preview.id}.json`, {
        at,
        actorId,
        roster: data.roster,
        profiles: data.profiles,
        events: data.events,
        rosterPortfolioUpdates: data.rosterPortfolioUpdates,
        rosterExports: data.rosterExports,
      });
      const bindings = data.roster?.bindings || {};
      const previousKeys = new Set(Object.keys(bindings));
      data.roster = {
        ...preview.source,
        ...fresh,
        records: next.records,
        retiredRecords: next.retiredRecords,
        bindings,
        revision: preview.revision + 1,
        fetchedAt: at,
        fetchedBy: actorId,
        managedSource: true,
      };
      data.rosterChangeId = preview.id;
      if (preview.source.term)
        Object.assign(bindings, rosterSuggestions(data, current));
      applyRosterProfiles(data, current);
      const departedKeys = new Set(next.retiredRecords.map((r) => r.key));
      const departedUsers = new Set(
        Object.keys(bindings).filter((id) => departedKeys.has(bindings[id])),
      );
      for (const event of data.events) {
        const rules = removeDepartedRules(event.rules, departedUsers);
        if (
          JSON.stringify(rules) !== JSON.stringify(event.rules) ||
          event.draftGroups?.groups.some((g) =>
            g.memberIds.some((id) => departedUsers.has(id)),
          )
        ) {
          event.rules = rules;
          delete event.draftGroups;
          event.revision++;
          event.updatedAt = at;
        }
      }
      data.rosterPortfolioUpdates ||= [];
      for (const row of next.departed)
        for (const user of current.filter(
          (u) => bindings[u.id] === row.key && u.portfolioId,
        )) {
          const shared =
            current.filter((u) => u.portfolioId === user.portfolioId).length !==
            1;
          data.rosterPortfolioUpdates.push({
            id: crypto.randomUUID(),
            userId: user.id,
            portfolioId: user.portfolioId!,
            rosterKey: row.key,
            name: row.name,
            status: shared ? "error" : "pending",
            attempts: 0,
            createdAt: at,
            updatedAt: at,
            message: shared
              ? "Portfolioを複数のアカウントが参照しています。連携を確認してください。"
              : undefined,
          });
        }
      if (preview.source.term) {
        const changedKeys = new Set(
          next.gradeChanges
            .filter((change) => change.after)
            .map((change) => change.key),
        );
        const changedUsers = new Set(
          current
            .filter(
              (user) =>
                previousKeys.has(user.id) && changedKeys.has(bindings[user.id]),
            )
            .map((user) => user.id),
        );
        queueRosterPortfolioGrades(data, current, at, undefined, changedUsers);
        queueRosterPortfolioGrades(
          data,
          current,
          at,
          new Set(Object.keys(bindings).filter((id) => !previousKeys.has(id))),
        );
        for (const job of data.rosterPortfolioUpdates ?? []) {
          if (
            !job.targetGrade ||
            (job.status !== "pending" && job.status !== "error")
          )
            continue;
          const row = data.roster.records.find(
            (row) => row.active && row.key === job.rosterKey,
          );
          if (
            row &&
            !next.gradeChanges.some((change) => change.key === row.key)
          )
            job.rosterFetchedAt = at;
        }
        const exports = (data.rosterExports ??= []);
        for (const job of exports)
          if (
            job.term.year === preview.source.term.year &&
            job.term.season === preview.source.term.season &&
            job.status !== "done"
          )
            job.status = "cancelled";
        exports.push({
          id: preview.id,
          term: preview.source.term,
          revision: data.roster.revision,
          records: structuredClone(data.roster.records),
          retiredRecords: structuredClone(data.roster.retiredRecords ?? []),
          status: "pending",
          attempts: 0,
          nextAttemptAt: 0,
        });
      } else if (sourceChanged) queueRosterPortfolioGrades(data, current, at);
      writeData("member-activities.json", data);
      return { ok: true, departed: next.departed.length };
    }),
  );
  const { queueAccountingRoster } = await import("./accountingRoster.ts");
  await queueAccountingRoster().catch(() => console.error("accounting.roster: will retry in worker"));
  await audit(
    actorId,
    "activities.roster.source",
    preview.source.spreadsheetId,
  ).catch(() => console.error("[roster] audit failed"));
  return result;
}

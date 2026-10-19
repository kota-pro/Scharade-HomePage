import { publishedGroupPeople } from "./groupPresentation.ts";
import crypto from "node:crypto";
import { readUsers, isStaff } from "./auth.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import {
  readActivities,
  ActivityError,
  parseRules,
  parseGroups,
} from "./activities.ts";
import {
  defaultRules,
  type ActivityStore,
  type GroupRules,
  type GroupPlan,
  type PublishedGroups,
  type Participant,
} from "./activityTypes.ts";
import {
  generateGroups,
  groupPairs,
  groupScore,
  validateGroups,
} from "./grouping.ts";
import { audit } from "./audit.ts";
import { activeGuests, guestExpiry, parseGuest, rosterParticipants, previewGroupingParticipants, type GroupingGuest } from "./groupingParticipants.ts";
import { removeDepartedRules } from "./rosterReconciliation.ts";

export type GroupingReference = {
  id: string;
  title: string;
  publishedGroups: PublishedGroups;
};
export type GroupingRun = {
  id: string;
  title: string;
  revision: number;
  participantIds: string[];
  guests?: Participant[];
  previousRunId: string;
  previousSnapshot?: GroupingReference;
  createdAt: string;
  updatedAt: string;
  rules: GroupRules;
  draftGroups?: GroupPlan;
  publishedGroups?: PublishedGroups;
};
export type GroupingTools = { version: 1; runs: GroupingRun[]; guests?: GroupingGuest[] };
const file = "grouping-tools.json";
export function readGroupingTools(): GroupingTools {
  const data = readData<GroupingTools>(file, { version: 1, runs: [] });
  if (data.version !== 1 || !Array.isArray(data.runs))
    throw new Error("班分けツールの保存データを確認してください。");
  if (data.guests) data.guests = activeGuests(data.guests);
  const retired = new Set(
    readActivities().roster?.retiredRecords?.map((r) => r.key) || [],
  );
  for (const run of data.runs) {
    if (!run.participantIds.some((id) => retired.has(id))) continue;
    run.participantIds = run.participantIds.filter((id) => !retired.has(id));
    run.rules = removeDepartedRules(run.rules, retired);
    delete run.draftGroups;
    run.revision++;
  }
  return data;
}
export function groupingPeople(
  activities: ActivityStore,
  run: GroupingRun,
): Participant[] {
  return run.participantIds.map((id) => {
    const guest = run.guests?.find(p => p.id === id);
    if (guest) return { ...guest };
    const row = activities.roster?.records.find((r) => r.key === id);
    return {
      id,
      name: row ? row.name : "名簿から削除されたメンバー",
      lineName: row?.lineName,
      gender: row?.active ? row.gender! : undefined!,
      grade: row?.active ? row.grade! : undefined!,
    };
  });
}
export function groupingToolSummary(
  activities: ActivityStore,
  data: GroupingTools,
  run: GroupingRun,
) {
  const people = groupingPeople(activities, run);
  const previous =
    data.runs.find((r) => r.id === run.previousRunId) ||
    (run.previousSnapshot?.id === run.previousRunId
      ? run.previousSnapshot
      : undefined);
  const source = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        people: people.map(({ lineName, ...p }) => p),
        rules: run.rules,
        previous: previous ? [previous.id, previous.publishedGroups] : null,
      }),
    )
    .digest("hex");
  return {
    people,
    publishedPeople: publishedGroupPeople(
      run.publishedGroups,
      (activities.roster?.records || []).map((row) => ({
        id: row.key,
        name: row.name,
        lineName: row.lineName,
        gender: row.gender!,
        grade: row.grade!,
      })),
    ),
    previous,
    source,
    stale: !!run.draftGroups && source !== run.draftGroups.source,
    problems: run.draftGroups
      ? validateGroups(people, run.rules, run.draftGroups.groups)
      : [],
    score: run.draftGroups
      ? groupScore(
          people,
          run.draftGroups.groups,
          groupPairs(previous?.publishedGroups?.groups || []),
        )
      : null,
  };
}
function touchGuests(data: GroupingTools, run: GroupingRun, now: string) {
  if (!run.guests?.length) return;
  const selected = new Set(run.guests.map(p => p.id));
  data.guests = [...activeGuests(data.guests).filter(p => !selected.has(p.id)),
    ...run.guests.map(p => ({ ...p, lastUsedAt: now, expiresAt: guestExpiry(now) }))];
}
function checkedRun(data: GroupingTools, p: Record<string, unknown>) {
  const run = data.runs.find((r) => r.id === p.runId);
  if (!run) throw new ActivityError("班分けが見つかりません。", 404);
  if (run.revision !== p.revision)
    throw new ActivityError(
      "ほかの操作で更新されています。再読み込みして確認してください。",
      409,
    );
  return run;
}
function ready(
  activities: ActivityStore,
  data: GroupingTools,
  run: GroupingRun,
) {
  const summary = groupingToolSummary(activities, data, run);
  const missing = summary.people.filter((p) => !p.gender || !p.grade);
  if (missing.length)
    throw new ActivityError(
      `Google名簿の確認が必要です：${missing.map((p) => p.name).join("、")}。管理者に名簿の更新を依頼し、参加者を再確認してください。`,
      409,
    );
  return summary;
}
// Same lock order as roster updates; generation runs outside the locks and
// rechecks both authorization and the full input snapshot before committing.
async function transaction<T>(
  actorId: string,
  apply: (data: GroupingTools, activities: ActivityStore) => T,
) {
  return withStoreLock("auth", () =>
    withStoreLock("member-activities", () =>
      withStoreLock("grouping-tools", () => {
        if (!isStaff(readUsers().find((u) => u.id === actorId)))
          throw new ActivityError("運営以上の権限が必要です。", 403);
        const data = readGroupingTools();
        const result = apply(data, readActivities());
        writeData(file, data);
        return result;
      }),
    ),
  );
}
export async function groupingToolAction(
  actorId: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ActivityError("入力内容を確認してください。");
  const p = input as Record<string, unknown>;
  if (p.action === "participants.preview") {
    if (!isStaff(readUsers().find(u => u.id === actorId))) throw new ActivityError("運営以上の権限が必要です。", 403);
    const preview = await previewGroupingParticipants(p.url, p.columns);
    if (!isStaff(readUsers().find(u => u.id === actorId))) throw new ActivityError("運営以上の権限が必要です。", 403);
    return preview;
  }
  let result: Record<string, unknown>;
  if (p.action === "groups.generate") {
    const snapshot = await transaction(actorId, (data, activities) => {
      const run = checkedRun(data, p),
        summary = ready(activities, data, run);
      return { ...summary, rules: run.rules, revision: run.revision };
    });
    const generated = await generateGroups(
      snapshot.people,
      snapshot.rules,
      groupPairs(snapshot.previous?.publishedGroups?.groups || []),
    );
    if (!generated.groups)
      throw new ActivityError(
        generated.problems.join("\n"),
        generated.status === "timeout" ? 422 : 400,
      );
    result = await transaction(actorId, (data, activities) => {
      const run = checkedRun(data, { ...p, revision: snapshot.revision });
      const summary = ready(activities, data, run);
      if (summary.source !== snapshot.source)
        throw new ActivityError(
          "生成中に名簿・条件・履歴が変わりました。再生成してください。",
          409,
        );
      const now = new Date().toISOString();
      touchGuests(data, run, now);
      run.draftGroups = {
        groups: generated.groups!,
        source: summary.source,
        savedAt: now,
        savedBy: actorId,
      };
      run.revision++;
      run.updatedAt = now;
      return { ok: true, runId: run.id };
    });
  } else {
    result = await transaction(actorId, (data, activities) => {
      const now = new Date().toISOString();
      if (p.action === "run.delete") {
        const run = checkedRun(data, p);
        if (p.confirmation !== "delete")
          throw new ActivityError("削除する班分けを確認してください。");
        for (const other of data.runs) {
          if (
            other.id !== run.id &&
            other.previousRunId === run.id &&
            run.publishedGroups
          ) {
            other.previousSnapshot = {
              id: run.id,
              title: run.title,
              publishedGroups: structuredClone(run.publishedGroups),
            };
          }
        }
        data.runs = data.runs.filter((r) => r.id !== run.id);
        return { ok: true, runId: run.id };
      }
      if (p.action === "run.save") {
        const existing = p.runId ? checkedRun(data, p) : undefined;
        if (
          typeof p.title !== "string" ||
          !p.title.trim() ||
          p.title.length > 200
        )
          throw new ActivityError("班分け名を200文字以内で入力してください。");
        const available = new Map([...rosterParticipants(activities), ...activeGuests(data.guests), ...(existing?.guests || [])].map(p => [p.id, p]));
        if (p.extraParticipants !== undefined && (!Array.isArray(p.extraParticipants) || p.extraParticipants.length > 200))
          throw new ActivityError("追加参加者は200人以内にしてください。");
        const additions = (p.extraParticipants as unknown[] || []).map(parseGuest);
        for (const guest of additions) {
          if (available.has(guest.id)) continue; // Existing identities and attributes cannot be overwritten by submitted data.
          if (data.runs.some(r => r.guests?.some(p => p.id === guest.id)))
            throw new ActivityError("参加者候補が変わりました。再読み込みしてください。", 409);
          available.set(guest.id, guest);
        }
        if (!Array.isArray(p.participantIds) || !p.participantIds.length || p.participantIds.length > 200 ||
            p.participantIds.some(id => typeof id !== "string" || !available.has(id)))
          throw new ActivityError("性別・学年を確認した参加者を1〜200人選択してください。候補の有効期限が切れた場合は再度追加してください。");
        const ids = [...new Set(p.participantIds as string[])];
        const previousId =
          p.previousRunId ??
          existing?.previousRunId ??
          [...data.runs]
            .filter((r) => r.publishedGroups)
            .sort((a, b) =>
              b.publishedGroups!.publishedAt.localeCompare(
                a.publishedGroups!.publishedAt,
              ),
            )[0]?.id ??
          "";
        if (
          typeof previousId !== "string" ||
          (previousId &&
            (previousId === existing?.id ||
              (!data.runs.some(
                (r) => r.id === previousId && r.publishedGroups,
              ) &&
                existing?.previousSnapshot?.id !== previousId)))
        )
          throw new ActivityError(
            "前回の班分けを確定済みの履歴から選択してください。",
          );
        const run: GroupingRun = existing || {
          id: crypto.randomUUID(),
          title: "",
          revision: 0,
          participantIds: [],
          previousRunId: "",
          rules: defaultRules(),
          createdAt: now,
          updatedAt: now,
        };
        run.title = p.title.trim();
        run.participantIds = ids;
        run.guests = ids.filter(id => id.startsWith("guest-")).map(id => parseGuest(available.get(id)));
        touchGuests(data, run, now);
        run.previousRunId = previousId;
        if (run.previousSnapshot?.id !== previousId)
          delete run.previousSnapshot;
        run.rules.leaders = run.rules.leaders.filter((id) => ids.includes(id));
        run.rules.together = run.rules.together.filter((pair) =>
          pair.every((id) => ids.includes(id)),
        );
        run.rules.apart = run.rules.apart.filter((pair) =>
          pair.every((id) => ids.includes(id)),
        );
        run.updatedAt = now;
        run.revision++;
        if (!existing) data.runs.push(run);
        return { ok: true, runId: run.id };
      }
      const run = checkedRun(data, p),
        summary = ready(activities, data, run);
      const people = summary.people;
      if (p.action === "groups.rules") {
        const rules = parseRules(p.rules);
        if (
          [
            ...rules.leaders,
            ...rules.together.flat(),
            ...rules.apart.flat(),
          ].some((id) => !run.participantIds.includes(id))
        )
          throw new ActivityError(
            "班分けの指定対象は参加者から選択してください。",
          );
        run.rules = rules;
      } else if (p.action === "groups.save" || p.action === "groups.publish") {
        if (p.source !== summary.source)
          throw new ActivityError(
            "名簿・参加者・条件・履歴が変わりました。再読み込みして班案を確認してください。",
            409,
          );
        if (p.action === "groups.save") {
          const groups = parseGroups(p.groups);
          if (
            groups.some((g) =>
              [...g.memberIds, g.leaderId].some(
                (id) => !run.participantIds.includes(id),
              ),
            )
          )
            throw new ActivityError("参加者以外を班に含めることはできません。");
          run.draftGroups = {
            groups,
            source: summary.source,
            savedAt: now,
            savedBy: actorId,
          };
        } else {
          if (!run.draftGroups || run.draftGroups.source !== summary.source)
            throw new ActivityError(
              "班案を保存・再確認してから確定してください。",
              409,
            );
          const problems = validateGroups(
            people,
            run.rules,
            run.draftGroups.groups,
          );
          if (problems.length) throw new ActivityError(problems.join("\n"));
          touchGuests(data, run, now);
          run.publishedGroups = {
            ...structuredClone(run.draftGroups),
            names: Object.fromEntries(people.map((p) => [p.id, p.name])),
            people: structuredClone(people),
            rules: structuredClone(run.rules),
            previousGroups: structuredClone(
              summary.previous?.publishedGroups?.groups || [],
            ),
            publishedAt: now,
            version: (run.publishedGroups?.version || 0) + 1,
          };
        }
      } else throw new ActivityError("未対応の操作です。");
      run.revision++;
      run.updatedAt = now;
      return { ok: true, runId: run.id };
    });
  }
  await audit(actorId, `grouping-tool.${p.action}`, String(result.runId)).catch(
    () => console.error("[grouping-tool] audit write failed"),
  );
  return result;
}

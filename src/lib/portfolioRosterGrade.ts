import crypto from "node:crypto";
import type { ActivityRoster, ActivityStore, Grade } from "./activityTypes.ts";
import type { User } from "./auth.ts";

const portfolioGrades: Partial<Record<Grade, string>> = {
  "1": "1st Grade",
  "2": "2nd Grade",
  "3": "3rd Grade",
  "4": "4th Grade",
  master: "Master's Program",
  doctorate: "Doctor's Program",
  alumni: "OB/OG",
};

/** Resolve the edited Portfolio's owner, including when an administrator edits another member. */
export function linkedPortfolioGrade(
  portfolioId: string,
  users: Pick<User, "id" | "portfolioId">[],
  roster: ActivityRoster | undefined,
): string | null {
  if (!portfolioId || !roster) return null;
  const owners = users.filter((user) => user.portfolioId === portfolioId);
  if (owners.length !== 1) return null;
  const key = roster.bindings[owners[0].id];
  if (!key) return null;
  const record = roster.records.find(
    (record) => record.key === key && record.active,
  );
  if (record)
    return record.grade ? (portfolioGrades[record.grade] ?? null) : null;
  return roster.retiredRecords?.some((record) => record.key === key)
    ? "OB/OG"
    : null;
}

/** Called only when a roster is imported or a new account's first link is confirmed. */
export function queueRosterPortfolioGrades(
  data: ActivityStore,
  users: User[],
  at: string,
  initialUserIds?: Set<string>,
  changedUserIds?: Set<string>,
) {
  const roster = data.roster;
  if (!roster) return;
  const jobs = (data.rosterPortfolioUpdates ||= []);
  for (const user of users) {
    if (!user.approved || !user.portfolioId) continue;
    if (changedUserIds && !changedUserIds.has(user.id)) continue;
    if (
      initialUserIds &&
      (!initialUserIds.has(user.id) ||
        jobs.some((job) => job.portfolioId === user.portfolioId))
    )
      continue;
    const row = roster.records.find(
      (row) => row.active && row.key === roster.bindings[user.id],
    );
    if (!row?.grade) continue;
    const targetGrade = portfolioGrades[row.grade];
    // Unknown grades must never erase a member's saved selection.
    if (!targetGrade) continue;
    for (const job of jobs) {
      if (
        job.userId === user.id &&
        (job.status === "pending" || job.status === "error")
      ) {
        job.status = "cancelled";
        job.updatedAt = at;
      }
    }
    const shared =
      users.filter((owner) => owner.portfolioId === user.portfolioId).length !==
      1;
    jobs.push({
      id: crypto.randomUUID(),
      userId: user.id,
      portfolioId: user.portfolioId,
      rosterKey: row.key,
      name: row.name,
      targetGrade,
      rosterFetchedAt: roster.fetchedAt,
      ...(initialUserIds ? { initialOnly: true as const } : {}),
      status: shared ? "error" : "pending",
      attempts: 0,
      createdAt: at,
      updatedAt: at,
      message: shared
        ? "Portfolioを複数のアカウントが参照しています。連携を確認してください。"
        : undefined,
    });
  }
}

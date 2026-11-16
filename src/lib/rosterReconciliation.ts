import type {
  ActivityRoster,
  GroupRules,
  RosterRecord,
} from "./activityTypes.ts";
import type { RosterSource } from "./activityRoster.ts";

export const rosterName = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** Keep stable person IDs across semesters, but never infer a departure from a changed sheet ID. */
export function reconcileRoster(
  previous: ActivityRoster | undefined,
  incoming: RosterRecord[],
  source: RosterSource,
  at: string,
) {
  const old = [
    ...new Map(
      [...(previous?.records || []), ...(previous?.retiredRecords || [])].map(
        (row) => [row.key, row],
      ),
    ).values(),
  ];
  const names = new Set(incoming.map((r) => rosterName(r.name)));
  const used = new Set<string>();
  const changes: {
    key: string;
    name: string;
    before: RosterRecord["grade"];
    after: RosterRecord["grade"];
    returning: boolean;
  }[] = [];
  const sameSource =
    previous?.spreadsheetId === source.spreadsheetId &&
    previous.sheetId === source.sheetId;
  const records = incoming.map((row) => {
    if (row.identityUncertain || row.membershipUncertain)
      return { ...row, active: false };
    const candidates = old.filter(
      (r) =>
        rosterName(r.name) === rosterName(row.name) &&
        !used.has(r.key) &&
        (!row.identityHash ||
          !r.identityHash ||
          row.identityHash === r.identityHash),
    );
    let match = sameSource
      ? candidates.find((r) => (r.sourceKey || r.key) === row.key)
      : undefined;
    if (!match && row.identityHash) {
      const identified = candidates.filter(
        (candidate) => candidate.identityHash === row.identityHash,
      );
      if (identified.length === 1) match = identified[0];
    }
    const peers = incoming.filter(
      (r) => rosterName(r.name) === rosterName(row.name),
    );
    if (!match && candidates.length === 1 && peers.length === 1)
      match = candidates[0];
    if (!match && row.university) {
      const similar = (r: RosterRecord) =>
        rosterName(r.university) === rosterName(row.university) &&
        (!row.lineName ||
          rosterName(r.lineName || "") === rosterName(row.lineName));
      const matches = candidates.filter(similar);
      if (matches.length === 1 && peers.filter(similar).length === 1)
        match = matches[0];
    }
    if (match) {
      used.add(match.key);
      if (row.active && (!match.active || match.grade !== row.grade))
        changes.push({
          key: match.key,
          name: row.name,
          before: match.grade,
          after: row.grade,
          returning: !match.active,
        });
    }
    return { ...row, sourceKey: row.key, key: match?.key || row.key };
  });
  const uncertainNames = new Set(
    incoming
      .filter((row) => row.identityUncertain || row.membershipUncertain)
      .map((row) => rosterName(row.name)),
  );
  const departed = (previous?.records || [])
    .filter(
      (r) =>
        r.active &&
        !uncertainNames.has(rosterName(r.name)) &&
        (!names.has(rosterName(r.name)) ||
          records.some(
            (row) =>
              row.key === r.key &&
              !row.active &&
              !row.identityUncertain &&
              !row.membershipUncertain,
          )),
    )
    .map((row) => ({
      ...row,
      withdrawnAt: at,
      departureReason: (names.has(rosterName(row.name))
        ? "declined"
        : "missing") as "declined" | "missing",
    }));
  const unresolved = (previous?.records || []).filter(
    (r) =>
      names.has(rosterName(r.name)) &&
      (!used.has(r.key) || uncertainNames.has(rosterName(r.name))),
  );
  // A known person is never silently lost because a new dual-source answer is ambiguous.
  if (source.term)
    for (const row of unresolved) {
      // An uncertain answer can have the same deterministic ID as last term's person.
      // Keep that person's active record and binding, and store the answer separately for review.
      for (const next of records.filter(
        (next) =>
          next.key === row.key &&
          (next.identityUncertain || next.membershipUncertain),
      ))
        next.key = `${next.key}:review`;
      if (!records.some((next) => next.key === row.key))
        records.push({ ...row });
    }
  const activeKeys = new Set(
    records.filter((row) => row.active).map((row) => row.key),
  );
  const retiredRecords = [
    ...(previous?.retiredRecords || []).filter((r) => !activeKeys.has(r.key)),
    ...departed.map((r) => ({
      ...r,
      active: false,
      withdrawnAt: at,
      departureReason: (names.has(rosterName(r.name))
        ? "declined"
        : "missing") as "declined" | "missing",
    })),
  ];
  return {
    records,
    retiredRecords: [
      ...new Map(retiredRecords.map((r) => [r.key, r])).values(),
    ],
    departed,
    unresolved,
    gradeChanges: changes,
    added: records.filter(
      (row) => row.active && !old.some((previous) => previous.key === row.key),
    ),
    reviewRecords: incoming.filter((row) => row.needsReview?.length),
    continued: used.size,
  };
}

export function removeDepartedRules(
  rules: GroupRules,
  departed: Set<string>,
): GroupRules {
  return {
    ...rules,
    leaders: rules.leaders.filter((id) => !departed.has(id)),
    together: rules.together.filter((pair) =>
      pair.every((id) => !departed.has(id)),
    ),
    apart: rules.apart.filter((pair) => pair.every((id) => !departed.has(id))),
  };
}

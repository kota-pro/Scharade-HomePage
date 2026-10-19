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
    ...(previous?.records || []),
    ...(previous?.retiredRecords || []),
  ];
  const names = new Set(incoming.map((r) => rosterName(r.name)));
  const used = new Set<string>();
  const sameSource =
    previous?.spreadsheetId === source.spreadsheetId &&
    previous.sheetId === source.sheetId;
  const records = incoming.map((row) => {
    const candidates = old.filter(
      (r) => rosterName(r.name) === rosterName(row.name) && !used.has(r.key),
    );
    let match = sameSource
      ? candidates.find((r) => (r.sourceKey || r.key) === row.key)
      : undefined;
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
    if (match) used.add(match.key);
    return { ...row, sourceKey: row.key, key: match?.key || row.key };
  });
  const departed = (previous?.records || []).filter(
    (r) => !names.has(rosterName(r.name)),
  );
  const retiredRecords = [
    ...(previous?.retiredRecords || []).filter((r) => !used.has(r.key)),
    ...departed.map((r) => ({ ...r, active: false, withdrawnAt: at })),
  ];
  return {
    records,
    retiredRecords: [
      ...new Map(retiredRecords.map((r) => [r.key, r])).values(),
    ],
    departed,
    unresolved: (previous?.records || []).filter(
      (r) => names.has(rosterName(r.name)) && !used.has(r.key),
    ),
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

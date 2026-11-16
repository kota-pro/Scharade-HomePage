import { isMemberAccount } from "./accountVisibility.ts";
import {
  advanceIntegrationConfigured,
  postAccountingPayload,
} from "./advanceRequests.ts";
import {
  genderLabels,
  gradeLabels,
  type ActivityStore,
  type RosterRecord,
  type Gender,
  type Grade,
} from "./activityTypes.ts";
import type { User } from "./auth.ts";

// Backward-compatible default; changes are accepted only through the administrator preview flow.
export const activityRosterSource = {
  spreadsheetId: "1thOhu3AwgGLhP9sGV_wToRy1kyzD_rJbw_bjcQHV8j4",
  sheetId: 147078796,
  title: "2026年度後期シャレード継続確認フォーム（回答）",
};
export const activityRosterUrl = `https://docs.google.com/spreadsheets/d/${activityRosterSource.spreadsheetId}/edit#gid=${activityRosterSource.sheetId}`;
export type RosterSource = Pick<
  typeof activityRosterSource,
  "spreadsheetId" | "sheetId"
> & { term?: import("./clubFormsTypes.ts").TermRosterSource };
export function rosterSourceUrl(source: RosterSource = activityRosterSource) {
  return `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${source.sheetId}`;
}
export function parseRosterSource(value: unknown): RosterSource {
  try {
    if (typeof value !== "string" || value.length > 1000) throw new Error();
    const url = new URL(value.trim());
    const id = url.pathname.match(
      /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})(?:\/|$)/,
    )?.[1];
    const gid =
      new URLSearchParams(url.hash.slice(1)).get("gid") ??
      url.searchParams.get("gid");
    if (
      url.protocol !== "https:" ||
      url.hostname !== "docs.google.com" ||
      url.port ||
      url.username ||
      url.password ||
      !id ||
      !gid ||
      !/^\d+$/.test(gid) ||
      !Number.isSafeInteger(Number(gid))
    )
      throw new Error();
    return { spreadsheetId: id, sheetId: Number(gid) };
  } catch {
    throw new Error(
      "Googleスプレッドシートで対象のシートを開き、gidを含むURLを入力してください。",
    );
  }
}
const normalize = (v: string) =>
  v.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
export function rosterGender(value: string): Gender | null {
  const v = normalize(value);
  const aliases: Record<string, Gender> = {
    男: "male",
    男性: "male",
    女: "female",
    女性: "female",
    その他: "other",
    回答しない: "undisclosed",
    回答を控える: "undisclosed",
    無回答: "undisclosed",
  };
  return Object.hasOwn(genderLabels, v) ? (v as Gender) : (aliases[v] ?? null);
}
export function rosterGrade(value: string): Grade | null {
  const v = normalize(value).replace(/[一二三四五六](?=年(?:生)?$)/, (year) =>
    String("一二三四五六".indexOf(year) + 1),
  );
  if (Object.hasOwn(gradeLabels, v)) return v as Grade;
  const grade = v.match(/^(?:学部|大学)?([1-6])(?:年|年生)$/);
  if (grade) return grade[1] as Grade;
  if (
    /^(?:大学院)?(?:修士(?:課程)?|博士(?:課程)?前期(?:課程)?|m)[12]?(?:年|年生)?$/.test(
      v,
    ) ||
    /^(?:大学院|院)(?:生)?[12]?(?:年|年生)?$/.test(v)
  )
    return "master";
  if (
    /^(?:大学院)?(?:博士(?:後期)?(?:課程)?|博士課程後期|d)[1-6]?(?:年|年生)?$/.test(
      v,
    )
  )
    return "doctorate";
  if (["ob", "og", "ob/og", "ob・og", "卒業生"].includes(v)) return "alumni";
  return v === "その他" ? "other" : null;
}
export async function fetchActivityRoster(
  source: RosterSource = activityRosterSource,
): Promise<{
  title: string;
  sheetTitle: string;
  records: RosterRecord[];
}> {
  if (source.term) {
    const { fetchTermRoster } = await import("./termRoster.ts");
    return fetchTermRoster(source.term);
  }
  if (!advanceIntegrationConfigured())
    throw new Error(
      "Google名簿との連携が未設定です。管理者に連絡してください。",
    );
  let value: any;
  try {
    const response = await postAccountingPayload(
      {
        action: "roster.read",
        spreadsheetId: source.spreadsheetId,
        sheetId: source.sheetId,
      },
      25000,
    );
    if (!response.ok) throw new Error();
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error();
    value = JSON.parse(body);
  } catch {
    throw new Error(
      "Google名簿を取得できませんでした。時間をおいて再度お試しください。保存済みの名簿は保持しています。",
    );
  }
  if (
    !value?.ok ||
    value.spreadsheetId !== source.spreadsheetId ||
    value.sheetId !== source.sheetId ||
    !Array.isArray(value.records) ||
    value.records.length > 2000 ||
    typeof value.title !== "string" ||
    value.title.length > 300 ||
    typeof value.sheetTitle !== "string" ||
    value.sheetTitle.length > 100
  ) {
    throw new Error(
      "Google名簿の連携設定・見出し・閲覧権限を確認してください。保存済みの名簿は保持しています。",
    );
  }
  const keys = new Set<string>();
  const records: RosterRecord[] = value.records.map((r: any) => {
    if (
      !r ||
      !/^[a-f0-9]{64}$/.test(r.key) ||
      keys.has(r.key) ||
      typeof r.active !== "boolean" ||
      ["name", "university", "gender", "grade"].some(
        (k) => typeof r[k] !== "string" || r[k].length > 200,
      ) ||
      (r.lineName !== undefined &&
        (typeof r.lineName !== "string" || r.lineName.length > 200)) ||
      !r.name.trim()
    )
      throw new Error(
        "名簿の回答に重複または形式の不備があります。元のスプレッドシートを確認してください。",
      );
    keys.add(r.key);
    return {
      key: r.key,
      name: r.name.trim(),
      lineName: (r.lineName || "").trim(),
      university: r.university.trim(),
      gender: rosterGender(r.gender),
      grade: rosterGrade(r.grade),
      active: r.active,
    };
  });
  return { title: value.title, sheetTitle: value.sheetTitle, records };
}
/** Only confirmed account-to-roster links populate grouping attributes. */
export function applyRosterProfiles(data: ActivityStore, users: User[]) {
  const roster = data.roster;
  if (!roster) return;
  const approved = new Set(users.filter(isMemberAccount).map((u) => u.id));
  for (const id of Object.keys(roster.bindings))
    if (!approved.has(id)) delete roster.bindings[id];
  for (const id of Object.keys(data.profiles)) {
    if (!roster.bindings[id]) delete data.profiles[id];
  }
  for (const [id, key] of Object.entries(roster.bindings)) {
    const row = roster.records.find((r) => r.key === key && r.active);
    const old = data.profiles[id];
    if (!row?.gender || !row.grade) {
      delete data.profiles[id];
      continue;
    }
    if (
      old?.gender === row.gender &&
      old.grade === row.grade &&
      old.rosterKey === key
    )
      continue;
    data.profiles[id] = {
      gender: row.gender,
      grade: row.grade,
      rosterKey: key,
      revision: (old?.revision ?? 0) + 1,
    };
  }
}
/** Unique, unclaimed name matches; approval may confirm the new account's suggestion. */
export function rosterSuggestions(
  data: ActivityStore,
  users: User[],
): Record<string, string> {
  const roster = data.roster;
  if (!roster) return {};
  const used = new Set(Object.values(roster.bindings));
  const candidates = users
    .filter((u) => isMemberAccount(u) && !roster.bindings[u.id])
    .map((u) => {
      const names = new Set(
        [u.name, u.portfolioName || ""].filter(Boolean).map(normalize),
      );
      const matches = roster.records.filter(
        (r) => r.active && !r.identityUncertain && !r.membershipUncertain && !used.has(r.key) && names.has(normalize(r.name)),
      );
      return { id: u.id, key: matches.length === 1 ? matches[0].key : "" };
    });
  return Object.fromEntries(
    candidates
      .filter(
        (c) =>
          c.key &&
          candidates.filter((other) => other.key === c.key).length === 1,
      )
      .map((c) => [c.id, c.key]),
  );
}

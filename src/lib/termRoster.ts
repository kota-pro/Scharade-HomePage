import crypto from "node:crypto";
import { readActivities } from "./activities.ts";
import {
  parseRosterSource,
  rosterGender,
  rosterGrade,
  type RosterSource,
} from "./activityRoster.ts";
import type { ActivityRoster, RosterRecord } from "./activityTypes.ts";
import { postClubForms, googleFileId } from "./clubFormsGoogle.ts";
import { readClubForms } from "./clubForms.ts";
import {
  clubSeasonLabels,
  type ClubSeason,
  type RosterSheetSource,
  type TermRosterSource,
} from "./clubFormsTypes.ts";

const normalize = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const digest = (value: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const kinds = ["admission", "continuation"] as const;
export function validTerm(value: unknown): value is TermRosterSource {
  if (!value || typeof value !== "object") return false;
  const term = value as TermRosterSource;
  return (
    Number.isSafeInteger(term.year) &&
    term.year >= 2000 &&
    term.year <= 9999 &&
    ["spring", "autumn"].includes(term.season) &&
    kinds.every((kind) => validSheetSource(term[kind])) &&
    !(
      term.admission.spreadsheetId === term.continuation.spreadsheetId &&
      term.admission.sheetId === term.continuation.sheetId
    )
  );
}
export function validSheetSource(value: unknown): value is RosterSheetSource {
  if (!value || typeof value !== "object") return false;
  const source = value as RosterSheetSource;
  return (
    googleFileId(source.spreadsheetId) &&
    Number.isSafeInteger(source.sheetId) &&
    source.sheetId >= 0
  );
}
function sourceInput(value: unknown) {
  if (typeof value !== "string" || value.length > 1000)
    throw new Error("入会・継続それぞれのURLを入力してください。");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("入会・継続それぞれのGoogleのURLを入力してください。");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "docs.google.com" ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error(
      "Googleフォームの編集用URLまたはgid付きの回答シートURLを入力してください。",
    );
  const formId = url.pathname.match(
    /^\/forms\/d\/([A-Za-z0-9_-]{20,200})\/edit\/?$/,
  )?.[1];
  return formId ? { formId } : parseRosterSource(value);
}
export async function resolveTermSource(
  year: unknown,
  season: unknown,
  admissionUrl: unknown,
  continuationUrl: unknown,
): Promise<RosterSource> {
  if (
    !Number.isSafeInteger(year) ||
    Number(year) < 2000 ||
    Number(year) > 9999 ||
    !["spring", "autumn"].includes(String(season))
  )
    throw new Error("対象の西暦と春・秋を選択してください。");
  const data = await postClubForms({
    action: "roster.resolve",
    sources: {
      admission: sourceInput(admissionUrl),
      continuation: sourceInput(continuationUrl),
    },
  });
  const term = {
    year: Number(year),
    season: season as ClubSeason,
    admission: data.sources?.admission,
    continuation: data.sources?.continuation,
  };
  if (!validTerm(term))
    throw new Error("入会と継続に異なる回答シートを指定してください。");
  for (const kind of kinds) {
    const managed = readClubForms().forms.filter(
      (form) => form.remote?.spreadsheetId === term[kind].spreadsheetId,
    );
    if (managed.some((form) => form.deleteRequestedAt || form.deletedAt))
      throw new Error("削除中または削除済みのフォームを名簿に使用できません。");
    if (
      managed.some(
        (form) =>
          form.year !== term.year ||
          form.season !== term.season ||
          form.kind !== kind ||
          form.remote?.sheetId !== term[kind].sheetId,
      )
    )
      throw new Error(
        "作成済みフォームの西暦・春秋・種類が選択内容と一致しません。回答元を確認してください。",
      );
  }
  return { ...term.admission, term };
}
export function rosterSourceIdentity(source: RosterSource) {
  const sheet = (source: RosterSheetSource) => [
    source.spreadsheetId,
    source.sheetId,
  ];
  return JSON.stringify(
    source.term
      ? [
          source.term.year,
          source.term.season,
          sheet(source.term.admission),
          sheet(source.term.continuation),
        ]
      : sheet(source),
  );
}
export function rosterSourceLinks(source: RosterSource) {
  const url = (s: RosterSheetSource) =>
    `https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit#gid=${s.sheetId}`;
  return source.term
    ? kinds.map((kind) => ({
        label:
          kind === "admission" ? "入会フォームの回答" : "継続フォームの回答",
        url: url(source.term![kind]),
      }))
    : [{ label: "Google名簿", url: url(source) }];
}
export type TermResponse = {
  key: string;
  name: string;
  university: string;
  lineName: string;
  gender: string;
  grade: string;
  identityHash?: string;
  kanaHash?: string;
  submittedAt: string;
  active: boolean | null;
  kind: "admission" | "continuation";
};
function checkedResponses(
  data: Record<string, any>,
  term: TermRosterSource,
): TermResponse[] {
  if (!Array.isArray(data.bundles) || data.bundles.length !== 2)
    throw new Error("入会・継続の両回答を取得できませんでした。");
  return kinds.flatMap((kind) => {
    const bundle = data.bundles.find((entry: any) => entry.kind === kind);
    if (
      !bundle ||
      bundle.spreadsheetId !== term[kind].spreadsheetId ||
      bundle.sheetId !== term[kind].sheetId ||
      !Array.isArray(bundle.rows) ||
      bundle.rows.length > 4000
    )
      throw new Error("回答シートの連携を確認してください。");
    return bundle.rows.map((row: any) => {
      if (
        !row ||
        !/^[a-f0-9]{64}$/.test(row.key) ||
        ["name", "university", "lineName", "gender", "grade"].some(
          (key) => typeof row[key] !== "string" || row[key].length > 200,
        ) ||
        !row.name.trim() ||
        typeof row.submittedAt !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(
          row.submittedAt,
        ) ||
        !Number.isFinite(Date.parse(row.submittedAt)) ||
        [row.identityHash, row.kanaHash].some(
          (value) =>
            value !== undefined &&
            value !== "" &&
            (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)),
        ) ||
        (kind === "continuation" &&
          row.active !== null &&
          typeof row.active !== "boolean")
      )
        throw new Error(
          "名簿の回答日時・値・形式を確認してください。保存済みの名簿は保持しています。",
        );
      return {
        key: row.key,
        name: row.name.trim(),
        university: row.university.trim(),
        lineName: row.lineName.trim(),
        gender: row.gender.trim(),
        grade: row.grade.trim(),
        submittedAt: row.submittedAt,
        identityHash: row.identityHash || undefined,
        kanaHash: row.kanaHash || undefined,
        active: kind === "admission" ? true : row.active,
        kind,
      };
    });
  });
}

/** Only explicit identity evidence merges namesakes. Submission dates resolve answers, never identities. */
export function mergeTermResponses(
  rows: TermResponse[],
  term: TermRosterSource,
  previous?: ActivityRoster,
): RosterRecord[] {
  const names = new Map<string, TermResponse[]>();
  for (const row of rows) {
    const name = normalize(row.name);
    names.set(name, [...(names.get(name) ?? []), row]);
  }
  const result: RosterRecord[] = [];
  for (const [name, sameName] of names) {
    const universities = [
      ...new Set(
        sameName.map((row) => normalize(row.university)).filter(Boolean),
      ),
    ];
    const universitiesWithBlank = universities.length ? universities : [""];
    const ambiguousBlanks =
      universities.length > 1 ? sameName.filter((row) => !row.university) : [];
    const batches = universitiesWithBlank.map((university) =>
      sameName.filter(
        (row) =>
          normalize(row.university) === university ||
          (!row.university && universities.length <= 1),
      ),
    );
    if (ambiguousBlanks.length) batches.push(ambiguousBlanks);
    for (const batch of batches) {
      if (!batch.length) continue;
      const identities = [
        ...new Set(
          batch
            .map((row) => row.identityHash)
            .filter((id): id is string => !!id),
        ),
      ];
      const kanas = [
        ...new Set(
          batch.map((row) => row.kanaHash).filter((id): id is string => !!id),
        ),
      ];
      const strong =
        identities.length > 1
          ? "identityHash"
          : !identities.length && kanas.length > 1
            ? "kanaHash"
            : null;
      const groups = strong
        ? [...new Set(batch.map((row) => row[strong] ?? ""))].map((hint) =>
            batch.filter((row) => (row[strong] ?? "") === hint),
          )
        : [batch];
      for (const group of groups) {
        const review: string[] = [];
        const identityUncertain =
          group === ambiguousBlanks ||
          ambiguousBlanks.some((row) => group.includes(row)) ||
          (!!strong && group.some((row) => !row[strong]));
        if (identityUncertain)
          review.push("同姓同名の人物との対応を確認してください。");
        const latest = (kind: TermResponse["kind"]) => {
          const candidates = group
            .filter((row) => row.kind === kind)
            .sort(
              (a, b) =>
                Date.parse(b.submittedAt) - Date.parse(a.submittedAt) ||
                a.key.localeCompare(b.key),
            );
          if (
            candidates[0] &&
            candidates.some(
              (row) =>
                row.submittedAt === candidates[0].submittedAt &&
                JSON.stringify([row.active, row.grade, row.gender]) !==
                  JSON.stringify([
                    candidates[0].active,
                    candidates[0].grade,
                    candidates[0].gender,
                  ]),
            )
          )
            review.push("同時刻の回答が競合しています。");
          return candidates[0];
        };
        const admission = latest("admission"),
          continuation = latest("continuation"),
          selected = continuation ?? admission!;
        let university =
          selected.university ||
          admission?.university ||
          group.find((row) => row.university)?.university ||
          "";
        const oldCandidates = [
          ...new Map(
            [
              ...(previous?.records ?? []),
              ...(previous?.retiredRecords ?? []),
            ].map((row) => [row.key, row]),
          ).values(),
        ].filter(
          (row) =>
            normalize(row.name) === name &&
            (!university ||
              !row.university ||
              normalize(row.university) === normalize(university)) &&
            (!selected.identityHash ||
              !row.identityHash ||
              selected.identityHash === row.identityHash),
        );
        const old =
          oldCandidates.length === 1 &&
          (!strong ||
            (oldCandidates[0].identityHash === selected.identityHash &&
              !!selected.identityHash))
            ? oldCandidates[0]
            : undefined;
        if (!university && old) university = old.university;
        const genderText = selected.gender || admission?.gender || "";
        const answerGender = genderText ? rosterGender(genderText) : null;
        const gender = answerGender ?? old?.gender ?? null;
        const answerGrade = rosterGrade(selected.grade);
        const grade = answerGrade ?? old?.grade ?? null;
        if (!gender || (genderText && !answerGender))
          review.push("性別が未取得・未対応です。");
        if (!answerGrade) review.push("学年が未取得・未対応です。");
        const membershipUncertain =
          continuation?.active === null ||
          review.includes("同時刻の回答が競合しています。");
        if (membershipUncertain) review.push("継続の回答を確認してください。");
        const identityHash = selected.identityHash ?? admission?.identityHash;
        result.push({
          key: digest([
            name,
            normalize(university),
            identityHash || selected.kanaHash || "",
            identityUncertain ? selected.key : "",
          ]),
          name: selected.name,
          university,
          lineName:
            selected.lineName || admission?.lineName || old?.lineName || "",
          gender,
          grade,
          active: membershipUncertain
            ? (old?.active ?? false)
            : selected.active === true,
          ...(identityHash ? { identityHash } : {}),
          ...(review.length ? { needsReview: [...new Set(review)] } : {}),
          ...(identityUncertain ? { identityUncertain: true } : {}),
          ...(membershipUncertain ? { membershipUncertain: true } : {}),
          ...(!membershipUncertain && selected.active === false
            ? { departureReason: "declined" as const }
            : {}),
          provenance: [admission, continuation]
            .filter((row): row is TermResponse => !!row)
            .map((row) => ({
              kind: row.kind,
              ...term[row.kind],
              submittedAt: row.submittedAt,
            })),
        });
      }
    }
  }
  return result.sort((a, b) => a.key.localeCompare(b.key));
}
export async function fetchTermRoster(term: TermRosterSource) {
  if (!validTerm(term))
    throw new Error("春秋の名簿の参照先を確認してください。");
  const data = await postClubForms({ action: "roster.read", term });
  const responses = checkedResponses(data, term);
  return {
    title: `${term.year}年 ${clubSeasonLabels[term.season]} サークル員名簿`,
    sheetTitle: "入会・継続の統合名簿",
    records: mergeTermResponses(responses, term, readActivities().roster),
  };
}

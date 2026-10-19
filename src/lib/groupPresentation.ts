import {
  genderLabels,
  type Grade,
  type Participant,
  type PublishedGroups,
} from "./activityTypes.ts";
import type { GroupPreferenceWarning } from "./grouping.ts";
import { groupGradeLabel } from "./groupingGrade.ts";
export function displayName(person: { name: string; lineName?: string }) {
  return person.lineName?.trim()
    ? `${person.name}（${person.lineName.trim()}）`
    : person.name;
}
export const genderColors = { male: "#99ccff", female: "#ff99ff" };
export const gradeColors: Partial<Record<Grade, string>> = {
  "4": "#4d4398",
  "5": "#4d4398",
  "6": "#4d4398",
  master: "#4d4398",
  doctorate: "#4d4398",
  alumni: "#4d4398",
  "3": "#38b48b",
  "2": "#a0d8ef",
  "1": "#f2f2b0",
};
const order = [
  "alumni",
  "doctorate",
  "master",
  "6",
  "5",
  "4",
  "3",
  "2",
  "1",
  "other",
];
export function sortGroupPeople(people: Participant[], leaderId: string) {
  const rank = (p: Participant) =>
    order.includes(p.grade) ? order.indexOf(p.grade) : 99;
  return [...people].sort(
    (a, b) =>
      Number(b.id === leaderId) - Number(a.id === leaderId) ||
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name, "ja") ||
      a.id.localeCompare(b.id),
  );
}
export function nameParts(name: string) {
  const first =
    [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(name)][0]
      ?.segment || "";
  return [first, name.slice(first.length)];
}
export function personStyle(person: Participant) {
  return `--gender-color:${genderColors[person.gender as keyof typeof genderColors] || "inherit"};--grade-color:${gradeColors[person.grade] || "transparent"}`;
}
export function personLabel(person: Participant, leader: boolean) {
  return [
    displayName(person),
    genderLabels[person.gender],
    groupGradeLabel(person.grade),
    leader ? "リーダー" : "",
  ]
    .filter(Boolean)
    .join("、");
}
export function warningText(
  warning: GroupPreferenceWarning,
  people: Participant[],
) {
  const names = warning.ids
    .map((id) => {
      const person = people.find((p) => p.id === id);
      return person ? displayName(person) : "未登録メンバー";
    })
    .join("・");
  return `${names}：${{ apart: "別班指定を満たしていません", together: "同班指定を満たしていません", repeat: "前回も同じ班でした" }[warning.kind]}`;
}
export function publishedGroupPeople(
  plan: PublishedGroups | undefined,
  fallback: Participant[],
): Participant[] {
  if (!plan) return [];
  return [...new Set(plan.groups.flatMap((g) => g.memberIds))].map((id) => {
    const current = fallback.find((p) => p.id === id);
    const person = plan.people?.find((p) => p.id === id) ||
      current || {
        id,
        name: plan.names[id] || "退会済みメンバー",
        gender: undefined!,
        grade: undefined!,
      };
    return person.lineName === undefined && current?.lineName !== undefined
      ? { ...person, lineName: current.lineName }
      : person;
  });
}

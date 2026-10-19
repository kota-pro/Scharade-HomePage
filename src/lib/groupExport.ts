import type { Group, Participant } from "./activityTypes.ts";
import { sortGroupPeople } from "./groupPresentation.ts";

export type GroupExportSection = { number: number; leaderId: string; members: Participant[] };
export type GroupExportData = { title: string; sections: GroupExportSection[]; flaggedIds: string[] };

export function groupExportData(people: Participant[], groups: Group[], flaggedIds: string[], title: string): GroupExportData {
  return { title, flaggedIds, sections: groups.map((group, index) => ({
    number: index + 1, leaderId: group.leaderId,
    members: sortGroupPeople(people.filter(person => group.memberIds.includes(person.id)), group.leaderId),
  })) };
}
export const groupExportHeading = (number: number) => `${String(number).replace(/[0-9]/g, digit => String.fromCharCode(digit.charCodeAt(0) + 0xfee0))}班`;
export function groupExportText(sections: GroupExportSection[]): string {
  return sections.map(section => `${groupExportHeading(section.number)}：\n${section.members.map(person =>
    (person.id === section.leaderId ? "◎" : "") + (person.lineName?.trim() || person.name).replace(/[\r\n\t]+/g, " ").trim(),
  ).join("、")}`).join("\n\n") + "\n\n◎：班長";
}

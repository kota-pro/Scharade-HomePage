import type { Exhibition } from "./exhibitionTypes.ts";
export type ExhibitionCalendarEntry = { id: string; title: string; startsAt: string; endsAt: string; href: string; kind: "exhibition-vote" | "exhibition-form"; status: "published" };
export function exhibitionCalendarEntries(exhibitions: Exhibition[], userId: string): ExhibitionCalendarEntry[] {
  return exhibitions.filter(e => e.participation?.state === "published" && e.participation.recipientIds.includes(userId)).flatMap(e => [
    { id: `${e.id}:vote`, title: `写真展・参加投票：${e.title}`, startsAt: e.participation!.opensAt, endsAt: e.participation!.closesAt, href: `/Member/exhibitions/${e.id}`, kind: "exhibition-vote" as const, status: "published" as const },
    { id: `${e.id}:form`, title: `写真展・フォーム入力：${e.title}`, startsAt: e.opensAt, endsAt: e.closesAt, href: `/Member/exhibitions/${e.id}`, kind: "exhibition-form" as const, status: "published" as const },
  ]).filter(entry => Number.isFinite(Date.parse(entry.startsAt)) && Date.parse(entry.startsAt) < Date.parse(entry.endsAt));
}

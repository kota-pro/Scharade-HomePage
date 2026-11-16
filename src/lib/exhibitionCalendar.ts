import { readShiftStore } from "./exhibitionShiftStore.ts";
import type { Exhibition } from "./exhibitionTypes.ts";
export type ExhibitionCalendarEntry = { id: string; title: string; startsAt: string; endsAt: string; href: string; kind: "exhibition-vote" | "exhibition-form" | "exhibition-shift"; status: "published" };
export function exhibitionCalendarEntries(exhibitions: Exhibition[], userId: string): ExhibitionCalendarEntry[] {
  const shifts = readShiftStore();
  const regular: ExhibitionCalendarEntry[] = exhibitions.filter(e => e.participation?.state === "published" && e.participation.recipientIds.includes(userId)).flatMap(e => [
    { id: `${e.id}:vote`, title: `写真展・参加投票：${e.title}`, startsAt: e.participation!.opensAt, endsAt: e.participation!.closesAt, href: `/Member/exhibitions/${e.id}`, kind: "exhibition-vote" as const, status: "published" as const },
    { id: `${e.id}:form`, title: `写真展・フォーム入力：${e.title}`, startsAt: e.opensAt, endsAt: e.closesAt, href: `/Member/exhibitions/${e.id}`, kind: "exhibition-form" as const, status: "published" as const },
  ]).filter(entry => Number.isFinite(Date.parse(entry.startsAt)) && Date.parse(entry.startsAt) < Date.parse(entry.endsAt));
  return regular.concat(exhibitions.filter(e => e.participation?.state === "published").flatMap(e => {const r=shifts.records.find(r=>r.exhibitionId===e.id);return r && r.config.state!=="draft" && r.config.opensAt && r.config.closesAt ? [{id:`${e.id}:shift`,title:`写真展・シフト受付：${e.title}`,startsAt:r.config.opensAt,endsAt:r.config.closesAt,href:`/Member/exhibitions/${e.id}/shifts`,kind:"exhibition-shift" as const,status:"published" as const}] : [];}));
}

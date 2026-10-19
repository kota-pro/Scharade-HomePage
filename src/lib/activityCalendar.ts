import { eventCategoryLabels, type EventCategory } from "./activityTypes.ts";

const DAY = 86400000;
export type CalendarEntry = { id: string; startsAt: string; endsAt: string; kind: string; category?: EventCategory };
export function calendarCategory(entry: Pick<CalendarEntry, "kind" | "category">) {
  return entry.kind === "event" ? entry.category ?? "other" : "exhibition";
}
export function calendarCategoryLabel(entry: Pick<CalendarEntry, "kind" | "category">) {
  const category = calendarCategory(entry);
  return category === "exhibition" ? "展示" : eventCategoryLabels[category];
}
/** Intervals are half open; midnight at the end does not occupy another date. */
export function calendarWeeks<T extends CalendarEntry>(month: string, entries: T[]) {
  const [year, m] = month.split("-").map(Number);
  const first = Date.parse(`${month}-01T00:00:00+09:00`);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const previousLanes = new Map<string, number>();
  return Array.from({ length: Math.ceil((offset + days) / 7) }, (_, week) => {
    const weekStart = week * 7 - offset;
    const segments = entries.flatMap(entry => {
      const start = Date.parse(entry.startsAt), end = Date.parse(entry.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
      const a = Math.floor((start - first) / DAY), b = Math.ceil((end - first) / DAY) - 1;
      const left = Math.max(0, weekStart, a), right = Math.min(days - 1, weekStart + 6, b);
      if (left > right) return [];
      return [{ entry, column: left - weekStart, span: right - left + 1, firstDay: left + 1, lastDay: right + 1, continuesBefore: a < left, continuesAfter: b > right, lane: 0 }];
    }).sort((a, b) => a.column - b.column || b.span - a.span || a.entry.id.localeCompare(b.entry.id));
    const occupied: number[] = [];
    for (const segment of segments) {
      const key = `${segment.entry.kind}:${segment.entry.id}`;
      const available = (lane: number) => !((occupied[lane] ?? 0) & ((2 ** segment.span - 1) << segment.column));
      let lane = previousLanes.get(key) ?? 0;
      if (!available(lane)) { lane = 0; while (!available(lane)) lane++; }
      segment.lane = lane;
      occupied[lane] = (occupied[lane] ?? 0) | ((2 ** segment.span - 1) << segment.column);
      previousLanes.set(key, lane);
    }
    return { days: Array.from({ length: 7 }, (_, i) => { const day = weekStart + i + 1; return day >= 1 && day <= days ? day : null; }), segments, lanes: Math.max(1, occupied.length) };
  });
}

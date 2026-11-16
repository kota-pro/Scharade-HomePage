import crypto from 'node:crypto';
import { ExhibitionError, object, text } from './exhibitionValidation.ts';
import type { ExhibitionOpeningSchedule, OpeningHours, ShiftSlot } from './exhibitionShiftTypes.ts';
export const scheduleKey = (schedule?: ExhibitionOpeningSchedule) => crypto.createHash('sha256').update(JSON.stringify(schedule ?? null)).digest('hex');
function day(value: unknown): string {
  const s = text(value, '開催日', 10, true);
  if (!/^\d{4}-\d\d-\d\d$/.test(s) || !Number.isFinite(Date.parse(s + 'T00:00:00+09:00')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) throw new ExhibitionError('開催日を確認してください。');
  return s;
}
export function minutesOf(time: string) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3)); }
function hours(value: unknown): OpeningHours {
  const raw = object(value), open = text(raw.open, '開場時刻', 5, true), close = text(raw.close, '閉場時刻', 5, true);
  if (![open, close].every(s => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)) || minutesOf(open) >= minutesOf(close)) throw new ExhibitionError('展示時間は同じ日の開場より後に閉場するよう設定してください。');
  return { open, close };
}
export function parseOpeningSchedule(value: unknown): ExhibitionOpeningSchedule {
  const raw = object(value), startDate = day(raw.startDate), endDate = day(raw.endDate);
  if (endDate < startDate || Date.parse(endDate) - Date.parse(startDate) > 365 * 86400000) throw new ExhibitionError('開催期間は開始日から366日以内で設定してください。');
  return { startDate, endDate, regular: hours(raw.regular), ...(raw.first ? { first: hours(raw.first) } : {}), ...(raw.last && startDate !== endDate ? { last: hours(raw.last) } : {}) };
}
const time = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function shiftSlots(schedule?: ExhibitionOpeningSchedule): ShiftSlot[] {
  if (!schedule) return [];
  const result: ShiftSlot[] = [];
  for (let at = Date.parse(schedule.startDate + 'T00:00:00Z'); at <= Date.parse(schedule.endDate + 'T00:00:00Z'); at += 86400000) {
    const date = new Date(at).toISOString().slice(0, 10);
    const h = date === schedule.startDate && schedule.first ? schedule.first : date === schedule.endDate && schedule.last ? schedule.last : schedule.regular;
    for (let start = minutesOf(h.open); start < minutesOf(h.close); start += 60) {
      const end = Math.min(start + 60, minutesOf(h.close));
      result.push({ id: `${date}/${time(start)}-${time(end)}`, date, start: time(start), end: time(end), minutes: end - start, index: result.length });
    }
  }
  return result;
}
export function consecutiveWindows(slots: ShiftSlot[], maximum: number): string[][] {
  const windows: string[][] = [], run: ShiftSlot[] = [];
  for (const slot of slots) {
    const previous = run.at(-1);
    if (!previous || previous.date !== slot.date || previous.end !== slot.start) run.length = 0;
    run.push(slot);
    if (run.length > maximum) windows.push(run.slice(-maximum - 1).map(s => s.id));
  }
  return windows;
}

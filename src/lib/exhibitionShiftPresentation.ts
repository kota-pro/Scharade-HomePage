import type { ShiftPerson, ShiftSlot } from './exhibitionShiftTypes.ts';

export function normalizeShiftSearch(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, '');
}
export function matchesShiftPerson(person: Pick<ShiftPerson, 'name' | 'lineName' | 'searchNames'> | undefined, query: string) {
  if (!person) return false;
  const fields = [person.name, person.lineName, ...(person.searchNames ?? [])].filter((s): s is string => !!s).map(normalizeShiftSearch);
  return query.trim().split(/\s+/u).filter(Boolean).every(word => fields.some(field => field.includes(normalizeShiftSearch(word))));
}
const minute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export function shiftDateLabel(date: string) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(date + 'T00:00:00+09:00'));
}
/** Shared absolute time axis; rowspans preserve offset opening times and partial final slots. */
export function shiftMatrixModel(slots: ShiftSlot[]) {
  const dates = [...new Set(slots.map(s => s.date))].sort();
  const boundaries = [...new Set(slots.flatMap(s => [s.start, s.end]))].sort((a, b) => minute(a) - minute(b));
  const byDay = new Map(dates.map(date => [date, slots.filter(s => s.date === date).sort((a, b) => minute(a.start) - minute(b.start))]));
  const rows = boundaries.slice(0, -1).map((start, index) => ({
    start, end: boundaries[index + 1], cells: dates.map(date => {
      const slot = byDay.get(date)!.find(s => minute(s.start) <= minute(start) && minute(start) < minute(s.end));
      return { date, slot, continued: !!slot && slot.start !== start, span: slot ? boundaries.indexOf(slot.end) - index : 1 };
    }),
  }));
  return { dates, rows };
}

/** Older answers retain slot IDs even after staff change the physical schedule. */
export function shiftAnswerSlots(ids: string[], current: ShiftSlot[], previousSchedule = false) {
  const known = new Map(current.map(s => [s.id, s]));
  const recordedOnly = previousSchedule || ids.some(id => !known.has(id));
  if (!recordedOnly) return { slots: current, recordedOnly };
  const slots = ids.flatMap(id => {
    const existing = known.get(id); if (existing) return [existing];
    const m = /^(\d{4}-\d\d-\d\d)\/((?:[01]\d|2[0-3]):[0-5]\d)-((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(id);
    if (!m || minute(m[2]) >= minute(m[3]) || !Number.isFinite(Date.parse(m[1]+'T00:00:00Z'))) return [];
    return [{ id, date:m[1], start:m[2], end:m[3], minutes:minute(m[3])-minute(m[2]), index:0 }];
  }).sort((a,b)=>a.date.localeCompare(b.date)||minute(a.start)-minute(b.start));
  return { slots, recordedOnly };
}

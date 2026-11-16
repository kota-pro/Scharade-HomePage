import { ExhibitionError, object, text } from './exhibitionValidation.ts';
import { consecutiveWindows } from './exhibitionShiftSchedule.ts';
import type { ShiftAnswer, ShiftAssignment, ShiftConfig, ShiftGenerationInput, ShiftPerson, ShiftSlot } from './exhibitionShiftTypes.ts';
export const pairKey = (a: string, b: string) => [a, b].sort().join('\n');
export function parseShiftAnswer(value: unknown, slots: ShiftSlot[], final: boolean): ShiftAnswer {
  const r = object(value), valid = new Set(slots.map(s => s.id));
  if (typeof r.none !== 'boolean' || !Array.isArray(r.slotIds) || r.slotIds.length > slots.length || r.slotIds.some(id => typeof id !== 'string' || !valid.has(id)) || new Set(r.slotIds).size !== r.slotIds.length) throw new ExhibitionError('回答する時間枠を確認してください。日程が変わった場合は再読み込みしてください。', 409);
  if (r.none && r.slotIds.length) throw new ExhibitionError('「入れる時間はない」と時間枠は同時に選択できません。');
  if (final && !r.none && !r.slotIds.length) throw new ExhibitionError('入れる時間を1枠以上選ぶか、「入れる時間はない」を選択してください。');
  return { none: r.none, slotIds: slots.filter(s => (r.slotIds as string[]).includes(s.id)).map(s => s.id) };
}
export function parseShiftConfig(value: unknown, people: ShiftPerson[]): ShiftConfig {
  const r = object(value), rules = object(r.rules), valid = new Set(people.map(p => p.id));
  if (!['draft', 'open', 'closed'].includes(String(r.state))) throw new ExhibitionError('シフトの受付状態を選択してください。');
  const date = (v: unknown) => { const s = text(v ?? '', 'シフト受付日時', 100); if (!s) return ''; if (!Number.isFinite(Date.parse(s)) || !/(?:Z|[+-]\d\d:\d\d)$/.test(s)) throw new ExhibitionError('日本時間で受付日時を設定してください。'); return new Date(s).toISOString(); };
  const opensAt = date(r.opensAt), closesAt = date(r.closesAt);
  if (r.state !== 'draft' && (!opensAt || !closesAt || opensAt >= closesAt)) throw new ExhibitionError('シフト受付の開始・締切を正しく設定してください。');
  if (opensAt && closesAt && opensAt >= closesAt) throw new ExhibitionError('シフト受付締切は開始より後にしてください。');
  const limit = (v: unknown) => { if (v === '' || v === undefined || v === null) return undefined; const n = Number(v); if (!Number.isSafeInteger(n) || n < 1 || n > 10000) throw new ExhibitionError('担当枠数の上限は1以上で入力してください。空欄は上限なしです。'); return n; };
  const pairs = (v: unknown): [string, string][] => {
    if (!Array.isArray(v) || v.length > 1000 || v.some(p => !Array.isArray(p) || p.length !== 2 || p[0] === p[1] || p.some(id => !valid.has(id)))) throw new ExhibitionError('ペア指定の担当者を選び直してください。');
    const keys = new Set<string>(); return v.filter(p => { const k = pairKey(p[0], p[1]); if (keys.has(k)) return false; keys.add(k); return true; }).map(p => [p[0], p[1]]);
  };
  const together = pairs(rules.together ?? []), apart = pairs(rules.apart ?? []), forbidden = new Set(apart.map(p => pairKey(...p)));
  if (together.some(p => forbidden.has(pairKey(...p)))) throw new ExhibitionError('同じ2人を「同枠希望」と「禁止ペア」の両方に指定できません。');
  return { state: r.state as ShiftConfig['state'], opensAt, closesAt, rules: { together, apart, ...(limit(rules.maxTotal) !== undefined ? { maxTotal: limit(rules.maxTotal) } : {}), ...(limit(rules.maxConsecutive) !== undefined ? { maxConsecutive: limit(rules.maxConsecutive) } : {}) } };
}
export function assignmentIssues(assignments: ShiftAssignment[], input: ShiftGenerationInput) {
  const people = new Map(input.people.map(p => [p.id, p])), slots = new Set(input.slots.map(s => s.id)), hard: string[] = [], warnings: string[] = [], seen = new Set<string>();
  const forbidden = new Set(input.rules.apart.map(p => pairKey(...p)));
  for (const a of assignments) {
    if (!people.has(a.personId) || !slots.has(a.slotId)) { hard.push('現在の担当者・開催時間に含まれない配置があります。'); continue; }
    const key = a.slotId + '\n' + a.personId; if (seen.has(key)) hard.push('同じ時間に同じ担当者を重複して配置できません。'); seen.add(key);
    if (!input.availability[a.personId]?.includes(a.slotId)) warnings.push(`${people.get(a.personId)!.name}：未回答・時間なし・希望外の手動配置です。`);
  }
  for (const s of input.slots) {
    const members = assignments.filter(a => a.slotId === s.id);
    if (members.length > 2) hard.push(`${s.date} ${s.start}：1枠は2人までです。`);
    if (members.length === 2 && forbidden.has(pairKey(members[0].personId, members[1].personId))) hard.push(`${s.date} ${s.start}：禁止ペアになっています。`);
  }
  for (const p of input.people) {
    const own = new Set(assignments.filter(a => a.personId === p.id).map(a => a.slotId));
    if (input.rules.maxTotal !== undefined && own.size > input.rules.maxTotal) warnings.push(`${p.name}：総担当枠数の上限を超えています。`);
    if (input.rules.maxConsecutive !== undefined && consecutiveWindows(input.slots, input.rules.maxConsecutive).some(window => window.every(s => own.has(s)))) warnings.push(`${p.name}：連続担当枠数の上限を超えています。`);
  }
  const unmetTogether = input.rules.together.filter(([a, b]) => !input.slots.some(s => assignments.some(x => x.slotId === s.id && x.personId === a) && assignments.some(x => x.slotId === s.id && x.personId === b)));
  return { hard: [...new Set(hard)], warnings: [...new Set(warnings)], unmetTogether, missing: input.slots.reduce((sum, s) => sum + Math.max(0, 2 - assignments.filter(a => a.slotId === s.id).length), 0) };
}
export function parseShiftAssignments(value: unknown, previous: ShiftAssignment[], input: ShiftGenerationInput, confirmed: boolean): ShiftAssignment[] {
  if (!Array.isArray(value) || value.length > input.slots.length * 2) throw new ExhibitionError('配置内容を確認してください。');
  const known = new Map(previous.map(a => [a.id, a])), ids = new Set<string>();
  const result = value.map(raw => {
    const r = object(raw), id = text(r.id, '割当ID', 100, true), personId = text(r.personId, '担当者', 100, true), slotId = text(r.slotId, '時間枠', 100, true), old = known.get(id);
    if (ids.has(id)) throw new ExhibitionError('割当IDが重複しています。'); ids.add(id);
    const moved = !old || old.personId !== personId || old.slotId !== slotId;
    return { id, personId, slotId, manual: moved || !!old?.manual, fixed: moved ? true : r.fixed === true, ...(old?.override || confirmed ? { override: true } : {}) };
  });
  const issues = assignmentIssues(result, input);
  if (issues.hard.length) throw new ExhibitionError(issues.hard.join('\n'));
  if (issues.warnings.length && !confirmed) throw new ExhibitionError(issues.warnings.join('\n') + '\n内容を確認して「警告を確認して保存」を選んでください。', 422);
  return result;
}

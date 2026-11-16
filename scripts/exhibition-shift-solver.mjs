import { parentPort, workerData } from 'node:worker_threads';
import loadHighs from 'highs';
import { assignmentIssues } from '../src/lib/exhibitionShiftValidation.ts';
import { consecutiveWindows } from '../src/lib/exhibitionShiftSchedule.ts';
import { normalizeExhibitionGrade } from '../src/lib/exhibitionGrades.ts';

const gradeKey = value => {
  if (typeof value !== 'string') return '';
  const normalized = normalizeExhibitionGrade(value);
  if (normalized) return normalized;
  const label = value.normalize('NFKC').replace(/\s+/g, '');
  return /^(?:[56]年生?|修士|博士)$/.test(label) ? label.replace(/年生$/, '年') : '';
};

/** Every identifier in the optimization model is generated here, never taken from a name. */
export async function solveShifts(input, timeoutMs = 30000, progress = () => {}) {
  const started = Date.now(), deadline = started + timeoutMs;
  const fixed = input.fixed.map(a => ({ ...a }));
  if (assignmentIssues(fixed, input).hard.length) throw new Error('固定した配置に矛盾があります。');
  let best = { assignments: fixed, optimal: false, stages: 0, elapsedMs: 0 };
  progress(best);
  const fixedKeys = new Map(fixed.map(a => [a.personId + '\n' + a.slotId, a]));
  const variables = [], byPerson = new Map(), bySlot = new Map(), byKey = new Map();
  for (const p of input.people) for (const s of input.slots) {
    const key = p.id + '\n' + s.id;
    if (!input.availability[p.id]?.includes(s.id) && !fixedKeys.has(key)) continue;
    const v = { name: 'x' + variables.length, personId: p.id, slotId: s.id, fixed: fixedKeys.get(key) };
    variables.push(v); byKey.set(key, v);
    if (!byPerson.has(p.id)) byPerson.set(p.id, []); byPerson.get(p.id).push(v);
    if (!bySlot.has(s.id)) bySlot.set(s.id, []); bySlot.get(s.id).push(v);
  }
  if (!variables.length) return { ...best, optimal: true, stages: 5, elapsedMs: Date.now() - started };
  const rows = [], bounds = [], binary = variables.map(v => v.name);
  const expression = terms => terms.length ? terms.map(([n, c]) => `${c < 0 ? '-' : '+'} ${Math.abs(c)} ${n}`).join(' ') : '0 x0';
  const row = (terms, op, rhs) => rows.push(`r${rows.length}: ${expression(terms)} ${op} ${rhs}`);
  for (const v of variables) if (v.fixed) bounds.push(`${v.name} = 1`);
  for (const s of input.slots) if (bySlot.has(s.id)) row(bySlot.get(s.id).map(v => [v.name, 1]), '<=', 2);
  for (const [a, b] of input.rules.apart) for (const s of input.slots) {
    const x = byKey.get(a + '\n' + s.id), y = byKey.get(b + '\n' + s.id);
    if (x && y) row([[x.name, 1], [y.name, 1]], '<=', 1);
  }
  const balance = [];
  for (const own of byPerson.values()) {
    const fixedCount = own.filter(v => v.fixed).length;
    const cap = input.rules.maxTotal === undefined ? own.length : Math.max(input.rules.maxTotal, fixedCount);
    row(own.map(v => [v.name, 1]), '<=', cap);
    if (input.rules.maxConsecutive !== undefined) for (const window of consecutiveWindows(input.slots, input.rules.maxConsecutive)) {
      const current = own.filter(v => window.includes(v.slotId));
      if (current.length > input.rules.maxConsecutive) row(current.map(v => [v.name, 1]), '<=', Math.max(input.rules.maxConsecutive, current.filter(v => v.fixed).length));
    }
    const levels = [];
    for (let k = 1; k <= Math.min(own.length, cap); k++) {
      const n = 'b' + binary.length; binary.push(n); levels.push([n, -1]); balance.push([n, 2 * k - 1]);
    }
    row([...own.map(v => [v.name, 1]), ...levels], '=', 0);
  }
  const paired = [];
  for (const [a, b] of input.rules.together) {
    const joint = [];
    for (const s of input.slots) {
      const x = byKey.get(a + '\n' + s.id), y = byKey.get(b + '\n' + s.id);
      if (!x || !y) continue;
      const n = 'p' + binary.length; binary.push(n); joint.push([n, -1]);
      row([[n, 1], [x.name, -1]], '<=', 0); row([[n, 1], [y.name, -1]], '<=', 0);
    }
    if (joint.length) { const n = 't' + binary.length; binary.push(n); paired.push([n, 1]); row([[n, 1], ...joint], '<=', 0); }
  }
  // A slot holds at most two people: one binary per grade rewards a same-grade pair.
  // Coverage, explicit pair requests and fair workloads remain higher priorities.
  const grades = new Map(input.people.map(p => [p.id, gradeKey(p.grade)])), sameGrade = [];
  for (const own of bySlot.values()) {
    const groups = new Map();
    for (const v of own) { const grade = grades.get(v.personId); if (!grade) continue; if (!groups.has(grade)) groups.set(grade, []); groups.get(grade).push(v); }
    for (const group of groups.values()) if (group.length >= 2) {
      const n = 'g' + binary.length; binary.push(n); sameGrade.push([n, 1]);
      row([[n, 2], ...group.map(v => [v.name, -1])], '<=', 0);
    }
  }
  const objectives = [
    { sense: 'Maximize', terms: variables.map(v => [v.name, 1]) },
    { sense: 'Maximize', terms: paired },
    { sense: 'Minimize', terms: balance },
    { sense: 'Maximize', terms: sameGrade },
    { sense: 'Minimize', terms: variables.map(v => [v.name, input.availability[v.personId]?.length ?? 0]) },
  ];
  const highs = await loadHighs({ print: () => {}, printErr: () => {} });
  for (let stage = 0; stage < objectives.length; stage++) {
    const objective = objectives[stage];
    if (!objective.terms.length) { best.stages = stage + 1; continue; }
    const remaining = deadline - Date.now(); if (remaining < 30) break;
    const lp = `${objective.sense}\nobj: ${expression(objective.terms)}\nSubject To\n${rows.join('\n')}\nBounds\n${bounds.join('\n')}\nBinary\n${binary.join(' ')}\nEnd`;
    const result = highs.solve(lp, { time_limit: Math.max(.001, (remaining - 20) / 1000), output_flag: false, random_seed: 0, mip_rel_gap: 0, mip_abs_gap: 0 });
    const values = result.Columns;
    const feasible = !['Infeasible', 'Unbounded', 'Model error', 'Load error'].includes(result.Status) && variables.every(v => Number.isFinite(values[v.name]?.Primal) && Math.abs(values[v.name].Primal - Math.round(values[v.name].Primal)) < 1e-5) && result.Rows.every(r => Number.isFinite(r.Primal) && r.Primal >= r.Lower - 1e-5 && r.Primal <= r.Upper + 1e-5);
    if (!feasible) break;
    const assignments = variables.filter(v => values[v.name].Primal > .5).map(v => v.fixed ? { ...v.fixed } : ({ id: 'auto:' + v.name, personId: v.personId, slotId: v.slotId, fixed: false, manual: false }));
    if (assignmentIssues(assignments, input).hard.length) throw new Error('生成結果の配置を検証できませんでした。');
    best = { assignments, optimal: false, stages: stage + 1, elapsedMs: Date.now() - started }; progress(best);
    if (result.Status !== 'Optimal') break;
    row(objective.terms, '=', Math.round(result.ObjectiveValue));
    if (stage === objectives.length - 1) best.optimal = true;
  }
  return { ...best, elapsedMs: Date.now() - started };
}
if (parentPort && workerData) {
  try { parentPort.postMessage({ done: true, result: await solveShifts(workerData.input, workerData.timeoutMs, result => parentPort.postMessage({ result })) }); }
  catch { parentPort.postMessage({ error: 'シフトを生成できませんでした。固定配置・条件を確認してください。' }); }
}

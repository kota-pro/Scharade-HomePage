import { Worker } from 'node:worker_threads';
import path from 'node:path';
import crypto from 'node:crypto';
import { readExhibitions } from './exhibitions.ts';
import { shiftSourceKey, shiftInput } from './exhibitionShifts.ts';
import { readShiftStore, updateShiftStore, markShiftChanged } from './exhibitionShiftStore.ts';
import { assignmentIssues } from './exhibitionShiftValidation.ts';
import type { ShiftGenerationInput, ShiftGenerationResult } from './exhibitionShiftTypes.ts';
export function runShiftSolver(input: ShiftGenerationInput, timeoutMs = 30000): Promise<ShiftGenerationResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve('scripts/exhibition-shift-solver.mjs'), { workerData: { input, timeoutMs }, execArgv: ['--experimental-strip-types'] });
    let best: ShiftGenerationResult = { assignments: structuredClone(input.fixed), optimal: false, stages: 0, elapsedMs: 0 }, finished = false;
    const done = (error?: Error) => { if (finished) return; finished = true; clearTimeout(timer); void worker.terminate(); error ? reject(error) : resolve(best); };
    const timer = setTimeout(() => { best.optimal = false; best.elapsedMs = timeoutMs; done(); }, timeoutMs);
    worker.on('message', data => { if (data.result) best = data.result; if (data.error) done(new Error(data.error)); else if (data.done) done(); });
    worker.on('error', error => done(error instanceof Error ? error : new Error('シフト生成処理に失敗しました。')));
    worker.on('exit', code => { if (!finished) done(code ? new Error('シフト生成処理が終了しました。再実行してください。') : undefined); });
  });
}
/** Claim only one generation at a time across worker processes; saves remain responsive. */
export async function drainShiftGeneration(stopped = () => false) {
  if (stopped() || !readShiftStore().records.some(r => r.job?.state === 'queued' || (r.job?.state === 'running' && (r.job.leaseUntil ?? 0) <= Date.now()))) return false;
  const token = crypto.randomUUID();
  const claimed = await updateShiftStore(store => {
    const at = Date.now();
    if (store.records.some(r => r.job?.state === 'running' && (r.job.leaseUntil ?? 0) > at)) return null;
    const r = store.records.find(r => r.job?.state === 'queued' || (r.job?.state === 'running' && (r.job.leaseUntil ?? 0) <= at));
    if (!r?.job) return null;
    if (!readExhibitions().exhibitions.some(e => e.id === r.exhibitionId)) { r.job.state = 'stale'; return null; }
    r.job.state = 'running'; r.job.token = token; r.job.startedAt = new Date().toISOString(); r.job.leaseUntil = at + 45000;
    return { exhibitionId: r.exhibitionId, job: structuredClone(r.job) };
  });
  if (!claimed) return false;
  let result: ShiftGenerationResult | undefined, error = '';
  try { result = await runShiftSolver(claimed.job.input); } catch { error = 'シフトを生成できませんでした。条件を確認して再実行してください。'; }
  await updateShiftStore(store => {
    const r = store.records.find(r => r.exhibitionId === claimed.exhibitionId), e = readExhibitions().exhibitions.find(e => e.id === claimed.exhibitionId);
    if (!r?.job || r.job.token !== token) return;
    r.job.completedAt = new Date().toISOString(); delete r.job.leaseUntil;
    if (!e || r.job.sourceKey !== shiftSourceKey(e, r) || r.job.planRevision !== r.plan.revision) { r.job.state = 'stale'; return; }
    if (!result || error || assignmentIssues(result.assignments, shiftInput(e, r)).hard.length) { r.job.state = 'failed'; r.job.error = error || '生成結果を確認できませんでした。'; return; }
    r.plan = { revision: r.plan.revision + 1, assignments: result.assignments, sourceKey: r.job.sourceKey, generatedAt: new Date().toISOString(), optimal: result.optimal, stages: result.stages };
    r.job.state = 'ready'; markShiftChanged(r);
  });
  return true;
}

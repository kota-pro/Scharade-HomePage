import crypto from 'node:crypto';
import { isExecutive, type User } from './auth.ts';
import { readData, withStoreLock, writeData } from './store.ts';
import type { HelpTask } from './helpTypes.ts';

const FILE = 'help-task-reads.json';
type Read = { userId: string; taskId: string; version: string; at: string };
type Store = { version: 1; reads: Read[] };

function readStore() {
  const data = readData<Store>(FILE, { version: 1, reads: [] });
  if (data.version !== 1 || !Array.isArray(data.reads) || data.reads.some(r =>
    !r || typeof r.userId !== 'string' || typeof r.taskId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.version) || typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at))))
    throw new Error('やることの既読情報を確認してください。');
  return data;
}

export function canReadHelpTask(user: User | null | undefined, task: HelpTask) {
  return isExecutive(user) && task.group === 'management';
}

export function helpTaskReadVersion(task: HelpTask) {
  return crypto.createHash('sha256').update(JSON.stringify([
    task.id, task.title, task.description, task.guideId, task.entityId ?? '',
    task.href, task.dueAt ?? '', !!task.optional,
  ])).digest('hex');
}

export function withHelpTaskReads(user: User, tasks: HelpTask[], source: 'local' | 'accounting' = 'local'): HelpTask[] {
  if (!isExecutive(user)) return tasks;
  const reads = new Map(readStore().reads.filter(r => r.userId === user.id).map(r => [r.taskId, r]));
  return tasks.map(task => {
    if (!canReadHelpTask(user, task)) return task;
    const version = helpTaskReadVersion(task), read = reads.get(task.id);
    return { ...task, readState: { source, version, ...(read?.version === version ? { at: read.at } : {}) } };
  });
}

export async function markHelpTaskRead(user: User, task: HelpTask) {
  if (!canReadHelpTask(user, task)) throw new Error('このやることは既読にできません。');
  return withStoreLock(FILE, () => {
    const data = readStore(), version = helpTaskReadVersion(task);
    const previous = data.reads.find(r => r.userId === user.id && r.taskId === task.id && r.version === version);
    const read = previous ?? { userId: user.id, taskId: task.id, version, at: new Date().toISOString() };
    data.reads = data.reads.filter(r => r.userId !== user.id || r.taskId !== task.id);
    data.reads.push(read);
    writeData(FILE, data);
    return read;
  });
}

export async function clearHelpTaskReads(userId: string) {
  return withStoreLock(FILE, () => {
    const data = readStore();
    const reads = data.reads.filter(r => r.userId !== userId && r.taskId !== `approval:${userId}` && r.taskId !== `approval-followup:${userId}`);
    if (reads.length !== data.reads.length) writeData(FILE, { version: 1, reads });
  });
}

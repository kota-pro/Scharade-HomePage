import { readData, writeData, withStoreLock } from './store.ts';
import { defaultShiftConfig, type ExhibitionShiftStore, type ShiftRecord } from './exhibitionShiftTypes.ts';
export function readShiftStore(): ExhibitionShiftStore {
  const data = readData<ExhibitionShiftStore>('exhibition-shifts.json', { version: 1, records: [] });
  if (data.version !== 1 || !Array.isArray(data.records)) throw new Error('シフトの保存データを確認してください。');
  return data;
}
export function shiftRecord(store: ExhibitionShiftStore, exhibitionId: string): ShiftRecord {
  let record = store.records.find(r => r.exhibitionId === exhibitionId);
  if (!record) {
    record = { exhibitionId, revision: 0, config: defaultShiftConfig(), responses: [], guests: [], plan: { revision: 0, assignments: [], sourceKey: '' }, history: [], sync: { revision: 0, delivered: 0, attempts: 0, nextAttemptAt: 0 }, notices: [] };
    store.records.push(record);
  }
  return record;
}
export function updateShiftStore<T>(action: (data: ExhibitionShiftStore) => T | Promise<T>): Promise<T> {
  return withStoreLock('exhibition-shifts', async () => { const data = readShiftStore(); const result = await action(data); writeData('exhibition-shifts.json', data); return result; });
}
export function markShiftChanged(record: ShiftRecord) { record.revision++; record.sync.revision++; record.sync.nextAttemptAt = 0; }

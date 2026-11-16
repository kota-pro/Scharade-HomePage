import crypto from 'node:crypto';
import { readExhibitions, updateExhibitionStore } from './exhibitions.ts';
import { readShiftStore, updateShiftStore } from './exhibitionShiftStore.ts';
import { shiftPeople } from './exhibitionShifts.ts';
import { shiftSlots, scheduleKey } from './exhibitionShiftSchedule.ts';
import { exhibitionGoogleConfigured, postExhibitionGas, exhibitionDriveOwner } from './exhibitionGoogleGateway.ts';
import { appendExhibitionNotice } from './activities.ts';
import { readUsers } from './auth.ts';
export async function drainShiftDeliveries(limit = 20, stopped = () => false) {
  let attempted = 0, delivered = 0;
  for (const pending of readShiftStore().records) {
    if (stopped() || attempted >= limit) break;
    const e = readExhibitions().exhibitions.find(e => e.id === pending.exhibitionId); if (!e) continue;
    // Serialize with deletion so a late outbox cannot resurrect a deleted exhibition notice.
    for (const notice of pending.notices.filter(n => !n.delivered)) {
      if (stopped()) break;
      await updateExhibitionStore(async store => {
        const current = store.exhibitions.find(e => e.id === pending.exhibitionId); if (!current) return;
        await appendExhibitionNotice({ id: notice.id, kind: 'exhibition-shift', exhibitionId: e.id, title: `展示シフト${notice.version === 1 ? '公開' : '更新'}：${current.title}`, body: `展示シフトの第${notice.version}版を公開しました。自分の担当時間を確認してください。`, senderId: notice.actorId, senderName: readUsers().find(u => u.id === notice.actorId)?.name ?? '写真展運営', recipientIds: notice.recipientIds, createdAt: notice.at });
        await updateShiftStore(data => { const n = data.records.find(r => r.exhibitionId === e.id)?.notices.find(n => n.id === notice.id); if (n) n.delivered = true; });
      });
    }
    if (!exhibitionGoogleConfigured('exhibition-drive') || pending.sync.revision <= pending.sync.delivered || Math.max(pending.sync.nextAttemptAt, pending.sync.leaseUntil ?? 0) > Date.now()) continue;
    const token = crypto.randomUUID();
    const job = await updateShiftStore(store => {
      const r = store.records.find(r => r.exhibitionId === e.id);
      if (!r || r.sync.revision <= r.sync.delivered || (r.sync.leaseUntil ?? 0) > Date.now()) return null;
      r.sync.token = token; r.sync.leaseUntil = Date.now() + 120000; r.sync.attempts++;
      return { revision: r.sync.revision, people: shiftPeople(r), responses: r.responses, published: r.published, scheduleKey: scheduleKey(e.openingSchedule), slots: shiftSlots(e.openingSchedule) };
    });
    if (!job) continue; attempted++;
    try {
      const result = await postExhibitionGas({ action: 'shift.sheet.sync', exhibitionId: e.id, exhibitionTitle: e.title, year: e.year ?? Number((e.openingSchedule?.startDate ?? e.createdAt).slice(0, 4)), ...job }, 60000, 'exhibition-drive');
      if (result.owner !== exhibitionDriveOwner || !/^[A-Za-z0-9_-]{10,200}$/.test(String(result.spreadsheetId)) || result.revision !== job.revision) throw new Error('invalid-response');
      await updateShiftStore(store => { const r = store.records.find(r => r.exhibitionId === e.id); if (!r || r.sync.token !== token) return; r.sync.delivered = job.revision; r.sync.spreadsheetId = result.spreadsheetId; r.sync.url = `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}/edit`; r.sync.attempts = 0; delete r.sync.error; delete r.sync.token; delete r.sync.leaseUntil; });
      delivered++;
    } catch {
      await updateShiftStore(store => { const r = store.records.find(r => r.exhibitionId === e.id); if (!r || r.sync.token !== token) return; r.sync.error = 'Googleへの保存を再試行しています。サイトの回答は保存済みです。'; r.sync.nextAttemptAt = Date.now() + Math.min(900000, 30000 * 2 ** Math.min(r.sync.attempts - 1, 5)); delete r.sync.token; delete r.sync.leaseUntil; });
    }
  }
  return { attempted, delivered };
}

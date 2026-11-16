import { deadlinePassed } from './advisoryWarnings.ts';
import { isMemberAccount } from "./accountVisibility.ts";
import crypto from 'node:crypto';
import { readUsers, isStaff } from './auth.ts';
import { readActivities } from './activities.ts';
import { notificationRecipient } from './notificationRecipients.ts';
import { readExhibitions, findExhibition, requireStaff, updateExhibitionStore } from './exhibitions.ts';
import { exhibitionMember } from './exhibitionParticipation.ts';
import { ExhibitionError, object, text, id } from './exhibitionValidation.ts';
import { parseOpeningSchedule, scheduleKey, shiftSlots } from './exhibitionShiftSchedule.ts';
import { readShiftStore, shiftRecord, updateShiftStore, markShiftChanged } from './exhibitionShiftStore.ts';
import { parseShiftAnswer, parseShiftConfig, parseShiftAssignments, assignmentIssues } from './exhibitionShiftValidation.ts';
import type { Exhibition } from './exhibitionTypes.ts';
import { shiftReviewReasons } from './exhibitionShiftReview.ts';
import { emptyShiftAnswer, type ShiftRecord, type ShiftPerson, type ShiftGenerationInput, type ShiftAssignment } from './exhibitionShiftTypes.ts';
const now = () => new Date().toISOString();
export function shiftPeople(record: ShiftRecord, includeSearchNames = false): ShiftPerson[] {
  const activities = readActivities();
  const submissions = includeSearchNames ? readExhibitions().submissions.filter(s => s.exhibitionId === record.exhibitionId && !s.inactive) : [];
  return readUsers().filter(isMemberAccount).map<ShiftPerson>(u => {
    const r = notificationRecipient(u, activities), rosterKey = activities.roster?.bindings[u.id];
    const roster = rosterKey ? activities.roster?.records.find(row => row.key === rosterKey && row.active) : undefined;
    const formNames = submissions.filter(s => s.userId === u.id).flatMap(s => [s.draft?.name, s.draft?.authorName, s.versions.at(-1)?.content.name, s.versions.at(-1)?.content.authorName]);
    const searchNames = includeSearchNames ? [...new Set([u.portfolioName, roster?.name, ...formNames].filter((v): v is string => !!v?.trim()))] : [];
    return { id: r.id, name: r.name, lineName: r.lineName, grade: r.gradeLabel, ...(searchNames.length ? { searchNames } : {}) };
  }).concat(record.guests);
}
export function shiftInput(e: Exhibition, r: ShiftRecord): ShiftGenerationInput {
  const key = scheduleKey(e.openingSchedule), people = shiftPeople(r), ids = new Set(people.map(p => p.id)), slots = shiftSlots(e.openingSchedule), slotIds = new Set(slots.map(s => s.id));
  return { slots, people, rules: r.config.rules, fixed: r.plan.assignments.filter(a => a.fixed && ids.has(a.personId) && slotIds.has(a.slotId)), availability: Object.fromEntries(r.responses.filter(x => ids.has(x.userId) && x.submitted && x.submitted.scheduleKey === key && !x.submitted.none).map(x => [x.userId, x.submitted!.slotIds])) };
}
export function shiftSourceKey(e: Exhibition, r: ShiftRecord) {
  const input = shiftInput(e, r);
  return crypto.createHash('sha256').update(JSON.stringify({ schedule: e.openingSchedule, people: input.people, availability: input.availability, rules: input.rules, fixed: input.fixed })).digest('hex');
}
export function memberShiftState(e: Exhibition, r: ShiftRecord, userId: string, clock = Date.now()) {
  const required = e.participation?.votes[userId]?.value === 'attending';
  const layoutSubmitted = readExhibitions().submissions.some(s => s.exhibitionId === e.id && s.userId === userId && !s.inactive && s.versions.length > 0);
  const announced = e.participation?.state === 'published';
  const accepting = announced && r.config.state === 'open' && !!e.openingSchedule && Date.parse(r.config.opensAt) <= clock;
  const canSubmit = accepting && (!required || layoutSubmitted);
  return { required, layoutSubmitted, accepting, canSubmit, overdue:canSubmit&&deadlinePassed(r.config.closesAt,clock), message: !announced || r.config.state === 'draft' ? 'シフト受付の準備中です。' : !accepting ? '現在はシフト受付期間外です。' : required && !layoutSubmitted ? '出展者は先にレイアウトフォームを提出してください。' : '' };
}
export function memberShiftData(exhibitionId: string, actorId: string) {
  const user = exhibitionMember(actorId), e = findExhibition(readExhibitions(), id(exhibitionId)), r = shiftRecord(readShiftStore(), e.id);
  if ((e.participation?.state !== 'published' || r.config.state === 'draft') && !r.published && !isStaff(user)) throw new ExhibitionError('このシフトフォームは準備中です。', 404);
  const state = memberShiftState(e, r, user.id), response = r.responses.find(x => x.userId === user.id);
  return { ok: true, viewerId: user.id, exhibition: { id: e.id, title: e.title, openingSchedule: e.openingSchedule }, slots: shiftSlots(e.openingSchedule), scheduleKey: scheduleKey(e.openingSchedule), intake: { state: r.config.state, opensAt: r.config.opensAt, closesAt: r.config.closesAt }, ...state, response: response ?? null, needsReview: !!response?.submitted && response.submitted.scheduleKey !== scheduleKey(e.openingSchedule), published: r.published ? { version: r.published.version, at: r.published.at, slots: r.published.slots, people: r.published.people.map(p => ({ id: p.id, name: p.name, guest: p.guest })), assignments: r.published.assignments.map(a => ({ id: a.id, slotId: a.slotId, personId: a.personId })), oldSchedule: JSON.stringify(r.published.slots) !== JSON.stringify(shiftSlots(e.openingSchedule)) } : null };
}
export async function memberShiftAction(exhibitionId: string, actorId: string, value: unknown) {
  const raw = object(value), user = exhibitionMember(actorId);
  if (raw.ownerId !== user.id) throw new ExhibitionError('ログイン中のアカウントが変わりました。再ログインしてください。', 401);
  if (!['save', 'submit'].includes(String(raw.action))) throw new ExhibitionError('操作を確認してください。');
  await updateShiftStore(data => {
    const e = findExhibition(readExhibitions(), id(exhibitionId)), r = shiftRecord(data, e.id), state = memberShiftState(e, r, user.id);
    if (!state.canSubmit) throw new ExhibitionError(state.message, 403);
    if (raw.scheduleKey !== scheduleKey(e.openingSchedule)) throw new ExhibitionError('開催日時が変更されています。再読み込みして確認してください。', 409);
    let response = r.responses.find(x => x.userId === user.id);
    if ((response?.revision ?? 0) !== raw.revision) throw new ExhibitionError('別の画面で回答が変更されています。保存状態を確認してください。', 409);
    const answer = parseShiftAnswer(raw.content, shiftSlots(e.openingSchedule), raw.action === 'submit');
    if (!response) { response = { userId: user.id, revision: 0, draft: emptyShiftAnswer(), updatedAt: now() }; r.responses.push(response); }
    response.draft = answer; response.revision++; response.updatedAt = now();
    if (raw.action === 'submit') response.submitted = { ...structuredClone(answer), at: now(), scheduleKey: scheduleKey(e.openingSchedule) };
    markShiftChanged(r);
  });
  return memberShiftData(exhibitionId, actorId);
}
export function staffShiftData(exhibitionId: string, actorId: string) {
  requireStaff(actorId); const e = findExhibition(readExhibitions(), id(exhibitionId)), r = shiftRecord(readShiftStore(), e.id), input = shiftInput(e, r), sourceKey = shiftSourceKey(e, r);
  const submissions = readExhibitions().submissions;
  return { ok: true, exhibition: { id: e.id, title: e.title, revision: e.revision, openingSchedule: e.openingSchedule, announced: e.participation?.state === 'published' }, record: { ...r, job: r.job ? { id: r.job.id, state: r.job.state, error: r.job.error, createdAt: r.job.createdAt } : undefined }, slots: input.slots, scheduleKey: scheduleKey(e.openingSchedule), people: shiftPeople(r, true), availability: input.availability, requiredIds: Object.entries(e.participation?.votes ?? {}).filter(([, v]) => v.value === 'attending').map(([id]) => id), layoutSubmittedIds: [...new Set(submissions.filter(s => s.exhibitionId === e.id && !s.inactive && s.versions.length).map(s => s.userId).filter(Boolean))], sourceKey, reviewReasons: shiftReviewReasons(r, input, r.plan.sourceKey && r.plan.sourceKey !== sourceKey ? r.plan.sourceKey : r.published?.sourceKey ?? ''), stale: !!r.plan.sourceKey && r.plan.sourceKey !== sourceKey, issues: assignmentIssues(r.plan.assignments, input), publishedNeedsReview: !!r.published && r.published.sourceKey !== sourceKey };
}
export async function staffShiftAction(exhibitionId: string, actorId: string, value: unknown) {
  const actor = requireStaff(actorId), raw = object(value);
  if (raw.action === 'schedule') {
    await updateExhibitionStore(store => {
      const e = findExhibition(store, id(exhibitionId));
      if (e.revision !== raw.exhibitionRevision) throw new ExhibitionError('写真展が変更されています。再読み込みしてください。', 409);
      e.openingSchedule = parseOpeningSchedule(raw.openingSchedule); e.revision++; e.updatedAt = now();
    });
    await updateShiftStore(store => markShiftChanged(shiftRecord(store, exhibitionId)));
    return staffShiftData(exhibitionId, actorId);
  }
  await updateShiftStore(store => {
    requireStaff(actorId); const e = findExhibition(readExhibitions(), id(exhibitionId)), r = shiftRecord(store, e.id);
    if (r.revision !== raw.revision) throw new ExhibitionError('別の操作でシフトが更新されました。再読み込みして確認してください。', 409);
    if (raw.action === 'settings') {
      r.config = parseShiftConfig(raw.config, shiftPeople(r));
      if (r.config.state !== 'draft' && !e.openingSchedule) throw new ExhibitionError('先に開催期間・展示時間を設定してください。');
    } else if (raw.action === 'guest') {
      const name = text(raw.name, '担当者名', 150, true);
      if (/[\r\n\x00-\x1f\x7f]/.test(name)) throw new ExhibitionError('担当者名は1行で入力してください。');
      if (!r.guests.some(p => p.name === name)) {
        if (r.guests.length >= 1000) throw new ExhibitionError('手入力担当者の登録上限です。');
        r.guests.push({ id: 'guest:' + crypto.randomUUID(), name, guest: true });
      }
    } else if (raw.action === 'plan.save') {
      if (r.plan.revision !== raw.planRevision) throw new ExhibitionError('編集案が変更されています。再読み込みしてください。', 409);
      const input = shiftInput(e, r);
      r.plan.assignments = parseShiftAssignments(raw.assignments, r.plan.assignments, input, raw.confirmWarnings === true);
      r.plan.revision++; r.plan.sourceKey = shiftSourceKey(e, r);
      if (raw.review === true) r.plan.reviewed = true;
      else delete r.plan.reviewed;
    } else if (raw.action === 'generate') {
      if (!e.openingSchedule) throw new ExhibitionError('開催期間を設定してください。');
      if (r.job && ['queued', 'running'].includes(r.job.state) && (!r.job.leaseUntil || r.job.leaseUntil > Date.now())) throw new ExhibitionError('シフトを生成中です。完了をお待ちください。', 409);
      const input = shiftInput(e, r), hard = assignmentIssues(input.fixed, input).hard;
      if (hard.length) throw new ExhibitionError(hard.join('\n'));
      r.job = { id: crypto.randomUUID(), state: 'queued', actorId, sourceKey: shiftSourceKey(e, r), planRevision: r.plan.revision, createdAt: now(), input };
    } else if (raw.action === 'publish') {
      if (r.plan.revision !== raw.planRevision || r.plan.sourceKey !== shiftSourceKey(e, r)) throw new ExhibitionError('回答・開催設定が変わっています。案を保存して再確認するか、再生成してください。', 409);
      const issues = assignmentIssues(r.plan.assignments, shiftInput(e, r));
      if (issues.hard.length) throw new ExhibitionError(issues.hard.join('\n'));
      if (issues.missing && raw.confirmMissing !== true) throw new ExhibitionError(`担当者が${issues.missing}席不足しています。確認して公開してください。`, 422);
      if (r.published && JSON.stringify(r.published.assignments) === JSON.stringify(r.plan.assignments) && r.published.sourceKey === r.plan.sourceKey) return;
      const published = { ...structuredClone(r.plan), version: (r.published?.version ?? 0) + 1, at: now(), actorId: actor.id, slots: shiftSlots(e.openingSchedule), people: shiftPeople(r), rules: structuredClone(r.config.rules) };
      if (r.published) r.history.unshift(r.published); r.published = published;
      r.notices.push({ id: crypto.randomUUID(), version: published.version, at: published.at, actorId, recipientIds: readUsers().filter(isMemberAccount).map(u => u.id) });
    } else throw new ExhibitionError('操作を確認してください。');
    markShiftChanged(r);
  });
  return staffShiftData(exhibitionId, actorId);
}

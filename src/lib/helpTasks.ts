import { beforeEventDay } from './advisoryWarnings.ts';
import { readUsers, isStaff, isExecutive, canManageAccount, type User } from './auth.ts';
import { readActivities, groupSource } from './activities.ts';
import { readExhibitions } from './exhibitions.ts';
import { participationState } from './exhibitionParticipation.ts';
import { listTools, receptionOpen, recipient } from './memberTools.ts';
import { readDeletionRequests } from './accountDeletionRequests.ts';
import { canApproveRegistration } from './accountReview.ts';
import { accountingView } from './accounting.ts';
import { sortHelpTasks, type HelpTask } from './helpTypes.ts';
import { readShiftStore } from './exhibitionShiftStore.ts';
import { scheduleKey } from './exhibitionShiftSchedule.ts';
import { isSiteManagement, isMemberAccount } from './accountVisibility.ts';

export function localHelpTasks(user: User | null | undefined, now = Date.now()) {
  const tasks: HelpTask[] = [], completed: string[] = [], errors: string[] = [];
  if (!user?.approved) return { tasks, completed, errors };
  const personal = !isSiteManagement(user);
  const add = (id: string, title: string, description: string, guideId: string, entityId: string, href: string, dueAt?: string, group: HelpTask['group'] = 'personal', optional = false) => tasks.push({ id, title, description, guideId, entityId, href, dueAt, group, optional });
  try {
    const data = readActivities();
    for (const e of data.events) {
      if (e.status !== 'published') continue;
      if (personal && e.recipientIds.includes(user.id)) {
        if (e.votes[user.id]) completed.push(`event-vote:${e.id}`);
        else if (now < Date.parse(e.deadline) && beforeEventDay(e.startsAt,now)) add(`event-vote:${e.id}`, `${e.title}の参加回答`, '参加・不参加などを回答してください。', 'event-vote', e.id, `/Member/events/${e.id}`, e.deadline);
      }
      if (isStaff(user) && e.publishedGroups && e.publishedGroups.source !== groupSource(data, e, readUsers(), now))
        add(`groups:${e.id}`, `${e.title}の班分け再確認`, '参加者や条件が変わっています。班案を確認して公開してください。', 'event-manage', e.id, `/Member/manage/events/${e.id}`, undefined, 'management');
    }
  } catch { errors.push('企画'); }
  if (personal) {
    try {
      const data = readExhibitions();
      for (const e of data.exhibitions) {
        const state = participationState(e, user, now);
        if (!state.invited || e.participation?.state !== 'published') continue;
        if (state.vote !== 'unanswered') completed.push(`exhibition-vote:${e.id}`);
        else if (state.canVote && now < Date.parse(state.voteClosesAt)) add(`exhibition-vote:${e.id}`, `${e.title}の参加投票`, '出展するかどうかを回答してください。', 'exhibition-vote', e.id, `/Member/exhibitions/${e.id}`, state.voteClosesAt);
        if (state.vote === 'attending') completed.push(`exhibition-attending:${e.id}`);
        const submitted = data.submissions.some(s => s.userId === user.id && s.exhibitionId === e.id && !s.inactive && s.versions.length > 0);
        if (data.submissions.some(s => s.userId === user.id && s.exhibitionId === e.id && !s.inactive)) completed.push(`exhibition-start:${e.id}`);
        if (submitted) completed.push(`exhibition-submit:${e.id}`);
        else if (state.accepting) add(`exhibition-submit:${e.id}`, `${e.title}の作品提出`, '下書き保存だけでは提出は完了しません。「提出する」まで進めてください。', 'exhibition-submit', e.id, `/Exhibition/${e.id}`, e.closesAt);
      }
    } catch { errors.push('写真展'); }
    try {
      const shifts = readShiftStore(), exhibitions = readExhibitions();
      for (const e of exhibitions.exhibitions) {
        const r = shifts.records.find(r => r.exhibitionId === e.id);
        if (!r || e.participation?.state !== 'published') continue;
        const own = r.responses.find(r => r.userId === user.id)?.submitted;
        const current = !!own && own.scheduleKey === scheduleKey(e.openingSchedule);
        if (current) completed.push(`exhibition-shift:${e.id}`);
        if (current || r.config.state !== 'open' || !e.openingSchedule || !(Date.parse(r.config.opensAt) <= now && now < Date.parse(r.config.closesAt))) continue;
        const required = e.participation.votes[user.id]?.value === 'attending';
        const submitted = exhibitions.submissions.some(s => s.userId === user.id && s.exhibitionId === e.id && !s.inactive && s.versions.length > 0);
        add(`exhibition-shift:${e.id}`, `${e.title}のシフト希望${own ? 'を再確認' : 'を提出'}`, required && !submitted ? '出展者は作品を提出した後に、入れる時間を選んでシフト希望を提出してください。' : own ? '開催日時が変更されています。希望時間を確認し、もう一度提出してください。' : '入れる時間を選び、シフト希望を提出してください。入れる時間がない場合も回答できます。', 'exhibition-shift', e.id, `/Member/exhibitions/${e.id}/shifts`, r.config.closesAt, 'personal', !required);
      }
    } catch { errors.push('展示シフト'); }
    try {
      for (const t of listTools()) {
        if (t.status !== 'published' || !recipient(t, user)) continue;
        const own = t.responses.filter(r => r.userId === user.id);
        if (own.length && !own.some(r => r.choices.some(id => !t.options.some(o => o.id === id && !o.removed)))) completed.push(`tool-answer:${t.id}`);
        else if (receptionOpen(t, now) && (!t.settings.endsAt || now < Date.parse(t.settings.endsAt))) add(`tool-answer:${t.id}`, `${t.question || '質問'}への回答`, t.kind === 'box' ? '目安箱への投稿は任意です。伝えたいことがある場合にご利用ください。' : '質問を確認し、回答してください。', 'tool-answer', t.id, `/Member/tools/${t.id}`, t.settings.endsAt || undefined, 'personal', t.kind === 'box');
      }
    } catch { errors.push('投票・日程調整・目安箱'); }
  }
  if (isExecutive(user)) {
    try {
      const data = readActivities(), roster = data.roster, users = readUsers().filter(isMemberAccount);
      if (!roster) add('roster:setup', '名簿の参照先を設定', '入会・継続フォームの参照先を指定し、取得内容を確認してください。', 'roster', '', '/Admin/grouping-roster', undefined, 'management');
      {
        const known = roster?.records ?? [];
        const unresolved = users.filter(u => {
          const record = known.find(r => r.key === roster?.bindings[u.id]);
          return !!u.rosterRelink || !record?.active || record.identityUncertain || record.membershipUncertain;
        });
        if (unresolved.length) add('roster:bindings', `名簿とアカウントの未連携を確認（${unresolved.length}件）`, '氏名一致の候補も未確定です。本人の回答を確認し、対応を保存してください。', roster?.records.length ? 'roster-link' : 'roster', '', '/Admin/grouping-roster', undefined, 'management');
        const reviews = (roster?.records ?? []).filter(r => r.identityUncertain || r.membershipUncertain || r.needsReview?.length);
        if (reviews.length) add('roster:review', `名簿の要確認の回答（${reviews.length}件）`, '参照先の回答を確認し、取得内容の確認画面から変更を確認してください。', 'roster', '', '/Admin/grouping-roster', undefined, 'management');
      }
      const failed = (data.rosterPortfolioUpdates || []).filter((j, i, all) => j.status === 'error' && !all.slice(i + 1).some(next => next.portfolioId === j.portfolioId));
      if (failed.length) add('roster:portfolio', `Portfolioへの名簿反映を再確認（${failed.length}件）`, '更新状況とエラーを確認し、名簿の反映を再試行してください。', 'roster-retry', '', '/Admin/grouping-roster', undefined, 'management');
      const exports = (data.rosterExports || []).filter(j => j.status === 'error');
      if (exports.length) add('roster:exports', `統合名簿の保存を再確認（${exports.length}件）`, '保存状況とエラーを確認し、統合名簿の保存を再試行してください。', 'roster-retry', '', '/Admin/grouping-roster', undefined, 'management');
    } catch { errors.push('名簿管理'); }
    try {
      const deletionRequests = readDeletionRequests().requests;
      const withdrawing = new Set(deletionRequests.filter(r => r.status !== 'complete').map(r => r.userId));
      for (const target of readUsers()) {
        if (!canApproveRegistration(user, target) || withdrawing.has(target.id)) continue;
        const href = `/Admin/accounts/${encodeURIComponent(target.id)}`;
        if (!target.approved && !target.approvalReviewedAt)
          add(`approval:${target.id}`, `${target.name || '申請者'}の登録承認`, '登録内容を確認し、承認してください。', 'account-approve', target.id, href, undefined, 'management');
        else {
          completed.push(`account-approve:${target.id}`);
          if (!target.approvalNotifiedAt || target.approvalSetup && !target.approvalSetup.recipientsCompletedAt)
            add(`approval-followup:${target.id}`, `${target.name}の承認後の確認`, !target.approvalNotifiedAt ? '開設メールの送信を再試行してください。' : '通知先への追加を再確認してください。', 'account-approve', target.id, href, undefined, 'management');
        }
      }
      for (const r of deletionRequests) {
        const target = readUsers().find(u => u.id === r.userId);
        if (r.userId === user.id || target && !canManageAccount(user, target)) continue;
        if (r.status === 'complete') completed.push(`account-delete:${r.id}`);
        else add(`deletion:${r.id}`, `${r.name || '申請者'}のアカウント削除申請`, r.status === 'processing' ? '外部保存先とバックアップを確認し、削除処理を完了してください。' : '本人確認済みの削除申請を処理してください。', 'account-delete', r.id, `/Admin/account-deletion-requests/${r.id}`, new Date(r.dueAt).toISOString(), 'management');
      }
    } catch { errors.push('アカウント管理'); }
  }
  return { tasks: sortHelpTasks(tasks), completed, errors };
}

export async function accountingHelpTasks(user: User) {
  if (!isExecutive(user)) return [];
  const { data } = await accountingView(user.id);
  const tasks: HelpTask[] = [];
  const add = (id: string, title: string, description: string, guideId: string) => tasks.push({ id, title, description, group: 'management', guideId, href: '/Admin/accounting' });
  if (data.requests.some(r => r.status === '未承認')) add('accounting:requests', `立替申請の確認（${data.requests.filter(r => r.status === '未承認').length}件）`, '領収書と内容を確認して、承認・却下を選んでください。', 'accounting-requests');
  if (data.summary?.advances.some(a => a.outstanding > 0)) add('accounting:refunds', '未返金の立替を確認', '未返金額と返金先を確認して返金を記録してください。', 'accounting-refunds');
  if (data.rosterPending.length) add('accounting:roster', '会計の人物対応を確認', '名簿と会計の人物を対応付けてください。', 'accounting-roster');
  if (data.pendingOperations.length) add('accounting:recover', '会計の中断した保存を再確認', '前回の操作結果を確認してから次の記録に進んでください。', 'accounting-recover');
  return tasks;
}

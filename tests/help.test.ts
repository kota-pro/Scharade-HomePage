import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { searchHelp, normalizeHelpQuery } from '../src/lib/helpTypes.ts';
import { placeHelpArrow, overlaps } from '../src/lib/helpPosition.ts';
import { helpCatalog, helpGuide, pageHelp } from '../src/lib/helpCatalog.ts';
import { localHelpTasks } from '../src/lib/helpTasks.ts';
import { emptyActivities, defaultRules } from '../src/lib/activityTypes.ts';
import { defaultToolSettings, defaultToolPublication } from '../src/lib/memberToolTypes.ts';
import { writeData } from '../src/lib/store.ts';
import type { User } from '../src/lib/auth.ts';
import { applyAccountReview, approveRegistration } from '../src/lib/accountReview.ts';
import { accountRevision } from '../src/lib/accountManagement.ts';
import { canReadHelpTask, clearHelpTaskReads, helpTaskReadVersion, markHelpTaskRead, withHelpTaskReads } from '../src/lib/helpTaskReads.ts';
import { GET as getHelpTasks, POST as postHelpTasks } from '../src/pages/api/help/tasks.ts';
import type { HelpTask } from '../src/lib/helpTypes.ts';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scharade-help-'));
const at = '2026-11-04T00:00:00.000Z', now = Date.parse(at);
const member: User = { id: 'member', name: '会員', email: 'member@example.invalid', role: 'member', approved: true, createdAt: at, providers: {} };
const staff: User = { ...member, id: 'staff', role: 'staff' };
const executive: User = { ...member, id: 'executive', role: 'executive' };
const admin: User = { ...member, id: 'admin', role: 'admin' };
const pending: User = { ...member, id: 'pending', name: '申請者', approved: false };
beforeEach(() => {
  process.env.DATA_DIR = directory;
  fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory);
  writeData('users.json', [member, staff, executive, admin, pending]);
  writeData('member-activities.json', emptyActivities());
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('management read receipts are explicit, account-specific and never complete a task', async () => {
  const task: HelpTask = { id: 'roster:setup', title: '名簿の参照先を設定', description: '参照先を確認', group: 'management', guideId: 'roster', href: '/Admin/grouping-roster' };
  assert.equal(withHelpTaskReads(executive, [task])[0].readState?.at, undefined);
  assert.equal(withHelpTaskReads(executive, [task])[0].readState?.version, helpTaskReadVersion(task));
  assert.ok(!fs.existsSync(path.join(directory, 'help-task-reads.json')));
  const first = await markHelpTaskRead(executive, task);
  assert.equal(withHelpTaskReads(executive, [task])[0].readState?.at, first.at);
  assert.equal(withHelpTaskReads(admin, [task])[0].readState?.at, undefined);
  assert.equal((await markHelpTaskRead(executive, task)).at, first.at);
  assert.equal(withHelpTaskReads(executive, [{ ...task, description: '参照先に新しい確認内容' }])[0].readState?.at, undefined);
  assert.ok(localHelpTasks(executive, now).tasks.some(t => t.id === task.id));
  await clearHelpTaskReads(executive.id);
  assert.equal(withHelpTaskReads(executive, [task])[0].readState?.at, undefined);
});
test('read receipts exclude personal answers and roles below executive, including direct writes', async () => {
  const task: HelpTask = { id: 'groups:e', title: '班分け', description: '', group: 'management', guideId: 'event-manage', href: '/Member/manage/events/e' };
  const personal: HelpTask = { ...task, group: 'personal' };
  for (const user of [member, staff, { ...admin, approved: false }]) {
    assert.equal(canReadHelpTask(user, task), false);
    assert.equal(withHelpTaskReads(user, [task])[0].readState, undefined);
    await assert.rejects(markHelpTaskRead(user, task));
  }
  assert.equal(canReadHelpTask(admin, personal), false);
  assert.equal(withHelpTaskReads(admin, [personal])[0].readState, undefined);
  await assert.rejects(markHelpTaskRead(admin, personal));
});
test('help read API checks identity, role, current content and resolution', async () => {
  const get = (user: User | null, readOnly = false) => getHelpTasks({ locals: { user, adminView: readOnly ? { readOnly } : null }, url: new URL('https://fixture.invalid/api/help/tasks') } as any) as Promise<Response>;
  const post = (user: User | null, body: unknown, readOnly = false) => postHelpTasks({ locals: { user, adminView: readOnly ? { readOnly } : null }, request: new Request('https://fixture.invalid/api/help/tasks', { method: 'POST', body: JSON.stringify(body) }) } as any) as Promise<Response>;
  const data = await (await get(admin)).json(), task = data.tasks.find((t: HelpTask) => t.id === 'roster:setup');
  const body = { id: task.id, version: task.readState.version, source: 'local' };
  assert.equal((await post(null, body)).status, 401);
  assert.equal((await post(staff, body)).status, 403);
  assert.equal((await post(admin, body, true)).status, 403);
  assert.equal((await post(admin, { ...body, userId: executive.id })).status, 400);
  assert.equal((await post(admin, { ...body, version: '0'.repeat(64) })).status, 409);
  assert.equal((await post(admin, body)).status, 200);
  assert.ok((await (await get(admin)).json()).tasks.find((t: HelpTask) => t.id === task.id).readState.at);
  assert.equal((await (await get(admin, true)).json()).tasks.find((t: HelpTask) => t.id === task.id).readState, undefined);
  assert.equal((await (await get(executive)).json()).tasks.find((t: HelpTask) => t.id === task.id).readState.at, undefined);
  const activities = emptyActivities();activities.roster = { revision: 1, records: [], bindings: {} } as any;writeData('member-activities.json', activities);
  assert.ok(!(await (await get(admin)).json()).tasks.some((t: HelpTask) => t.id === task.id));
  assert.equal((await (await post(admin, body)).json()).completed, true);
});

test('search matches natural intent, kana and exact aliases, with no invented candidate', () => {
  const entries = helpCatalog(member);
  assert.equal(searchHelp(entries, '写真展に出展したい')[0].id, 'exhibition-submit');
  assert.equal(searchHelp(entries, '作品を出す')[0].id, 'exhibition-submit');
  assert.equal(normalizeHelpQuery('Ｐｏｒｔｆｏｌｉｏ　ポートフォリオ'), 'portfolioぽーとふぉりお');
  assert.equal(searchHelp(entries, 'zxq90876').length, 0);
  assert.ok(!searchHelp(entries, '写真展に出展したい').some(g => g.id === 'contact'));
  assert.ok(searchHelp(entries, '写真').length <= 5);
});
test('page guides describe the current list or editor without inventing unrelated controls', () => {
  assert.deepEqual(pageHelp('/Gallery', member).steps.map(s => s.id), ['overview', 'album', 'photo', 'information']);
  assert.ok(!pageHelp('/Portfolio', member).steps.some(s => s.text.includes('共有')));
  assert.equal(searchHelp(helpCatalog(), '卒業生の作品')[0]?.id, 'portfolio-alumni');
  assert.ok(pageHelp('/Portfolio').steps.some(s => s.id === 'alumni'));
  assert.equal(pageHelp('/Admin/accounts/member', admin).steps[1].id, 'review');
  assert.equal(pageHelp('/Admin/accounts', admin).steps[1].target, '#account-query');
  assert.ok(pageHelp('/Member/manage/exhibitions', staff).steps.every(s => !s.target?.includes('#exhibition-admin')));
  assert.ok(pageHelp('/Member/manage/exhibitions/example/form', staff).steps.some(s => s.target === '[data-save-schema]'));
  assert.ok(pageHelp('/Member/manage/exhibitions/example/layout', staff).steps.some(s => s.id === 'editor'));
  assert.ok(!pageHelp('/Member/manage/exhibitions/example/layout', staff).steps.some(s => s.target?.includes('data-setting')));
  assert.equal(pageHelp('/unregistered', member).steps.length, 1);
  const photos = helpGuide('photo-details', '/Gallery', member);
  assert.equal(photos.steps[0].id, 'album');
  assert.equal(photos.steps[1].path, '/Gallery/*');
  assert.equal(photos.steps[2].target, '#photo-dialog [data-photo-toggle]');
});
test('new Portfolio and Gallery guides resolve the current page and enforce role requirements', () => {
  assert.equal(searchHelp(helpCatalog(admin), '役職の決定')[0]?.id, 'portfolio-office');
  assert.equal(searchHelp(helpCatalog(member), '本をPortfolioに載せたい')[0]?.id, 'portfolio-book-edit');
  assert.equal(searchHelp(helpCatalog(member), 'Portfolioで組写真を作りたい')[0]?.id, 'portfolio-series-edit');
  assert.ok(!helpCatalog(executive).some(guide => guide.id === 'portfolio-office'));
  assert.throws(() => helpGuide('portfolio-office', '/Admin/accounts/member', executive));
  assert.equal(helpGuide('portfolio-office', '/Admin/accounts/member', admin).steps[1].target, '#portfolio-office-select');
  assert.ok(helpGuide('portfolio-office', '/', admin).steps.some(step => step.path === '/Admin/accounts/*'));
  assert.equal(helpGuide('portfolio-book-view', '/Portfolio/member').steps[0].path, '/Portfolio/member');
  assert.equal(helpGuide('photo-series-view', '/Gallery/example').steps[1].target, '[data-photo-series-frame]');
  assert.throws(() => helpGuide('gallery-exclusions', '/Gallery/example', member));
  assert.ok(pageHelp('/Gallery/example', staff).steps.some(step => step.details?.includes('gallery-exclusions')));
  assert.ok(!pageHelp('/Gallery/example', member).steps.some(step => step.details?.includes('gallery-exclusions')));
  assert.throws(() => helpGuide('gallery-film', '/Gallery/example', staff));
});
test('arrows point at target edges and avoid the banner and viewport boundaries', () => {
  const view = { left: 8, top: 68, right: 382, bottom: 732 };
  const target = { left: 20, top: 210, right: 365, bottom: 254 };
  const banner = { left: 12, top: 450, right: 378, bottom: 724 };
  const above = placeHelpArrow(target, view, [banner])!;
  assert.equal(above.tip.y, target.top - 6);
  assert.ok(above.tip.x >= target.left && above.tip.x <= target.right);
  assert.ok(!overlaps({ ...above, right: above.left + 44, bottom: above.top + 44 }, banner));
  const high = { ...target, top: 70, bottom: 110 };
  assert.equal(placeHelpArrow(high, view, [banner])?.rotation, 180);
  assert.equal(placeHelpArrow(target, view, [view]), undefined);
});
test('catalog and direct guide reads enforce all role levels', () => {
  assert.ok(!helpCatalog().some(g => g.minimum === 'staff' || g.minimum === 'executive' || g.minimum === 'admin'));
  assert.ok(!helpCatalog(member).some(g => g.minimum === 'staff' || g.minimum === 'executive' || g.minimum === 'admin'));
  assert.ok(helpCatalog(staff).some(g => g.id === 'tools-manage'));
  assert.ok(!helpCatalog(staff).some(g => g.id === 'accounting'));
  assert.ok(helpCatalog(executive).some(g => g.id === 'accounting'));
  assert.ok(!helpCatalog(executive).some(g => g.id === 'content-edit'));
  assert.ok(helpCatalog(admin).some(g => g.id === 'content-edit'));
  assert.throws(() => helpGuide('content-edit', '/Admin/content/home', staff));
  assert.throws(() => helpGuide('account-approve', '/', member, pending.id));
  assert.equal(pageHelp('/Login?next=secret', null).steps[0].path, '/Login');
  assert.equal(pageHelp('//evil.invalid', null).steps[0].path, '/');
});
test('new management guides use the actual exhibition screen and enforce role permissions', () => {
  const id = crypto.randomUUID();
  writeData('exhibitions.json', { version: 1, exhibitions: [{ id, title: '新機能', status: 'draft', rooms: [], schemas: [{ version: 1, sections: [], fields: [] }] }], submissions: [], assets: [] });
  for (const [guide, view, target] of [
    ['exhibition-shift-manage', 'shifts', '[data-schedule] [name="startDate"]'],
    ['exhibition-shift-copy', 'shifts', '[data-action="review"]'],
    ['exhibition-shift-replace', 'shifts', '[data-replace]'],
    ['layout-locate', 'layout', '[data-layout-tab="works"]'],
    ['exhibition-boards', 'submissions', '.board-manager [data-bm-search], [data-manage-boards]'],
    ['exhibition-lightroom', '', '.exhibition-album-picker [data-album-search], [data-lightroom-create]'],
  ]) {
    assert.ok(helpGuide(guide, '/', staff).choices?.some(c => c.id === id));
    const g = helpGuide(guide, '/', staff, id);
    assert.equal(g.steps[0].target, target);
    assert.ok(g.steps.every(s => s.path === `/Member/manage/exhibitions/${id}${view ? '/' + view : ''}`));
    assert.throws(() => helpGuide(guide, '/', member, id));
  }
  assert.equal(pageHelp(`/Member/manage/exhibitions/${id}/shifts`, staff).id, 'exhibition-shift-manage');
  assert.equal(helpGuide('layout-basic', `/Member/manage/exhibitions/${id}/shifts`, staff).steps[0].path, `/Member/manage/exhibitions/${id}/layout`);
  assert.equal(searchHelp(helpCatalog(staff), 'シフトを画像で共有したい')[0]?.id, 'exhibition-shift-copy');
  assert.equal(searchHelp(helpCatalog(staff), 'シフトを差し替え')[0]?.id, 'exhibition-shift-replace');
  assert.ok(!searchHelp(helpCatalog(member), 'シフトを画像で共有したい').some(g => g.id === 'exhibition-shift-copy'));
  assert.equal(searchHelp(helpCatalog(member), '撮影NG')[0]?.id, 'exhibition-photography');
  assert.throws(() => helpGuide('exhibition-photography', `/Exhibition/${id}`));
  assert.ok(helpCatalog(admin).some(g => g.id === 'admin-view'));
  assert.ok(helpCatalog(staff).some(g => g.id === 'admin-view'));
  assert.ok(!helpCatalog(staff).some(g => g.id === 'admin-login'));
  assert.equal(helpGuide('admin-login', '/', admin, member.id).steps.find(s => s.id === 'login')?.target, '[data-admin-view-account]');
  assert.throws(() => helpGuide('admin-login', '/', staff, member.id));
});
test('dedicated and legacy site managers have management tasks instead of personal votes', () => {
  const data = emptyActivities();
  data.events.push({ id: 'vote', revision: 1, status: 'published', title: '参加投票', deadline: '2030-01-01', recipientIds: [admin.id], votes: {}, groupHistory: [] } as any);
  writeData('member-activities.json', data);
  for (const manager of [{ ...admin, siteManagement: true as const }, { ...admin, portfolioId: 'w_rozcjvv' }]) {
    const result = localHelpTasks(manager, now);
    assert.ok(result.tasks.length > 0);
    assert.ok(result.tasks.every(t => t.group === 'management'));
    assert.ok(!result.tasks.some(t => t.guideId === 'event-vote'));
    assert.ok(result.tasks.some(t => t.id === 'roster:setup'));
    assert.ok(result.tasks.some(t => t.id === `approval:${pending.id}`));
  }
  assert.ok(localHelpTasks(admin, now).tasks.some(t => t.guideId === 'event-vote'));
});
test('roster tasks ignore dedicated accounts, resolve saved bindings and suppress superseded errors', () => {
  const manager: User = { ...admin, siteManagement: true };
  writeData('users.json', [manager, member]);
  const data = emptyActivities();
  data.roster = { revision: 1, spreadsheetId: 'sheet', sheetId: 0, title: '名簿', sheetTitle: '名簿', fetchedAt: at, fetchedBy: admin.id, bindings: {}, records: [{ key: 'one', name: member.name, university: '大学', grade: '1', gender: 'undisclosed', active: true }] };
  writeData('member-activities.json', data);
  assert.equal(localHelpTasks(manager, now).tasks.find(t => t.id === 'roster:bindings')?.title, '名簿とアカウントの未連携を確認（1件）');
  data.roster.bindings[member.id] = 'one';
  data.rosterPortfolioUpdates = [{ id: 'old', portfolioId: 'p', status: 'error' }, { id: 'new', portfolioId: 'p', status: 'done' }] as any;
  writeData('member-activities.json', data);
  assert.ok(!localHelpTasks(manager, now).tasks.some(t => t.id === 'roster:bindings' || t.id === 'roster:portfolio'));
  data.roster.records[0].identityUncertain = true;
  data.rosterPortfolioUpdates![1].status = 'error';
  writeData('member-activities.json', data);
  const tasks = localHelpTasks(manager, now).tasks;
  assert.ok(tasks.some(t => t.id === 'roster:review'));
  assert.ok(tasks.some(t => t.id === 'roster:portfolio'));
  assert.ok(!localHelpTasks(staff, now).tasks.some(t => t.id.startsWith('roster:')));
});
test('approval initialization still needs attention when mail succeeded but setup is pending', () => {
  writeData('users.json', [admin, { ...member, approvalReviewAction: 'approve', approvalNotifiedAt: at, approvalSetup: { rosterStatus: 'pending' } }]);
  assert.ok(localHelpTasks(admin, now).tasks.some(t => t.id === `approval-followup:${member.id}`));
});
test('empty roster data guides unresolved accounts to roster loading before linking', () => {
  const data = emptyActivities();data.roster = { revision: 1, spreadsheetId: 'sheet', sheetId: 0, title: '名簿', sheetTitle: '名簿', fetchedAt: at, fetchedBy: admin.id, bindings: {}, records: [] };
  writeData('member-activities.json', data);
  assert.equal(localHelpTasks(admin, now).tasks.find(t => t.id === 'roster:bindings')?.guideId, 'roster');
});
test('event tasks are recipient-specific and disappear at the exact deadline or after saving', () => {
  const data = emptyActivities();
  const event = { id: 'event', revision: 1, status: 'published' as const, title: '撮影会', category: 'other' as const, description: '', startsAt: '2026-11-06T00:00:00Z', endsAt: '2026-11-06T01:00:00Z', meeting: '', itinerary: '', fee: '', deadline: '2026-11-05T00:00:00Z', theme: '', ownerId: 'staff', ownerName: '運営', recipientIds: [member.id], createdAt: at, updatedAt: at, votes: {}, rules: defaultRules(), groupHistory: [] };
  data.events.push(event); writeData('member-activities.json', data);
  assert.equal(localHelpTasks(member, now).tasks.length, 1);
  assert.equal(localHelpTasks(staff, now).tasks.length, 0);
  assert.equal(localHelpTasks(member, Date.parse(event.deadline)).tasks.length, 0);
  data.events[0].votes[member.id] = { value: 'attending', actorId: member.id, at };
  writeData('member-activities.json', data);
  assert.equal(localHelpTasks(member, now).tasks.length, 0);
  assert.ok(localHelpTasks(member, now).completed.includes('event-vote:event'));
});
test('formal submission, not a saved draft, completes the exhibition task', () => {
  const id = crypto.randomUUID();
  const exhibition = { id, title: '写真展', status: 'open', opensAt: '2026-11-01T00:00:00Z', closesAt: '2026-11-10T00:00:00Z', participation: { state: 'published', opensAt: '2026-10-01T00:00:00Z', closesAt: '2026-10-31T00:00:00Z', recipientIds: [member.id], votes: { member: { value: 'attending', at, actorId: member.id } } }, schemas: [{ version: 1, sections: [], fields: [] }], rooms: [] };
  const draft = { id: crypto.randomUUID(), exhibitionId: id, userId: member.id, versions: [], inactive: false };
  const data: any = { version: 1, exhibitions: [exhibition], submissions: [draft], assets: [], outputs: [] };
  writeData('exhibitions.json', data);
  assert.ok(localHelpTasks(member, now).tasks.some(t => t.id === `exhibition-submit:${id}`));
  assert.ok(localHelpTasks(member, now).completed.includes(`exhibition-start:${id}`));
  data.submissions[0].versions.push({ version: 1 }); writeData('exhibitions.json', data);
  assert.ok(!localHelpTasks(member, now).tasks.some(t => t.id === `exhibition-submit:${id}`));
  const guide = helpGuide('exhibition-submit', '/', member, id);
  assert.equal(guide.steps.find(s => s.id === 'identity')?.target, '[data-common="name"]');
  const vote = helpGuide('exhibition-vote', '/', member, id);
  for (const response of ['attending', 'absent', 'undecided']) {
    assert.ok(vote.steps.find(step => step.id === response)?.target?.includes(`[data-exhibition-answer="${response}"]`));
  }
  assert.ok(guide.steps.some(s => s.path === `/Exhibition/${id}`));
  assert.ok(pageHelp(`/Member/exhibitions/${id}`, member).steps.every(s => s.path === `/Member/exhibitions/${id}`));
  assert.throws(() => helpGuide('exhibition-submit', '/', staff, id));
});
test('optional boxes and new/revoked tool choices are distinguished from completed answers', () => {
  const id = crypto.randomUUID();
  const tool: any = { version: 1, id, kind: 'box', question: 'ご意見', status: 'published', closed: false, creatorId: staff.id, creatorRole: 'staff', recipientIds: [member.id], responses: [], options: [], assets: [], settings: defaultToolSettings(), publication: defaultToolPublication('box') };
  writeData('member-tools-index.json', { version: 1, ids: [id] }); writeData(`member-tool-${id}.json`, tool);
  assert.ok(localHelpTasks(member, now).tasks.find(t => t.entityId === id)?.optional);
  assert.equal(helpGuide('tool-answer', '/', member, id).steps.find(s => s.id === 'answer')?.target, '[data-tool-answer] textarea');
  tool.responses = [{ id: crypto.randomUUID(), userId: member.id, choices: [], dates: {}, body: '意見', assetIds: [] }]; writeData(`member-tool-${id}.json`, tool);
  assert.ok(!localHelpTasks(member, now).tasks.some(t => t.entityId === id));
  tool.kind = 'poll'; tool.responses[0].choices = ['removed']; writeData(`member-tool-${id}.json`, tool);
  assert.ok(localHelpTasks(member, now).tasks.some(t => t.entityId === id));
  tool.status = 'draft'; writeData(`member-tool-${id}.json`, tool);
  assert.ok(!localHelpTasks(member, now).tasks.some(t => t.entityId === id));
});
test('shared management queue excludes rejected, protected and self-deletion targets', () => {
  const rejected: User = { ...pending, id: 'rejected', approvalReviewedAt: at, approvalReviewAction: 'reject' };
  const protectedPending: User = { ...pending, id: 'protected', role: 'executive' };
  writeData('users.json', [member, staff, executive, admin, pending, rejected, protectedPending]);
  writeData('account-deletion-requests.json', { version: 1, requests: [{ id: 'delete-me', userId: executive.id, name: '本人', status: 'pending', dueAt: now - 1 }, { id: 'delete-member', userId: member.id, name: '会員', status: 'pending', dueAt: now - 1 }], challenges: {}, limits: {} });
  const tasks = localHelpTasks(executive, now).tasks;
  assert.ok(tasks.some(t => t.id === 'approval:pending'));
  assert.ok(!tasks.some(t => t.entityId === 'protected' || t.entityId === 'rejected' || t.entityId === 'delete-me'));
  assert.ok(tasks.some(t => t.id === 'deletion:delete-member' && Date.parse(t.dueAt!) < now));
  assert.ok(localHelpTasks(admin, now).tasks.some(t => t.id === 'approval:protected'));
  assert.equal(localHelpTasks(staff, now).tasks.length, 0);
});
test('site approval refuses staff, protected targets and changed registration before mutation', async () => {
  for (const actor of [member, staff]) await assert.rejects(approveRegistration(actor.id, pending.id, accountRevision(pending)), /権限/);
  await assert.rejects(approveRegistration(admin.id, pending.id, 'a'.repeat(64)), /更新/);
  writeData('users.json', [admin, executive, { ...pending, role: 'executive' }]);
  await assert.rejects(approveRegistration(executive.id, pending.id, accountRevision({ ...pending, role: 'executive' })), /権限/);
});
test('signed approval and site approval share the same serialized transition and notification guard', async () => {
  // Use a supplied synthetic mail transport; no real recipient is contacted.
  let messages = 0;
  const send = async () => { messages++; };
  await Promise.all([applyAccountReview(pending.id, 'approve', send, { id: admin.id, revision: accountRevision(pending) }), applyAccountReview(pending.id, 'approve', send)]);
  assert.equal(messages, 1);
  const users = JSON.parse(fs.readFileSync(path.join(directory, 'users.json'), 'utf8'));
  assert.equal(users.find((u: User) => u.id === pending.id).approved, true);
  assert.equal(users.find((u: User) => u.id === pending.id).authVersion, 1);
});
test('closed exhibitions explain the restriction without navigating to an unusable form', () => {
  const id = crypto.randomUUID();
  writeData('exhibitions.json', { version: 1, exhibitions: [{ id, title: '受付終了', status: 'closed', opensAt: '2020-01-01T00:00:00Z', closesAt: '2020-02-01T00:00:00Z', schemas: [{ version: 1 }], rooms: [], participation: { state: 'published', opensAt: '2019-01-01T00:00:00Z', closesAt: '2019-02-01T00:00:00Z', recipientIds: [member.id], votes: { member: { value: 'absent' } } } }], submissions: [], assets: [] });
  const guide = helpGuide('exhibition-submit', '/', member, id);
  assert.ok(guide.steps.every(s => !s.path.startsWith('/Exhibition/')));
  assert.ok(guide.steps.at(-1)!.text.includes('運営'));
  assert.ok(pageHelp(`/Exhibition/${id}`, member).steps.length > 0);
});
test('detailed tool publication only offers objects whose results the actor can manage', () => {
  const id = crypto.randomUUID();
  writeData('member-tools-index.json', { version: 1, ids: [id] });
  writeData(`member-tool-${id}.json`, { version: 1, id, kind: 'poll', question: '幹部の質問', status: 'published', closed: false, creatorId: executive.id, creatorRole: 'executive', recipientIds: [member.id], responses: [], options: [], assets: [], settings: defaultToolSettings(), publication: defaultToolPublication('poll') });
  assert.equal(helpGuide('tool-publication', '/', staff).choices?.length, 0);
  assert.throws(() => helpGuide('tool-publication', `/Member/manage/tools/${id}`, staff));
  assert.equal(helpGuide('tool-publication', '/', executive).choices?.length, 1);
  assert.ok(helpGuide('tool-publication', '/', executive, id).steps.length > 0);
});
test('approval retries cannot reactivate a stopped account or override an active deletion request', async () => {
  const stopped: User = { ...pending, approvalReviewedAt: at, approvalReviewAction: 'approve' };
  writeData('users.json', [admin, stopped]);
  await assert.rejects(approveRegistration(admin.id, stopped.id, accountRevision(stopped)), /処理済み/);
  writeData('users.json', [admin, pending]);
  writeData('account-deletion-requests.json', { version: 1, requests: [{ id: 'withdrawal', userId: pending.id, status: 'pending', dueAt: now + 1000 }], challenges: {}, limits: {} });
  await assert.rejects(approveRegistration(admin.id, pending.id, accountRevision(pending)), /処理済み/);
  assert.ok(!localHelpTasks(admin, now).tasks.some(t => t.id === `approval:${pending.id}`));
});
test('approval follow-up guides do not skip the required retry as an already approved registration', () => {
  writeData('users.json', [admin, { ...pending, approved: true, approvalReviewedAt: at, approvalReviewAction: 'approve' }]);
  const guide = helpGuide('account-approve', '/', admin, pending.id);
  assert.equal(guide.steps.find(s => s.id === 'review')?.complete, undefined);
  assert.ok(guide.steps.find(s => s.id === 'review')?.title.includes('再確認'));
});

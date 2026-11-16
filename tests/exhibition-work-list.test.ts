import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeData } from '../src/lib/store.ts';
import { emptyActivities } from '../src/lib/activityTypes.ts';
import { emptySubmission, type LayoutWork } from '../src/lib/exhibitionTypes.ts';
import { exhibitionAction, readExhibitions } from '../src/lib/exhibitions.ts';
import { tagLayoutWork, readLayoutSnapshot, joinLayout, acquireLayoutLeases, commitLayoutOperation } from '../src/lib/exhibitionCollaboration.ts';
import { diffLayoutRooms } from '../src/lib/exhibitionLayoutChanges.ts';
import { visibleLayoutWorks, workListColors, layoutWorkLocations } from '../src/lib/exhibitionWorkList.ts';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scharade-work-list-'));
beforeEach(() => {
  process.env.DATA_DIR = directory;
  writeData('users.json', ['one', 'two', 'member'].map(id => ({ id, name: id, role: id === 'member' ? 'member' : 'staff', approved: true, email: `${id}@example.invalid`, createdAt: new Date().toISOString() })));
  writeData('exhibitions.json', { version: 1, exhibitions: [], submissions: [], assets: [] });
  writeData('member-activities.json', emptyActivities());
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
async function fixture() {
  const exhibition = (await exhibitionAction('one', { action: 'create', title: '作品一覧検証' })).exhibition;
  const works: LayoutWork[] = Array.from({ length: 9 }, (_, i) => ({ id: crypto.randomUUID(), sectionId: exhibition.schemas[0].sections[0].id, kind: 'single', title: `作品${i}`, caption: '', location: '', equipment: '', settings: '', fields: {}, photos: [] }));
  const content = { ...emptySubmission(), name: '提出者', authorName: '作者', works };
  const data = readExhibitions();
  data.submissions.push({ id: crypto.randomUUID(), exhibitionId: exhibition.id, userId: 'member', tokenHash: '', createdAt: '', updatedAt: '', revision: 1, schemaVersion: 1, draft: structuredClone(content), versions: [{ version: 1, at: '', schemaVersion: 1, content, delivery: 'delivered', attempts: 0, nextAttemptAt: 0 }] });
  data.exhibitions[0].rooms = [{ id: crypto.randomUUID(), name: '室', vertices: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }], wallHeights: [3000, 3000, 3000, 3000], openings: [], placements: [], books: [], tables: [{ id: crypto.randomUUID(), name: '台', x: 1000, y: 1000, width: 1000, depth: 600, rotation: 0 }] }];
  writeData('exhibitions.json', data);
  return { id: exhibition.id, works };
}

test('placement lookup finds walls, both sides of board groups and books across rooms without changing layout',async()=>{
 const f=await fixture(),room=readExhibitions().exhibitions[0].rooms[0],second=structuredClone(room);
 second.id='second';second.name='第二展示室';second.placements=[{workId:f.works[0].id,wall:1,x:100,bottom:1000,rotation:0}];
 second.boardGroups=[{id:'board',name:'展示ボード',x:1000,y:1000,rotation:0,panels:[{id:'panel',name:'1',width:900,height:2000,thickness:30,hingeAngle:0}]}];
 second.boardPlacements=[{workId:f.works[1].id,groupId:'board',face:'B',x:100,bottom:1000,rotation:0}];
 second.books=[{workId:f.works[2].id,tableId:second.tables[0].id,x:0,y:0,width:100,depth:100,rotation:0}];
 const rooms=[room,second],before=structuredClone(rooms);
 assert.deepEqual(layoutWorkLocations(rooms,f.works[0].id),[{roomIndex:1,view:'wall:1',label:'第二展示室 / 壁2',objectId:`work:${f.works[0].id}`}]);
 assert.equal(layoutWorkLocations(rooms,f.works[1].id)[0].label,'第二展示室 / 展示ボード・B面');
 assert.equal(layoutWorkLocations(rooms,f.works[2].id)[0].view,'floor');assert.equal(layoutWorkLocations(rooms,'absent').length,0);assert.deepEqual(rooms,before);
});

test('color order is stable; title, author, submitter and LINE searches accept fullwidth and case differences', () => {
  const works = Array.from({ length: 9 }, (_, index) => ({ id: String(index), title: index === 0 ? '海のＡＢＣ' : '別作品', exhibitorName: '作者', submissionName: '提出者', lineName: 'LINE_Name', listTag: index < 7 ? workListColors[6 - index].id : undefined })) as LayoutWork[];
  assert.deepEqual(visibleLayoutWorks(works, '').map(w => w.id), ['6', '5', '4', '3', '2', '1', '0', '7', '8']);
  assert.equal(visibleLayoutWorks(works, '海 abc')[0].id, '0');
  for (const query of ['作者', '提出者', 'ｌｉｎｅ_name', '別 作者']) assert.ok(visibleLayoutWorks(works, query).length > 0);
  assert.equal(visibleLayoutWorks(works, '存在しない').length, 0);
});

test('concurrent colors merge and persist separately from layout history and submitted content; stale changes cannot overwrite a tag', async () => {
  const f = await fixture(), before = readExhibitions();
  await Promise.all([tagLayoutWork('one', f.id, { workId: f.works[0].id, color: 'red', before: null }), tagLayoutWork('two', f.id, { workId: f.works[1].id, color: 'blue', before: null })]);
  const data = readExhibitions(), e = data.exhibitions[0];
  assert.equal(e.workListTags?.[f.works[0].id], 'red'); assert.equal(e.workListTags?.[f.works[1].id], 'blue');
  assert.deepEqual(e.rooms, before.exhibitions[0].rooms); assert.deepEqual(e.layoutHistory, before.exhibitions[0].layoutHistory);
  assert.deepEqual(data.submissions, before.submissions); assert.deepEqual(data.assets, before.assets);
  await assert.rejects(tagLayoutWork('two', f.id, { workId: f.works[0].id, color: 'green', before: null }), (error: any) => error.status === 409);
  await tagLayoutWork('one', f.id, { workId: f.works[0].id, color: null, before: 'red' });
  assert.equal(readLayoutSnapshot('two', f.id).works.find(w => w.id === f.works[0].id)?.listTag, undefined);
});

test('a layout commit based on the previous snapshot keeps colors saved by another operator', async () => {
  const f = await fixture(), clientId = crypto.randomUUID(), initial = await joinLayout('one', f.id, clientId);
  const next = structuredClone(initial.rooms); next[0].tables[0].x += 100;
  const changes = diffLayoutRooms(initial.rooms, next), leases = acquireLayoutLeases('one', f.id, { clientId, keys: [`room:${initial.rooms[0].id}/table:${initial.rooms[0].tables[0].id}`] }).leases;
  await tagLayoutWork('two', f.id, { workId: f.works[0].id, color: 'purple', before: null });
  const result = await commitLayoutOperation('one', f.id, { clientId, operationId: crypto.randomUUID(), changes, leases });
  assert.equal(result.works[0].listTag, 'purple'); assert.equal(result.rooms[0].tables[0].x, 1100);
});

test('only active submitted works and approved staff can receive valid colors', async () => {
  const f = await fixture(), original = JSON.stringify(readExhibitions());
  await assert.rejects(tagLayoutWork('member', f.id, { workId: f.works[0].id, color: 'red', before: null }), (error: any) => error.status === 403);
  await assert.rejects(tagLayoutWork('one', f.id, { workId: f.works[0].id, color: 'url(javascript:bad)', before: null }));
  await assert.rejects(tagLayoutWork('one', f.id, { workId: crypto.randomUUID(), color: 'red', before: null }), (error: any) => error.status === 404);
  assert.equal(JSON.stringify(readExhibitions()), original);
  const data = readExhibitions(); data.submissions[0].inactive = true; writeData('exhibitions.json', data);
  await assert.rejects(tagLayoutWork('one', f.id, { workId: f.works[0].id, color: 'red', before: null }), (error: any) => error.status === 404);
});

test('LINE lookup follows the bound account and refreshes when the roster changes, without matching unrelated names', async () => {
  const f = await fixture(), activities = emptyActivities();
  activities.roster = { records: [{ key: 'bound', name: '同姓同名', lineName: 'Line First', active: true }], bindings: { member: 'bound' } } as any;
  writeData('member-activities.json', activities);
  const first = readLayoutSnapshot('one', f.id); assert.equal(first.works[0].lineName, 'Line First');
  assert.equal(first.works[0].exhibitorName, '作者'); assert.equal(first.works[0].submissionName, '提出者');
  activities.roster!.records[0].lineName = 'Line Updated'; writeData('member-activities.json', activities);
  assert.equal(readLayoutSnapshot('one', f.id).works[0].lineName, 'Line Updated');
  activities.roster!.records[0].active = false; writeData('member-activities.json', activities);
  assert.equal(readLayoutSnapshot('one', f.id).works[0].lineName, '');
});

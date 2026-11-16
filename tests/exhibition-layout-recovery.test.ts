import {test} from 'node:test';import assert from 'node:assert/strict';
import {diffLayoutRooms,applyLayoutChanges} from '../src/lib/exhibitionLayoutChanges.ts';
import {rebaseLayoutChanges} from '../src/lib/exhibitionLayoutRebase.ts';
import {parseRooms} from '../src/lib/exhibitionValidation.ts';
import {layoutScene} from '../src/lib/exhibitionLayoutScene.ts';
import {roomPreview} from '../src/lib/exhibitionRoomPreview.ts';
import type {RoomLayout,LayoutWork} from '../src/lib/exhibitionTypes.ts';
const fixture=():RoomLayout[]=>parseRooms([{id:crypto.randomUUID(),name:'展示室',vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],openings:[],placements:[],books:[],tables:[{id:crypto.randomUUID(),name:'展示台',x:1000,y:1000,width:1000,depth:600,rotation:0}]}]);
test('reconnect merges local-only fields with remote fields and normalization without replacing other people’s changes',()=>{
 const base=fixture(),local=structuredClone(base),remote=structuredClone(base);local[0].tables[0].x=1600;remote[0].tables[0].y=2200;remote[0].tables[0].height=700;
 const changes=diffLayoutRooms(base,local),before=JSON.stringify(remote),merged=rebaseLayoutChanges(remote,changes);assert.equal(merged.rooms[0].tables[0].x,1600);assert.equal(merged.rooms[0].tables[0].y,2200);assert.equal(merged.rooms[0].tables[0].height,700);assert.equal(JSON.stringify(remote),before);
 assert.deepEqual(rebaseLayoutChanges(merged.rooms,changes).changes,[]);
 remote[0].tables[0].x=1800;assert.throws(()=>rebaseLayoutChanges(remote,changes),/同じ項目/);
 const chosen=rebaseLayoutChanges(remote,changes,true);assert.equal(chosen.rooms[0].tables[0].x,1600);assert.equal(chosen.rooms[0].tables[0].y,2200);assert.deepEqual(applyLayoutChanges(remote,chosen.changes),chosen.rooms);
});
test('title and author switches persist independently through collaboration and preview; preview IDs never collide with editor patterns',()=>{
 const base=fixture(),w:LayoutWork={id:crypto.randomUUID(),sectionId:crypto.randomUUID(),kind:'single',title:'タイトル確認',exhibitorName:'作者確認',caption:'',location:'',equipment:'',settings:'',fields:{},photos:[{assetId:'',x:0,y:0,width:300,height:400,rotation:0}]};base[0].placements=[{workId:w.id,wall:0,x:1000,bottom:1000,rotation:0}];
 const next=structuredClone(base);next[0].showWorkTitles=false;const diff=diffLayoutRooms(base,next);assert.equal(diff[0].collection,'showWorkTitles');assert.equal(parseRooms(applyLayoutChanges(base,diff))[0].showWorkTitles,false);
 assert.match(layoutScene(next[0],[w],'floor').svg,/作者確認/);assert.doesNotMatch(layoutScene(next[0],[w],'floor').svg,/タイトル確認<\/tspan>/);
 next[0].showExhibitorNames=false;assert.doesNotMatch(layoutScene(next[0],[w],'floor').svg,/data-label-id="work:/);
 next[0].annotations=[{id:crypto.randomUUID(),kind:'rect',name:'図形',text:'',x:1000,y:2000,width:1000,height:600,rotation:0,fontSize:100,fill:'#aaccdd'}];
 const preview=roomPreview(next[0],[w]),again=roomPreview(next[0],[w]);assert.equal(preview,again);
 const editorIds=new Set([...layoutScene(next[0],[w],'floor').svg.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
 for(const id of [...preview.svg.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]))assert.equal(editorIds.has(id),false);
 next[0].tables[0].x+=100;assert.notEqual(roomPreview(next[0],[w]),preview);
 assert.throws(()=>parseRooms([{...next[0],showWorkTitles:'yes'}]),/表示設定/);
});

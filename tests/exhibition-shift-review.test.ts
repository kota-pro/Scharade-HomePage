import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftReviewReasons} from '../src/lib/exhibitionShiftReview.ts';
import {shiftReviewHtml} from '../src/scripts/exhibitionShiftUi.ts';
import {shiftRecord} from '../src/lib/exhibitionShiftStore.ts';
import type {ShiftGenerationInput} from '../src/lib/exhibitionShiftTypes.ts';
const input:ShiftGenerationInput={slots:[{id:'one',date:'2026-11-05',start:'10:00',end:'11:00',minutes:60,index:0}],people:[{id:'a',name:'会員A'},{id:'b',name:'会員B'}],availability:{a:['one']},rules:{together:[],apart:[]},fixed:[]};
function fixture(){const r=shiftRecord({version:1,records:[]},'exhibition');r.job={id:'job',actorId:'staff',state:'ready',sourceKey:'generated',createdAt:'2026-11-05T00:00:00Z',planRevision:0,input:structuredClone(input)};return r;}
test('review explains answer and membership changes only against the matching generation without mutating it',()=>{
 const r=fixture(),before=JSON.stringify(r),current=structuredClone(input);current.people.pop();current.availability={};
 assert.deepEqual(shiftReviewReasons(r,current,'generated'),['希望回答','対象会員']);assert.equal(JSON.stringify(r),before);assert.deepEqual(shiftReviewReasons(r,current,'another-plan'),[]);
 const reordered=structuredClone(input);reordered.people.reverse();assert.deepEqual(shiftReviewReasons(r,reordered,'generated'),[]);
});
test('published snapshots explain their known differences without guessing an unavailable answer history',()=>{
 const r=fixture();r.published={...r.plan,sourceKey:'published',version:1,at:'2026-11-05T00:00:00Z',actorId:'staff',slots:structuredClone(input.slots),people:structuredClone(input.people),rules:structuredClone(input.rules)};
 const current=structuredClone(input);current.people[0].grade='2年';current.rules.maxTotal=1;current.availability={};
 assert.deepEqual(shiftReviewReasons(r,current,'published'),['割り当て条件','会員の表示情報']);
});
test('review is a status notice, distinguishes unpublished and retained publication, and escapes labels',()=>{
 const state={stale:true,publishedNeedsReview:false,reviewReasons:['希望回答','対象<会員>'],record:{}};
 const html=shiftReviewHtml(state);assert.match(html,/role="status"/);assert.match(html,/シフト表はまだ公開されていません/);assert.match(html,/対象&lt;会員&gt;/);assert.doesNotMatch(html,/class="[^"]*error|エラー番号|公開版は/);
 const published=shiftReviewHtml({...state,record:{published:{}},publishedNeedsReview:true});assert.match(published,/現在の公開版は変更されていません/);assert.match(published,/更新版を公開/);
 const reviewed=shiftReviewHtml({...state,stale:false,publishedNeedsReview:true,record:{published:{}}});assert.match(reviewed,/確認済みの案をまだ公開していません/);assert.doesNotMatch(reviewed,/再確認が必要/);
 assert.equal(shiftReviewHtml({...state,stale:false}),'');
});

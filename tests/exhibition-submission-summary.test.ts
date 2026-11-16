import test from 'node:test';
import assert from 'node:assert/strict';
import {exhibitionSubmissionRows,filterSubmissionRows,summarizeExhibitionSubmissions,submissionGrade} from '../src/lib/exhibitionSubmissionSummary.ts';
const work=(kind:string,sectionId='normal',photos=1)=>({id:crypto.randomUUID(),kind,sectionId,photos:Array.from({length:photos},()=>({assetId:crypto.randomUUID()}))});
const submitted=(id:string,userId:string,grade:string,works:any[],revision=2)=>({id,userId,revision,updatedAt:`2026-10-${20+revision}T00:00:00Z`,content:{name:userId,authorName:userId,grade,works},draft:{name:userId,grade,works:[...works,work('single')]},versions:[{version:1},{version:2}]});
test('submission search includes the current submitted and saved draft work titles, preserving stage filters',()=>{
 const s=submitted('one','author','2年',[{...work('series'),title:'風の通り道 ＡＢＣ'}]);s.draft.works=[{...work('single'),title:'下書きの夕景'}];
 const rows=exhibitionSubmissionRows({submissions:[s]});
 for(const query of ['風の通り道','abc','下書きの夕景'])assert.equal(filterSubmissionRows(rows,query,'submitted').length,1);
 assert.equal(filterSubmissionRows(rows,'風の通り道','draft').length,0);assert.equal(filterSubmissionRows(rows,'ないタイトル','all').length,0);
});
test('review includes attending nonstarters and active drafts while excluding absent nonstarters and archived drafts',()=>{
 const data={exhibition:{participation:{recipientIds:['a','b','c','d'],votes:{a:{value:'attending'},b:{value:'attending'},c:{value:'absent'},d:{value:'attending'}}}},users:[{id:'a',name:'佐藤',lineName:'さとちゃん',grade:'1'},{id:'b',name:'田中',grade:'master'},{id:'d',name:'未入力'}],submissions:[submitted('sa','a','１年生',[work('single')]),{id:'sb',userId:'b',updatedAt:'2026-10-21',revision:1,draft:{name:'田中',grade:'大学院2年生',works:[]},versions:[]},{id:'archived',inactive:true,draft:{name:'古い下書き'},versions:[]}]};
 const rows=exhibitionSubmissionRows(data);assert.equal(rows.length,3);assert.equal(rows.find(r=>r.user?.id==='d')!.stage,'none');assert.equal(rows.find(r=>r.user?.id==='b')!.stage,'draft');assert.equal(rows.find(r=>r.user?.id==='a')!.stage,'submitted');assert.equal(rows.find(r=>r.user?.id==='b')!.grade,'修士・大学院');assert.equal(filterSubmissionRows(rows,'さ と ち ゃ ん','submitted').length,1);assert.equal(filterSubmissionRows(rows,'佐藤','all').length,1);assert.equal(filterSubmissionRows(rows,'田中','none').length,0);
});
test('submitted work and grade statistics use only latest submitted content, excluding edits in drafts and historical duplicates',()=>{
 const a=submitted('latest','a','2年',[work('single'),work('series','special',3),work('book','special',2)],3),old=submitted('old','a','1年',[work('single')],2),b=submitted('b','b','大学院２年生',[work('series','normal',4)]);
 const rows=exhibitionSubmissionRows({users:[],submissions:[old,a,b,{id:'draft',updatedAt:'2026-10-21',revision:1,draft:{name:'入力中',grade:'3年',works:[work('single')]},versions:[]}]});const s=summarizeExhibitionSubmissions(rows);
 assert.equal(s.people,3);assert.equal(s.submitted,2);assert.equal(s.draft,1);assert.equal(s.percent,66.7);assert.equal(s.works,4);assert.equal(s.photos,8);assert.deepEqual(s.kinds,{single:1,series:2,book:1});assert.equal(s.grades.find(g=>g.grade==='2年生')!.works,3);assert.equal(s.grades.find(g=>g.grade==='修士・大学院')!.works,1);assert.equal(s.sections.find(g=>g.id==='special')!.total,2);assert.equal(rows.find(r=>r.user===undefined&&r.name==='a')!.submission!.id,'latest');
});
test('empty totals and no submissions produce finite zero percentages and preserve unbound imported submissions',()=>{
 const s=summarizeExhibitionSubmissions([]);assert.equal(s.percent,0);assert.equal(s.works,0);assert.deepEqual(s.grades,[]);
 const rows=exhibitionSubmissionRows({submissions:[submitted('import1','','1年',[work('single')]),submitted('import2','','2年',[work('book')])],users:[]});assert.equal(rows.length,2);assert.equal(summarizeExhibitionSubmissions(rows).works,2);
});
test('grade normalization recognizes undergraduate, postgraduate, roster and unknown values',()=>{
 for(const value of ['１年生','大学一年生','1st Grade'])assert.equal(submissionGrade(value),'1年生');
 for(const value of ['大学院２年生','修士1年','M2','master'])assert.equal(submissionGrade(value),'修士・大学院');
 for(const value of ['博士3年','D2','doctorate'])assert.equal(submissionGrade(value),'博士');
 assert.equal(submissionGrade('','3'),'3年生');assert.equal(submissionGrade(''),'学年未設定');assert.equal(submissionGrade('卒業生'),'OB・OG');
});

test('notes count people with current submitted notes once, separating draft-only and unsubmitted changes',()=>{
 const a=submitted('sa','a','2年',[work('single'),work('book')]),old=submitted('old','a','1年',[work('single')],1);Object.assign(a.content,{notes:'提出した備考'});Object.assign(a.draft,{notes:'未提出の変更'});Object.assign(old.content,{notes:'古い備考'});
 const b=submitted('sb','b','3年',[work('book')]);Object.assign(b.draft,{notes:'提出後に追記'});
 const draft={id:'draft',updatedAt:'2026-10-25',revision:1,draft:{name:'下書き',notes:'保存中',works:[]},versions:[]};
 const rows=exhibitionSubmissionRows({submissions:[old,a,b,draft]});assert.equal(summarizeExhibitionSubmissions(rows).notes,1);assert.equal(rows.find(r=>r.id==='user:a')!.notesCount,1);assert.equal(rows.find(r=>r.id==='user:a')!.hasUnsubmittedNotes,true);assert.equal(rows.find(r=>r.id==='user:b')!.notesCount,0);assert.equal(rows.find(r=>r.id==='user:b')!.hasUnsubmittedNotes,true);assert.equal(rows.find(r=>r.id==='submission:draft')!.notesCount,1);
});

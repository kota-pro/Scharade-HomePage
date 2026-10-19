import { signedEnvelope } from "../src/lib/signedEnvelope.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

class Sheet {
  rows: unknown[][]; readonly: boolean; id: number;
  constructor(rows: unknown[][], readonly=false,id=0){this.rows=structuredClone(rows);this.readonly=readonly;this.id=id;}
  getLastRow(){return this.rows.length;}
  getMaxRows(){return 10000;}
  getMaxColumns(){return 28;}
  getLastColumn(){return Math.max(...this.rows.map(r=>r.length));}
  getSheetId(){return this.id;}
  appendRow(row:unknown[]){if(this.readonly)throw new Error('ROSTER_WRITE');this.rows.push(row);}
  getRange(a:number|string,b=1,h=1,w=1):any {
    if(typeof a==='string'){const m=a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/)!;const col=(s:string)=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);b=col(m[1]);a=+m[2];h=m[4]?+m[4]-a+1:1;w=m[3]?col(m[3])-b+1:1;}
    const row=a-1,col=b-1;
    const range={getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>this.rows[row+i]?.[col+j]??'')),getDisplayValues:()=>range.getValues().map((r:any[])=>r.map(String)),getValue:()=>this.rows[row]?.[col]??'',getRow:()=>row+1,
      setValues:(values:unknown[][])=>{if(this.readonly)throw new Error('ROSTER_WRITE');assert.equal(values.length,h);for(let i=0;i<h;i++){assert.equal(values[i].length,w);this.rows[row+i]??=[];for(let j=0;j<w;j++)this.rows[row+i][col+j]=values[i][j];}return range;},
      setValue:(value:unknown)=>range.setValues([[value]]),setFormula:(formula:string)=>range.setValue(formula),setFormulas:(values:string[][])=>range.setValues(values),setNumberFormat:()=>range,
      clearContent:()=>range.setValues(Array.from({length:h},()=>Array(w).fill(''))),
      createTextFinder:(value:string)=>({matchEntireCell:()=>({findNext:()=>{const i=range.getValues().findIndex((r:any[])=>r[0]===value);return i<0?null:{getRow:()=>row+i+1};}})})};return range;
  }
}
function harness(intake=false){
  const sheets:Record<string,Sheet>={};const props:Record<string,string>={BOOK_ID:'book',ADMIN_EMAILS:'staff@example.invalid',SPREADSHEET_ID:'book',WEBHOOK_SECRET:'x'.repeat(40)};
  const roster=new Sheet([['回答日時','継続しますか','氏名','ふりがな','LINE名','学年','大学名','学籍番号'],['2026/03/01','はい','同じ名前','フリガナ','LINE','2','大学','001'],['2026/03/02','はい','同じ名前','ベツ','LINE2','2','大学','002']],true,123);
  const book={getId:()=> 'book',getUrl:()=> 'https://docs.google.com/spreadsheets/d/book/edit',getSheetByName:(n:string)=>sheets[n]};
  const ctx:any={console,Date,PropertiesService:{getScriptProperties:()=>({getProperties:()=>({...props}),getProperty:(k:string)=>props[k],setProperty:(k:string,v:string)=>props[k]=v,deleteProperty:(k:string)=>delete props[k]})},
    Session:{getActiveUser:()=>({getEmail:()=> 'staff@example.invalid'})},LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{},hasLock:()=>true})},
    SpreadsheetApp:{openById:(id:string)=>id==='book'?book:{getSheets:()=>[roster]},flush:()=>{}},
    Utilities:{formatDate:()=> '2026-09-30',getUuid:()=>crypto.randomUUID(),Charset:{UTF_8:'UTF_8'},DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_:string,v:string|number[])=>[...crypto.createHash('sha256').update(Array.isArray(v)?Buffer.from(v):v).digest()],base64Decode:(v:string)=>[...Buffer.from(v,'base64')],newBlob:(bytes:number[],mimeType:string,name:string)=>({bytes,mimeType,name}),computeHmacSha256Signature:(v:string,k:string)=>[...crypto.createHmac('sha256',k).update(v).digest()]},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:(v:string)=>({setMimeType:()=>JSON.parse(v)})}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(intake?'gas/intake/Code.gs':'gas/accounting/Core.gs','utf8'),ctx);
  if(!intake)vm.runInContext(fs.readFileSync('gas/accounting/Main.gs','utf8'),ctx);
  for(const n of ['人物対応','取引記録','残高確認記録','名簿確認'])sheets[n]=new Sheet([['記録JSON']]);
  sheets['設定']=new Sheet([[],[],[],[],['会計開始日','2025-11-01'],['銀行開始残高',10000],['現金開始残高',2000],['表示年度（開始年）',2025],['引き継ぎメモ','']]);
  sheets['立替申請']=new Sheet([['申請ID']]);sheets['名簿設定']=new Sheet([[],[],[],[],['2025-11-01','2026-10-31','roster',123,1,'C','D','E','-','F','G','-','H','B','A']]);
  return {ctx,sheets,props,roster};
}
test('signed accounting health confirms v2 without returning financial or member data',()=>{
  const {ctx,props,sheets}=harness(true);
  const envelope=signedEnvelope({action:'health'},props.WEBHOOK_SECRET);
  const reply=ctx.doPost({postData:{contents:JSON.stringify(envelope)}});
  assert.deepEqual(JSON.parse(JSON.stringify(reply)),{ok:true,envelopeVersion:2,accountingSheet:true});
  assert.equal(sheets['立替申請'].rows.length,1);
  assert.equal(ctx.doPost({postData:{contents:JSON.stringify(envelope)}}).code,'REPLAY');
});
test('roster import never writes the original, retains leading-zero IDs and requires manual same-name resolution',()=>{
  const {ctx,sheets,roster}=harness();const original=JSON.stringify(roster.rows);
  ctx.syncRoster_();assert.equal(JSON.stringify(roster.rows),original);
  const members=ctx.jsonRows_('人物対応'),pending=ctx.jsonRows_('名簿確認');assert.equal(members.length,1);assert.equal(members[0].studentId,'001');assert.equal(pending.length,1);
  ctx.resolveRoster_({key:pending[0].record.key,memberId:'new'});assert.equal(ctx.jsonRows_('人物対応').length,2);
  const ids=ctx.jsonRows_('人物対応').map((p:any)=>p.id);ctx.syncRoster_();assert.deepEqual(ctx.jsonRows_('人物対応').map((p:any)=>p.id),ids);assert.equal(ctx.jsonRows_('名簿確認').length,0);assert.equal(JSON.stringify(roster.rows),original);
  assert.equal(sheets['人物対応'].rows.length,3);
});
test('request approval recovers after interrupted status update without booking a second expense',()=>{
  const {ctx,sheets}=harness();ctx.addPerson_({token:crypto.randomUUID(),name:'会員',university:'大学',lineName:'LINE'},'staff@example.invalid');
  const p=ctx.jsonRows_('人物対応')[0];const id='ADV-'+'a'.repeat(32);
  sheets['立替申請'].rows.push([id,'2026-09-01','website-member','表示名','mail@example.invalid','会員','大学','LINE','2026-04-10','備品',3000,'','','未承認','','','','','','','digest']);
  const input={requestId:id,decision:'approve',memberId:p.id,note:''};ctx.reviewRequest_(input,'staff@example.invalid');
  assert.equal(ctx.jsonRows_('取引記録').length,1);assert.equal(sheets['立替申請'].rows[1][13],'承認済み');
  sheets['立替申請'].rows[1][13]='未承認';ctx.reviewRequest_(input,'staff@example.invalid');ctx.reviewRequest_(input,'staff@example.invalid');
  assert.equal(ctx.jsonRows_('取引記録').length,1);assert.equal(ctx.Accounting.build(ctx.readSettings_(),ctx.jsonRows_('取引記録')).expense,3000);
  ctx.Session.getActiveUser=()=>({getEmail:()=> 'outsider@example.invalid'});assert.throws(()=>ctx.accountingAction({action:'bootstrap'}),/会計担当者/);
});
test('signed intake escapes formulas, ignores retry after approval, and rejects tampering and changed payload',()=>{
  const {ctx,sheets,props}=harness(true);
  const p={requestId:'ADV-'+'b'.repeat(32),submittedAt:new Date().toISOString(),websiteUserId:'member',accountName:'display',accountEmail:'member@example.invalid',rosterName:'member',university:'',lineName:'',expenseDate:'2026-04-10',item:'=HYPERLINK("https://example.invalid")',amount:1200,notes:'',receiptUrl:''};
  function envelope(payload:any){return signedEnvelope(payload,props.WEBHOOK_SECRET);}
  const send=(body:any)=>ctx.doPost({postData:{contents:JSON.stringify(body)}});
  const first=envelope(p);assert.equal(send(first).ok,true);assert.equal(send(first).code,'REPLAY');assert.equal(sheets['立替申請'].rows[1][9],"'"+p.item);assert.equal(sheets['立替申請'].rows[1][13],'未承認');
  sheets['立替申請'].rows[1][13]='承認済み';assert.equal(send(envelope(p)).ok,true);assert.equal(sheets['立替申請'].rows.length,2);assert.equal(sheets['立替申請'].rows[1][13],'承認済み');
  assert.equal(send(envelope({...p,amount:9999})).code,'CONFLICT');assert.equal(send({...envelope(p),signature:'bad'}).code,'UNAUTHORIZED');
});
test('reports keep repayment out of expenses and place reconciliation after all transactions of the date',()=>{
  const {ctx,sheets}=harness();for(const n of ['月次集計','銀行通帳','現金出納帳','立替精算'])sheets[n]=new Sheet([[],[],[],[]]);
  const person={token:crypto.randomUUID(),name:'会員',university:'大学',lineName:''};ctx.addPerson_(person,'staff@example.invalid');const memberId=ctx.jsonRows_('人物対応')[0].id;
  const token=crypto.randomUUID();ctx.registerTransaction_({token,type:'advance',date:'2026-04-10',amount:3000,description:'備品',memberId},'staff@example.invalid');
  ctx.registerTransaction_({token:crypto.randomUUID(),type:'refund',date:'2026-05-10',amount:1000,description:'分割返金',account:'bank',advanceId:'TX-'+token,memberId},'staff@example.invalid');
  ctx.registerCheck_({token:crypto.randomUUID(),date:'2026-05-10',account:'bank',actual:9000},'staff@example.invalid');
  ctx.renderReports_();const month=sheets['月次集計'].rows;assert.equal(month[9][2],3000);assert.equal(month[10][2],0);assert.equal(month[10][6],2000);
  const bank=sheets['銀行通帳'].rows;assert.equal(bank[5][1],'返金');assert.equal(bank[6][1],'残高確認');assert.equal(bank[5][6],'=G5+E6-F6');assert.equal(bank[6][8],'=H7-G7');assert.equal(bank[6][7],9000);
});

test('receipt upload reserves one Drive ID, restores an uncertain create and never changes file permissions',()=>{
  const {ctx,props}=harness(true);props.RECEIPT_FOLDER_ID='receiptFolder';
  const files=new Map<string,any>();let creates=0;
  ctx.Drive={Files:{generateIds:()=>({ids:['reservedReceiptId123']}),get:(id:string)=>{if(!files.has(id))throw new Error('404');return files.get(id);},create:(metadata:any,blob:any)=>{creates++;if(files.has(metadata.id))throw new Error('409');const file={...metadata,size:blob.bytes.length};files.set(metadata.id,file);if(creates===1)throw new Error('response lost');return file;}}};
  const send=(p:any)=>ctx.doPost({postData:{contents:JSON.stringify(signedEnvelope(p,props.WEBHOOK_SECRET))}});
  const receiptId='REC-'+'a'.repeat(32);
  assert.equal(send({action:'receipt.prepare',receiptId}).driveFileId,'reservedReceiptId123');
  const bytes=Buffer.from('%PDF-1.4\n%%EOF');
  const p={action:'receipt.upload',receiptId,driveFileId:'reservedReceiptId123',name:'領収書.pdf',mimeType:'application/pdf',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64')};
  assert.equal(send(p).code,'RETRY');assert.equal(files.size,1);
  assert.equal(send(p).url,'https://drive.google.com/file/d/reservedReceiptId123/view');assert.equal(creates,1);
  assert.equal(send({...p,receiptId:'REC-'+'b'.repeat(32)}).code,'CONFLICT');
  assert.equal(send({...p,sha256:'0'.repeat(64)}).code,'INVALID');
  assert.equal(send({...p,mimeType:'text/html'}).code,'INVALID');
  assert.equal(send({...p,size:10*1024*1024+1}).code,'INVALID');
  assert.deepEqual(Array.from(Array.from(files.values())[0].parents),['receiptFolder']);
});

test('refund schema migration preserves legacy rows and refuses occupied columns',()=>{
  const {ctx,sheets,roster}=harness();const old=["ADV-old",...Array(20).fill('existing')];sheets['立替申請'].rows.push(old);
  const before=JSON.stringify(sheets['立替申請'].rows[1]),source=JSON.stringify(roster.rows);
  ctx.initializeRefundFields();ctx.initializeRefundFields();
  assert.equal(JSON.stringify(sheets['立替申請'].rows[1]),before);assert.equal(JSON.stringify(roster.rows),source);
  assert.equal(sheets['立替申請'].rows[0][21],'希望の返金方法');assert.equal(sheets['立替申請'].rows[0][27],'口座番号');
  assert.equal(ctx.requests_()[0].refundMethod,'');
  sheets['立替申請'].rows[0][22]='別の列';assert.throws(()=>ctx.initializeRefundFields(),/中止/);
});

test('signed refund details survive sheets, approval and retry with leading zeroes intact',()=>{
  const {ctx,sheets,props}=harness(true);
  const p={requestId:'ADV-'+'c'.repeat(32),submittedAt:new Date().toISOString(),websiteUserId:'member',accountName:'display',accountEmail:'member@example.invalid',rosterName:'member',university:'',lineName:'',expenseDate:'2026-04-10',item:'備品',amount:1200,notes:'備考は別欄',receiptUrl:'',refundMethod:'bank',bankName:'=架空銀行',bankAccountName:'カクウ タロウ',bankBranchName:'試験支店',bankBranchCode:'001',bankAccountNumber:'0012345'};
  const send=(value:any)=>ctx.doPost({postData:{contents:JSON.stringify(signedEnvelope(value,props.WEBHOOK_SECRET))}});
  assert.equal(send(p).code,'NOT_CONFIGURED');
  ctx.REFUND_HEADERS_.forEach((v:string,i:number)=>sheets['立替申請'].rows[0][21+i]=v);
  assert.equal(send({...p,bankAccountNumber:'12x'}).code,'INVALID');
  assert.equal(send(p).ok,true);assert.equal(send(p).ok,true);assert.equal(sheets['立替申請'].rows.length,2);
  assert.deepEqual(sheets['立替申請'].rows[1].slice(21),['口座振込','',"'=架空銀行",'カクウ タロウ','試験支店','001','0012345']);
  assert.equal(sheets['立替申請'].rows[1][11],'備考は別欄');
  assert.equal(send({...p,bankAccountNumber:'9999999'}).code,'CONFLICT');
  const paypay={...p,requestId:'ADV-'+'d'.repeat(32),refundMethod:'paypay',refundLineName:'=LINEテスト'};
  assert.equal(send(paypay).ok,true);assert.deepEqual(sheets['立替申請'].rows[2].slice(21),['PayPay',"'=LINEテスト",'','','','','']);
  assert.equal(send({...p,requestId:'ADV-'+'e'.repeat(32),refundMethod:'cash'}).ok,true);assert.deepEqual(sheets['立替申請'].rows[3].slice(21),['現金手渡し','','','','','','']);
  const admin=harness();admin.sheets['立替申請'].rows=structuredClone(sheets['立替申請'].rows);
  admin.ctx.addPerson_({token:crypto.randomUUID(),name:'member',university:'',lineName:''},'staff@example.invalid');
  admin.ctx.reviewRequest_({requestId:p.requestId,decision:'approve',memberId:admin.ctx.jsonRows_('人物対応')[0].id,note:''},'staff@example.invalid');
  const read=admin.ctx.requests_()[0];assert.equal(read.status,'承認済み');assert.equal(read.bankAccountNumber,'0012345');assert.equal(read.bankBranchCode,'001');
});

test('signed grouping roster reads administrator-selected sources, returns minimal fields and uses the latest answer',()=>{
  const {ctx,props,roster}=harness(true);
  roster.id=147078796;
  roster.rows=[['タイムスタンプ','継続しますか？','氏名','性別','学年','大学名','学籍番号','LINE名'],
    [new Date('2026-10-01T00:00:00Z'),'はい','会員 A','女','1年生','大学','001','old-line'],
    [new Date('2026-10-02T00:00:00Z'),'いいえ','会員 A','女','1年生','大学','001','line-a'],
    [new Date('2026-10-01T01:00:00Z'),'はい','会員 B','男','2年生','大学','002','line-b']];
  const original=JSON.stringify(roster.rows);let reads=0;
  ctx.SpreadsheetApp.openById=()=>{reads++;return {getName:()=> '継続名簿',getSheets:()=>[{getSheetId:()=>roster.id,getName:()=> 'フォームの回答 1',getLastRow:()=>roster.getLastRow(),getLastColumn:()=>roster.getLastColumn(),getRange:(a:number|string,b=1,h=1,w=1)=>roster.getRange(a,b,h,w)}]};};
  const p={action:'roster.read',spreadsheetId:'1thOhu3AwgGLhP9sGV_wToRy1kyzD_rJbw_bjcQHV8j4',sheetId:147078796};
  const send=(value:any,signature?:string)=>{const envelope=signedEnvelope(value,props.WEBHOOK_SECRET);return ctx.doPost({postData:{contents:JSON.stringify({...envelope,signature:signature??envelope.signature})}});};
  assert.equal(send(p,'bad').code,'UNAUTHORIZED');assert.equal(reads,0);
  assert.equal(send({...p,spreadsheetId:'different'}).code,'INVALID_SOURCE');assert.equal(reads,0);
  const other=send({...p,spreadsheetId:'next-roster-fixture-2027'});assert.equal(other.ok,true);assert.equal(other.spreadsheetId,'next-roster-fixture-2027');
  assert.equal(send({...p,sheetId:-1}).code,'INVALID_SOURCE');
  assert.equal(send({...p,sheetId:999}).code,'INVALID_ROSTER');
  const result=send(p);assert.equal(result.ok,true);assert.equal(result.records.length,2);
  assert.equal(result.records.find((r:any)=>r.name==='会員 A').active,false);
  assert.equal(result.records.find((r:any)=>r.name==='会員 B').active,true);
  assert.deepEqual(Object.keys(result.records[0]).sort(),['active','gender','grade','key','lineName','name','university']);
  assert.equal(result.records.find((r:any)=>r.name==='会員 A').lineName,'line-a');
  assert.equal(JSON.stringify(roster.rows),original);
  roster.rows.reverse();roster.rows.unshift(roster.rows.pop()!); // Sort order must not change the latest answer.
  assert.equal(send(p).records.find((r:any)=>r.name==='会員 A').active,false);
  roster.rows.push([new Date('2026-10-02T00:00:00Z'),'はい','会員 A','女','1年生','大学','001']);
  assert.equal(send(p).ok,false);
});

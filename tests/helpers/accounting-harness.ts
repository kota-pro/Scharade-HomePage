import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
export class Sheet {
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
export function harness(intake=false){
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

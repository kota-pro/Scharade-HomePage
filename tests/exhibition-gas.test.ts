import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";

function harness() {
  const props: Record<string, string> = { WEBHOOK_SECRET: "x".repeat(64) }, journal: any[][] = [["key", "responseId", "image", "at"]], responses: any[] = [];
  let itemSequence = 0, creates = 0, sheets = 0, failJournal = false;
  const items: any[] = [], sheet: any = {
    getLastRow: () => journal.length, appendRow: (row: any[]) => journal.push(row), hideSheet() {},
    getRange: (start: number, column: number, count = 1, width = 1) => ({
      getValues: () => journal.slice(start - 1, start - 1 + count).map(row => row.slice(column - 1, column - 1 + width)),
      setValue: (value: any) => { if (failJournal) { failJournal = false; throw new Error("crash after submit"); } journal[start - 1][column - 1] = value; },
      createTextFinder: (key: string) => ({ matchEntireCell: () => ({ findNext: () => { const row = journal.findIndex(row => row[0] === key); return row < 0 ? null : { getRow: () => row + 1 }; } }) }),
    }),
  };
  const addItem = (title: string) => {
    const item: any = { id: ++itemSequence, title, getId() { return this.id; }, getTitle() { return this.title; }, getType: () => "TEXT", asTextItem() { return this; }, setTitle(value: string) { this.title = value; return this; }, createResponse(value: string) { return { item: this, value }; } };
    items.push(item); return item;
  };
  let destination = "";
  const form: any = {
    getItems: () => items, getDestinationId: () => { if (!destination) throw new Error("no response destination"); return destination; }, setDestination: (_: any, id: string) => destination = id, addTextItem: () => addItem(""),
    getResponses: () => responses,
    createResponse: () => {
      const values: Record<string, string> = {};
      const response: any = { withItemResponse: (r: any) => { values[r.item.id] = r.value; return response; }, submit: () => { const submitted = { getId: () => `response-${responses.length + 1}`, getResponseForItem: (item: any) => values[item.id] === undefined ? null : { getResponse: () => values[item.id] } }; responses.push(submitted); return submitted; } };
      return response;
    },
  };
  const archives: any[][]=[];
  const archiveSheet={getLastRow:()=>archives.length,appendRow:(row:any[])=>archives.push(row),getRange:(start:number,column:number,count=1,width=1)=>({
    setValues:(values:any[][])=>values.forEach((row,i)=>archives[start-1+i]=row),
    createTextFinder:(key:string)=>({matchEntireCell:()=>({findAll:()=>archives.filter(row=>row[0]===key)})})
  })};
  let hasArchive=false;
  const book = { getId: () => "spreadsheet_fixture", getSheetByName: (name:string) => name==='__delivery'?sheet:hasArchive?archiveSheet:null, insertSheet: (name:string) => {if(name==='提出データ'){hasArchive=true;return archiveSheet;}return sheet;} };
  let revision=0,failAfterBatch=false;
  const files:Record<string,any>={form_fixture_123:{},spreadsheet_fixture:{}};
  const ctx: any = {
    console: { log() {} }, Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => props[key], setProperty: (key: string, value: string) => props[key] = value, deleteProperty:(key:string)=>delete props[key],getProperties:()=>({...props}) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "JSON" }, createTextOutput: (value: string) => ({ setMimeType: () => JSON.parse(value) }) },
    Utilities: { Charset: { UTF_8: "utf8" }, DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_:any,value:string)=>[...crypto.createHash('sha256').update(value).digest()],computeHmacSha256Signature: (value: string, secret: string, charset?: string) => [...crypto.createHmac("sha256", secret).update(Buffer.from(value, charset === "utf8" ? "utf8" : "ascii")).digest()] },
    ScriptApp: { getOAuthToken: () => "fixture-token" },
    UrlFetchApp: { fetch: (url: string, options: any) => {
      if (url.includes("/drive/v3/about")) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ user: { emailAddress: "sharadeshashinten@gmail.com" } }) };
      if (url.endsWith("/forms")) { creates++; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ formId: "form_fixture_123" }) }; }
      if (url.endsWith(":batchUpdate")) {
        const batch=JSON.parse(options.payload);assert.equal(batch.writeControl.requiredRevisionId,String(revision));
        batch.requests.forEach((r:any)=>{
          if(r.deleteItem) items.splice(r.deleteItem.location.index,1);
          if(r.moveItem) items.splice(r.moveItem.newLocation.index,0,items.splice(r.moveItem.originalLocation.index,1)[0]);
          if(r.updateItem){const item=items[r.updateItem.location.index];item.title=r.updateItem.item.title;item.question=r.updateItem.item.questionItem.question;}
          if(r.createItem){const item=addItem(r.createItem.item.title);items.pop();item.question=r.createItem.item.questionItem.question;items.splice(r.createItem.location.index,0,item);}
        });revision++;if(failAfterBatch){failAfterBatch=false;throw new Error('lost batch reply');}
        return { getResponseCode: () => 200, getContentText: () => "{}" };
      }
      if (url.endsWith("/forms/form_fixture_123")) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ revisionId:String(revision),linkedSheetId: destination || undefined,items:items.map(item=>({itemId:String(item.id),title:item.title,questionItem:{question:{...item.question,questionId:String(item.id)}}})) }) };
      if(url.includes('/drive/v3/files/')){const fileId=url.split('/files/')[1].split('?')[0],file=files[fileId];if(!file)return {getResponseCode:()=>404,getContentText:()=>"{}"};if(options.method==='patch')Object.assign(file,JSON.parse(options.payload));return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({id:fileId,...file})};}
      return { getResponseCode: () => 404 };
    } },
    FormApp: { openById: () => form, DestinationType: { SPREADSHEET: "SPREADSHEET" }, ItemType: { TEXT: "TEXT" } },
    SpreadsheetApp: { create: () => { sheets++; return book; }, openById: () => book, flush() {} },
    DriveApp: { getRootFolder: () => ({ getId: () => "root" }),getFileById:(id:string)=>({setName:(name:string)=>files[id].name=name,moveTo(){}}) },
  };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync("gas/exhibition/Code.gs", "utf8"), ctx);
  const send = (payload: any, timestamp = String(Date.now()), valid = true) => {
    const nonce = crypto.randomBytes(16).toString("hex"), data = JSON.stringify(payload), signature = crypto.createHmac("sha256", props.WEBHOOK_SECRET).update(`v2\n${timestamp}\n${nonce}\n${data}`).digest("hex");
    return ctx.doPost({ postData: { contents: JSON.stringify({ version: 2, nonce, timestamp, payload: data, signature: valid ? signature : "0".repeat(64) }) } });
  };
  return { ctx, send, props, responses, journal,archives,files,items,crashBatch:()=>{failAfterBatch=true;},crash: () => { failJournal = true; }, counts: () => ({ creates, sheets }) };
}
test("GAS rejects forged and expired signatures without Google-side mutations", () => {
  const h = harness();
  assert.equal(h.send({ action: "form.create" }, String(Date.now()), false).code, "UNAUTHORIZED");
  assert.equal(h.send({ action: "form.create" }, String(Date.now() - 600000)).code, "INVALID");
  assert.deepEqual(h.counts(), { creates: 0, sheets: 0 });
  assert.equal(h.send({ action: "health" }).gatewayVersion, 3);
  assert.equal(h.send({ action: "health", title: "写真展「朝」" }).gatewayVersion, 3);
  assert.equal(h.send({ action: "health" }).yearFolderSuffix, "年");
});

test("GAS uses year-suffixed folders and migrates an existing exhibition once without copying its files", () => {
  const h = harness(), folders = new Map<string, any>();
  let sequence = 0, moves = 0, interrupt = true;
  const create = (name: string, parent?: any): any => {
    const folder: any = {
      id: `folder_${++sequence}`, name, parent, children: [], files: [],
      getId() { return this.id; },
      setName(value: string) { this.name = value; },
      getFoldersByName(value: string) {
        const matches = this.children.filter((f: any) => f.name === value);
        return { hasNext: () => matches.length > 0, next: () => matches.shift() };
      },
      createFolder(value: string) { return create(value, this); },
      moveTo(next: any) {
        if (interrupt) { interrupt = false; throw new Error("interrupted move"); }
        this.parent.children = this.parent.children.filter((f: any) => f !== this);
        this.parent = next; next.children.push(this); moves++;
      },
    };
    parent?.children.push(folder); folders.set(folder.id, folder); return folder;
  };
  const root = create("My Drive"), oldYear = create("2026", root), oldOfficial = create("公式サイト", oldYear);
  const unrelated = create("別用途の資料", oldYear), exhibition = create("秋季写真展", oldOfficial);
  const originals = create("作品データ", exhibition), layouts = create("組写真レイアウト", exhibition), outputs = create("出力資料", exhibition);
  originals.files.push("original-file"); layouts.files.push("layout-file"); outputs.files.push("pdf-file");
  const exhibitionId = crypto.randomUUID();
  const existing = { folderId: exhibition.id, originalsId: originals.id, layoutsId: layouts.id, outputsId: outputs.id, year: 2026, title: "秋季写真展" };
  h.props[`FOLDERS_${exhibitionId}`] = JSON.stringify(existing);
  h.ctx.DriveApp = { getRootFolder: () => root, getFolderById: (id: string) => folders.get(id) };
  const request = { action: "folders.ensure", exhibitionId, year: 2026, exhibitionTitle: "秋季写真展" };
  assert.equal(h.send(request).code, "FAILED");
  assert.equal(JSON.parse(h.props[`FOLDERS_${exhibitionId}`]).yearFolderName, undefined);
  const migrated = h.send(request);
  assert.equal(migrated.ok, true); assert.equal(migrated.yearFolderName, "2026年");
  for (const key of ["folderId", "originalsId", "layoutsId", "outputsId"] as const)
    assert.equal(migrated[key], existing[key]);
  assert.equal(exhibition.parent.name, "公式サイト"); assert.equal(exhibition.parent.parent.name, "2026年");
  assert.equal(unrelated.parent, oldYear);
  assert.deepEqual(originals.files, ["original-file"]); assert.deepEqual(layouts.files, ["layout-file"]); assert.deepEqual(outputs.files, ["pdf-file"]);
  const count = folders.size;
  assert.deepEqual(h.send(request), migrated); assert.equal(folders.size, count); assert.equal(moves, 1);
  const fresh = h.send({ ...request, exhibitionId: crypto.randomUUID(), exhibitionTitle: "新しい写真展" });
  assert.equal(fresh.yearFolderName, "2026年");
  assert.equal(folders.get(fresh.folderId).parent, exhibition.parent);
  assert.equal(root.children.filter((f: any) => f.name === "2026年").length, 1);
});
test("GAS form creation is idempotent and repairs a response journal failure without duplicate answers", () => {
  const h = harness(), request = { action: "form.create", title: "写真展", exhibitionId: crypto.randomUUID(), schemaVersion: 1, fields: [{ id: "title", title: "作品タイトル", paragraph: false, required: true }, { id: "deliveryKey", title: "送信識別子", paragraph: false, required: false }] };
  const form = h.send(request); assert.equal(form.ok, true); assert.deepEqual(h.send(request), form); assert.deepEqual(h.counts(), { creates: 1, sheets: 1 });
  const row = { idempotencyKey: `${crypto.randomUUID()}:1:${crypto.randomUUID()}`, answers: { title: "朝" } };
  const submit = { action: "response.submit", formId: form.formId, itemIds: form.itemIds, rows: [row] };
  h.crash(); assert.equal(h.send(submit).code, "FAILED"); assert.equal(h.responses.length, 1);
  assert.equal(h.send(submit).ok, true); assert.equal(h.responses.length, 1); assert.ok(h.journal[1][1]);
  assert.equal(h.send(submit).ok, true); assert.equal(h.responses.length, 1);
});

test("GAS resumable uploads recover acknowledged chunks, expired sessions and lost completion journals", () => {
  const h = harness(), id = crypto.randomUUID(), sha = "a".repeat(64), bytes = Buffer.alloc(2 * 1024 * 1024, 17);
  const session = "https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture";
  let offset = 0, sessions = 0, expire = false, complete = false;
  h.ctx.Utilities.base64Decode = (value: string) => [...Buffer.from(value, "base64")];
  h.ctx.ensureFolders_ = () => ({ outputsId: "outputs_fixture_123" });
  h.ctx.UrlFetchApp.fetch = (url: string, options: any) => {
    const response = (code: number, data: any = {}, headers: any = {}) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(data), getAllHeaders: () => headers });
    if (url.includes("/drive/v3/about")) return response(200, {user:{emailAddress:"sharadeshashinten@gmail.com"}});
    if (url.includes("/drive/v3/files?q=")) return response(200, {files: complete ? [{id:"drive_file_fixture",webViewLink:"https://drive.google.com/file/d/drive_file_fixture/view",appProperties:{sha256:sha}}] : []});
    if (options.method === "post" && url.includes("uploadType=resumable")) {sessions++; return response(200, {}, {Location:session});}
    if (url === session) {
      if (expire) {expire = false;offset = 0;return response(404);}
      if (typeof options.payload !== "string") {assert.equal(options.headers["Content-Range"], `bytes ${offset}-${offset+options.payload.length-1}/${bytes.length}`);offset += options.payload.length;}
      if (offset === bytes.length) {complete = true;return response(200,{id:"drive_file_fixture",webViewLink:"https://drive.google.com/file/d/drive_file_fixture/view"});}
      return response(308, {}, offset ? {Range:`bytes=0-${offset-1}`} : {});
    }
    throw new Error("unexpected-google-request");
  };
  const begin = {action:"file.begin",key:id,sha256:sha,size:bytes.length,mimeType:"application/pdf",category:"outputs",name:"展示図.pdf",exhibitionId:crypto.randomUUID(),year:2026,exhibitionTitle:"写真展"};
  assert.equal(h.send(begin).offset,0);
  const chunk = {action:"file.chunk",key:id,sha256:sha,offset:0,data:bytes.subarray(0,1024*1024).toString("base64")};
  assert.equal(h.send(chunk).offset,1024*1024);
  assert.equal(h.send(chunk).offset,1024*1024); // Duplicate chunk is acknowledged without appending again.
  expire = true;
  assert.equal(h.send(begin).offset,0);assert.equal(sessions,2);
  assert.equal(h.send(chunk).offset,1024*1024);
  assert.equal(h.send({...chunk,offset:1024*1024}).done,true);
  delete h.props['FILE_'+id]; // Remote file exists even if the local property journal was lost.
  assert.equal(h.send(begin).done,true);assert.equal(sessions,2);
  assert.equal(h.send({...begin,sha256:"b".repeat(64)}).code,"FAILED");
});

test("GAS updates the same form and sheet, preserves question IDs and recovers a lost update reply",()=>{
  const h=harness(),exhibitionId=crypto.randomUUID(),custom=`field:${crypto.randomUUID()}`;
  const request={action:'form.create',exhibitionId,title:'春展',schemaVersion:1,fields:[{id:'title',title:'題名',paragraph:false,required:true},{id:'deliveryKey',title:'送信識別子',paragraph:false,required:false},{id:custom,title:'古い質問',paragraph:false,required:false}]};
  const first=h.send(request);assert.equal(first.ok,true);
  // Simulate a legacy deployment that has only per-version records.
  delete h.props[`FORM_MAIN_${exhibitionId}`];delete h.props['FORM_ITEMS_'+first.formId];
  const next={...request,title:'秋展',schemaVersion:2,formId:first.formId,spreadsheetId:first.spreadsheetId,fields:[request.fields[1],{...request.fields[0],title:'作品タイトル'}, {id:'caption',title:'説明',paragraph:true,required:false}]};
  h.crashBatch();assert.equal(h.send(next).code,'FAILED');
  const updated=h.send(next);assert.equal(updated.ok,true);assert.equal(updated.formId,first.formId);assert.equal(updated.spreadsheetId,first.spreadsheetId);
  assert.equal(updated.itemIds.title,first.itemIds.title);assert.equal(updated.itemIds.deliveryKey,first.itemIds.deliveryKey);
  assert.deepEqual(h.counts(),{creates:1,sheets:1});assert.equal(h.items.length,3);assert.equal(h.files[first.formId].name,'秋展');
  const row={idempotencyKey:`${crypto.randomUUID()}:1:${crypto.randomUUID()}`,answers:{title:'旧版の作品',[custom]:'消した質問への回答',formula:'=1+1'}};
  assert.equal(h.send({action:'response.submit',formId:first.formId,itemIds:first.itemIds,rows:[row]}).ok,true);
  assert.equal(h.responses.length,1);assert.ok(h.archives.some(r=>r[2]===custom&&r[3]==='消した質問への回答'));
  assert.ok(h.archives.some(r=>r[2]==='formula'&&r[3]==="'=1+1"));
  assert.equal(h.send(next).ok,true);assert.deepEqual(h.counts(),{creates:1,sheets:1});
});

test("GAS deletes only associated files, permits retries and prevents recreation after deletion",()=>{
  const h=harness(),exhibitionId=crypto.randomUUID(),create={action:'form.create',exhibitionId,title:'削除対象',schemaVersion:1,fields:[{id:'title',title:'題名',paragraph:false,required:false}]};
  const form=h.send(create);assert.equal(form.ok,true);
  const request={action:'exhibition.delete',exhibitionId,formIds:[form.formId],spreadsheetIds:[form.spreadsheetId],fileIds:[]};
  assert.equal(h.send({...request,formIds:['unrelated_form_123']}).code,'FAILED');assert.ok(!h.props['DELETED_'+exhibitionId]);
  assert.equal(h.send(request).ok,true);assert.equal(h.files[form.formId].trashed,true);assert.equal(h.files[form.spreadsheetId].trashed,true);
  assert.equal(h.send(request).ok,true);assert.equal(h.send(create).code,'FAILED');assert.deepEqual(h.counts(),{creates:1,sheets:1});
});

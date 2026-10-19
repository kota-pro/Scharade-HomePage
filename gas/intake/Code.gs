/* Signed server requests only: applications, private receipts, and the approved grouping roster. */
function doPost(e) {
  function reply(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
  var lock;
  try {
    var config=PropertiesService.getScriptProperties();
    var secret=config.getProperty('WEBHOOK_SECRET');
    var target=config.getProperty('SPREADSHEET_ID');
    if(!secret || secret.length<32 || !target) return reply({ok:false,code:'NOT_CONFIGURED'});
    if(['11xbH-0iLMPL7XEQt7FGFhDmT8-WWDQwMB_0olCfIEo8','1thOhu3AwgGLhP9sGV_wToRy1kyzD_rJbw_bjcQHV8j4'].indexOf(target)>=0) return reply({ok:false,code:'NOT_CONFIGURED'});
    if(!e || !e.postData || e.postData.contents.length>15*1024*1024) return reply({ok:false,code:'INVALID'});
    var envelope=JSON.parse(e.postData.contents);
    if(envelope.version!==2 || typeof envelope.nonce!=='string' || !/^[a-f0-9]{32}$/.test(envelope.nonce) || typeof envelope.timestamp!=='string' || !/^\d{13}$/.test(envelope.timestamp) || Math.abs(Date.now()-Number(envelope.timestamp))>300000 || typeof envelope.payload!=='string' || typeof envelope.signature!=='string') return reply({ok:false,code:'UNAUTHORIZED'});
    var expected=Utilities.computeHmacSha256Signature('v2\n'+envelope.timestamp+'\n'+envelope.nonce+'\n'+envelope.payload,secret,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
    var diff=expected.length^envelope.signature.length;
    for(var i=0;i<expected.length;i++) diff|=expected.charCodeAt(i)^(envelope.signature.charCodeAt(i)||0);
    if(diff!==0) return reply({ok:false,code:'UNAUTHORIZED'});
    if(!reserveSecurityNonce_(envelope.nonce)) return reply({ok:false,code:'REPLAY'});
    var p=JSON.parse(envelope.payload);
    if(p.action==='health') {
      var healthSheet=SpreadsheetApp.openById(target).getSheetByName('立替申請');
      var healthy=!!healthSheet && healthSheet.getRange(1,1).getValue()==='申請ID';
      return reply({ok:healthy,envelopeVersion:2,accountingSheet:healthy});
    }
    if(p.action==='participants.read') return reply(groupingParticipants_(p));
    if(p.action==='roster.read') return reply(groupingRoster_(p));
    if(p.action==='receipt.prepare' || p.action==='receipt.upload') return reply(receiptAction_(p,config));
    if(envelope.payload.length>30000) return reply({ok:false,code:'INVALID'});
    if(!/^ADV-[a-f0-9]{32}$/.test(p.requestId) || !Number.isSafeInteger(p.amount) || p.amount<=0 || typeof p.websiteUserId!=='string' || !p.websiteUserId || typeof p.item!=='string' || !p.item.trim() || p.item.length>200 || typeof p.expenseDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.expenseDate) || !Number.isFinite(Date.parse(p.expenseDate)) || new Date(p.expenseDate).toISOString().slice(0,10)!==p.expenseDate) return reply({ok:false,code:'INVALID'});
    if(p.expenseDate>Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd')) return reply({ok:false,code:'INVALID'});
    var fields=['submittedAt','accountName','accountEmail','rosterName','university','lineName','notes','receiptUrl'];
    if(fields.some(function(k){return typeof p[k]!=='string' || p[k].length>3000;}) || !p.rosterName.trim()) return reply({ok:false,code:'INVALID'});
    var refund=refundCells_(p);
    if(refund===null) return reply({ok:false,code:'INVALID'});
    lock=LockService.getScriptLock();lock.waitLock(20000);
    var book=SpreadsheetApp.openById(target);
    var sheet=book.getSheetByName('立替申請');
    if(!sheet || sheet.getRange(1,1).getValue()!=='申請ID') return reply({ok:false,code:'NOT_CONFIGURED'});
    if(refund.length && (sheet.getMaxColumns()<28 || sheet.getRange(1,22,1,7).getValues()[0].join('|')!==REFUND_HEADERS_.join('|'))) return reply({ok:false,code:'NOT_CONFIGURED'});
    var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,envelope.payload,Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
    var last=sheet.getLastRow();
    if(last>1) {
      var found=sheet.getRange(2,1,last-1,1).createTextFinder(p.requestId).matchEntireCell(true).findNext();
      if(found) {
        if(sheet.getRange(found.getRow(),21).getValue()!==digest) return reply({ok:false,code:'CONFLICT'});
        return reply({ok:true,requestId:p.requestId});
      }
    }
    function text(s) { s=String(s==null?'':s);return /^[=+\-@\t\r]/.test(s)?"'"+s:s; }
    var row=[p.requestId,p.submittedAt,p.websiteUserId,p.accountName,p.accountEmail,p.rosterName,p.university,p.lineName,p.expenseDate,p.item,p.amount,p.notes,p.receiptUrl,'未承認','','','','','','',digest];
    row=row.concat(refund);
    if(last+1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),100);
    if(refund.length)sheet.getRange(last+1,22,1,7).setNumberFormat('@');
    sheet.getRange(last+1,1,1,row.length).setValues([row.map(function(v){return typeof v==='string'?text(v):v;})]);
    SpreadsheetApp.flush();
    return reply({ok:true,requestId:p.requestId});
  } catch(error) { return reply({ok:false,code:'RETRY'}); }
  finally { if(lock && lock.hasLock()) lock.releaseLock(); }
}

var REFUND_HEADERS_=['希望の返金方法','PayPay連絡用LINE名','銀行名','口座名義','店名','店番号','口座番号'];
function refundCells_(p) {
  var keys=['refundMethod','refundLineName','bankName','bankAccountName','bankBranchName','bankBranchCode','bankAccountNumber'];
  if(!keys.some(function(k){return Object.prototype.hasOwnProperty.call(p,k);}))return [];
  if(['bank','paypay','cash'].indexOf(p.refundMethod)<0)return null;
  function valid(k,n){return typeof p[k]==='string' && !!p[k].trim() && p[k].length<=n && !/[\x00-\x1f\x7f]/.test(p[k]);}
  if(p.refundMethod==='cash')return ['現金手渡し','','','','','',''];
  if(p.refundMethod==='paypay')return valid('refundLineName',100)?['PayPay',p.refundLineName.trim(),'','','','','']:null;
  if(!['bankName','bankAccountName','bankBranchName'].every(function(k){return valid(k,100);}) || !valid('bankBranchCode',3) || !/^\d{3}$/.test(p.bankBranchCode) || !valid('bankAccountNumber',8) || !/^\d{1,8}$/.test(p.bankAccountNumber))return null;
  return ['口座振込','',p.bankName.trim(),p.bankAccountName.trim(),p.bankBranchName.trim(),p.bankBranchCode,p.bankAccountNumber];
}

/** Run once from the editor. Only files created by this project need Drive access. */
function initializeReceiptStorage() {
  var config=PropertiesService.getScriptProperties();
  var id=config.getProperty('RECEIPT_FOLDER_ID');
  if(!id) {
    var found=Drive.Files.list({q:"mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='purpose' and value='scharade-receipts' }",fields:'files(id)',pageSize:2}).files||[];
    if(found.length>1) throw new Error('領収書フォルダーが複数あります。設定を確認してください。');
    id=found.length?found[0].id:Drive.Files.create({name:'シャレード会計・領収書',mimeType:'application/vnd.google-apps.folder',appProperties:{purpose:'scharade-receipts'}},null,{fields:'id'}).id;
    config.setProperty('RECEIPT_FOLDER_ID',id);
  }
  var folder=Drive.Files.get(id,{fields:'id,mimeType,trashed,webViewLink'});
  if(folder.trashed || folder.mimeType!=='application/vnd.google-apps.folder') throw new Error('領収書フォルダーを確認してください。');
  console.log(folder.webViewLink);
}

function receiptAction_(p,config) {
  var folder=config.getProperty('RECEIPT_FOLDER_ID');
  if(!folder || !/^[A-Za-z0-9_-]+$/.test(folder)) return {ok:false,code:'NOT_CONFIGURED'};
  if(!/^REC-[a-f0-9]{32}$/.test(p.receiptId||'')) return {ok:false,code:'INVALID'};
  if(p.action==='receipt.prepare') return {ok:true,receiptId:p.receiptId,driveFileId:Drive.Files.generateIds({count:1,space:'drive',type:'files'}).ids[0]};
  var types=['image/jpeg','image/png','image/webp','application/pdf'];
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(p.driveFileId||'') || types.indexOf(p.mimeType)<0 || typeof p.name!=='string' || !p.name || p.name.length>150 || /[\x00-\x1f\x7f/\\]/.test(p.name) || !Number.isSafeInteger(p.size) || p.size<1 || p.size>10*1024*1024 || !/^[a-f0-9]{64}$/.test(p.sha256||'') || typeof p.data!=='string' || p.data.length>13981016) return {ok:false,code:'INVALID'};
  var bytes=Utilities.base64Decode(p.data);
  var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  if(bytes.length!==p.size || digest!==p.sha256) return {ok:false,code:'INVALID'};
  var existing;
  try { existing=Drive.Files.get(p.driveFileId,{fields:'id,trashed,size,mimeType,parents,appProperties'}); } catch(error) { /* A reserved ID is absent until its first successful upload. */ }
  if(existing) {
    if(existing.trashed || String(existing.size)!==String(p.size) || existing.mimeType!==p.mimeType || (existing.parents||[]).indexOf(folder)<0 || !existing.appProperties || existing.appProperties.receiptId!==p.receiptId || existing.appProperties.sha256!==p.sha256) return {ok:false,code:'CONFLICT'};
  } else {
    // A retry uses the SAME reserved ID. Concurrent/uncertain creates cannot duplicate it.
    Drive.Files.create({id:p.driveFileId,name:p.receiptId+'_'+p.name,mimeType:p.mimeType,parents:[folder],appProperties:{receiptId:p.receiptId,sha256:p.sha256}},Utilities.newBlob(bytes,p.mimeType,p.name),{fields:'id'});
  }
  return {ok:true,receiptId:p.receiptId,url:'https://drive.google.com/file/d/'+p.driveFileId+'/view'};
}

/** Read-only access to the exact roster selected by the website administrator. */
function groupingRoster_(p) {
  var sourceId=p.spreadsheetId,sheetId=p.sheetId;
  // Only authenticated server requests reach this function; keep writes and accounting data out of this path.
  if(typeof sourceId!=='string' || !/^[A-Za-z0-9_-]{20,200}$/.test(sourceId) || !Number.isSafeInteger(sheetId) || sheetId<0 || sourceId===PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')) return {ok:false,code:'INVALID_SOURCE'};
  var book=SpreadsheetApp.openById(sourceId);
  var sheet=book.getSheets().find(function(s){return s.getSheetId()===sheetId;});
  if(!sheet || sheet.getLastRow()>2001 || sheet.getLastColumn()>100) return {ok:false,code:'INVALID_ROSTER'};
  var width=sheet.getLastColumn();
  var headers=sheet.getRange(1,1,1,width).getDisplayValues()[0];
  function column(regex,required) {
    var matches=[];headers.forEach(function(h,i){if(regex.test(h))matches.push(i);});
    if(matches.length>1 || (required && matches.length!==1))throw new Error('ROSTER_HEADER');
    return matches.length?matches[0]:-1;
  }
  var cols={name:column(/^(氏名(?:\s|$)|名前$|お名前をフルネーム)/,true),gender:column(/性別/,true),grade:column(/学年/,true),continuation:column(/継続しますか/,true),university:column(/大学名/,false),studentId:column(/学籍番号/,false),kana:column(/氏名フリガナ|お名前のフリガナ|ふりがな/,false),lineName:column(/LINE名|LINEの名前/i,false),timestamp:column(/タイムスタンプ|回答日時/,true)};
  var count=sheet.getLastRow()-1,records={},timestamps={};
  var range=count>0?sheet.getRange(2,1,count,width):null;
  var rows=range?range.getDisplayValues():[],values=range?range.getValues():[];
  function norm(v){return String(v||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();}
  rows.forEach(function(row,i){
    function val(k){return cols[k]<0?'':String(row[cols[k]]||'').trim();}
    var name=val('name');if(!name)return;
    var university=val('university'),student=val('studentId');
    var identity=[sourceId,String(sheetId),norm(name),norm(university),student?norm(student):norm(val('kana'))+'|'+norm(val('lineName'))].join('|');
    var key=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,identity,Utilities.Charset.UTF_8).map(function(b){return('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
    var date=values[i][cols.timestamp];
    var time=Object.prototype.toString.call(date)==='[object Date]'?date.getTime():Date.parse(val('timestamp').replace(/\//g,'-').replace(' ','T')+'+09:00');
    if(!Number.isFinite(time))throw new Error('ROSTER_TIMESTAMP');
    var record={key:key,name:name,lineName:val('lineName'),university:university,gender:val('gender'),grade:val('grade'),active:val('continuation')==='はい'};
    if(timestamps[key]===time && JSON.stringify(records[key])!==JSON.stringify(record))throw new Error('ROSTER_DUPLICATE');
    if(timestamps[key]==null || timestamps[key]<=time){timestamps[key]=time;records[key]=record;}
  });
  return {ok:true,spreadsheetId:sourceId,sheetId:sheetId,title:book.getName(),sheetTitle:sheet.getName(),records:Object.keys(records).map(function(key){return records[key];})};
}

/** Persist nonce reservations under a short lock; do not hold it during business operations. */
function reserveSecurityNonce_(nonce) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var config = PropertiesService.getScriptProperties(), entries = config.getProperties(), now = Date.now(), count = 0;
    var key = 'SEC_NONCE_' + nonce;
    if (entries[key] && Number(entries[key]) > now) return false;
    Object.keys(entries).forEach(function(name) {
      if (name.indexOf('SEC_NONCE_') !== 0) return;
      if (Number(entries[name]) <= now) config.deleteProperty(name); else count++;
    });
    if (count >= 2000) throw new Error('nonce-capacity');
    config.setProperty(key, String(now + 600000));
    return true;
  } finally { lock.releaseLock(); }
}

/** Separate, read-only form import. Never updates the membership roster or accounting book. */
function groupingParticipants_(p) {
  var id=p.spreadsheetId,gid=p.sheetId;
  if(typeof id!=='string' || !/^[A-Za-z0-9_-]{20,200}$/.test(id) || !Number.isSafeInteger(gid) || gid<0 || id===PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')) return {ok:false,code:'INVALID_SOURCE'};
  var book=SpreadsheetApp.openById(id),sheet=book.getSheets().filter(function(s){return s.getSheetId()===gid;})[0];
  if(!sheet || sheet.getLastRow()>2001 || sheet.getLastColumn()>100 || sheet.getLastColumn()<1) return {ok:false,code:'INVALID_SHEET'};
  var headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0].map(function(s){return s.trim().slice(0,200);});
  var clean=function(s){return s.normalize('NFKC').replace(/\s+/g,'');};
  var find=function(pattern){var matches=headers.map(function(h,i){return pattern.test(clean(h))?i:-1;}).filter(function(i){return i>=0;});return matches.length===1?matches[0]:-1;};
  var columns=p.columns || {name:find(/^(?:氏名|お名前|名前|姓名)(?:[（(].*[）)])?$/),grade:find(/学年/),gender:find(/性別/),lineName:find(/LINE.*(?:名|名前)/i)};
  if(['name','grade','gender','lineName'].some(function(k){return !Number.isInteger(columns[k]) || columns[k]<-1 || columns[k]>=headers.length;}))return {ok:false,code:'INVALID_COLUMNS'};
  var rows=[],count=Math.max(0,sheet.getLastRow()-1),values={};
  // Read only the four selected columns; QR links and other answers stay in Google Sheets.
  ['name','grade','gender','lineName'].forEach(function(k){values[k]=columns[k]<0 || !count?[]:sheet.getRange(2,columns[k]+1,count,1).getDisplayValues();});
  for(var i=0;i<count && columns.name>=0;i++) {
    var row={row:i+2};
    ['name','grade','gender','lineName'].forEach(function(k){row[k]=values[k][i]?String(values[k][i][0]).trim():'';});
    if(!row.name)continue;
    if(['name','grade','gender','lineName'].some(function(k){return row[k].length>200;}))return {ok:false,code:'INVALID_VALUE'};
    rows.push(row);
  }
  return {ok:true,spreadsheetId:id,sheetId:gid,title:book.getName(),sheetTitle:sheet.getName(),headers:headers,columns:columns,rows:rows};
}

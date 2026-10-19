var REQUEST_HEADERS_=['申請ID','受付日時','サイト会員ID','アカウント名','メール','名簿上の氏名','大学名','LINE名','立替日','項目名','金額','備考','領収書URL','承認状態','人物ID','取引ID','確認日時','確認者','確認メモ','精算状況','送信照合値'];
var REFUND_HEADERS_=['希望の返金方法','PayPay連絡用LINE名','銀行名','口座名義','店名','店番号','口座番号'];
REQUEST_HEADERS_=REQUEST_HEADERS_.concat(REFUND_HEADERS_);
var PRIVATE_SHEETS_=['取引記録','人物対応','残高確認記録','名簿確認'];
var TYPES_={income:'収入',expense:'支出',transfer:'資金移動',advance:'立替',openingAdvance:'繰越立替',refund:'返金'};
var ROSTER_FIELDS_=['name','kana','lineName','gender','grade','university','department','studentId','continuation','timestamp'];
var bookCache_;

function onOpen() { SpreadsheetApp.getUi().createMenu('サークル会計').addItem('会計画面を開く','openAccounting').addItem('名簿を更新','refreshRoster').addItem('台帳を再集計','refreshAccounting').addToUi(); }
function openAccounting() { requireAdmin_();SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('Index').setTitle('サークル会計')); }
function doGet() { requireAdmin_();return HtmlService.createHtmlOutputFromFile('Index').setTitle('シャレード会計').addMetaTag('viewport','width=device-width, initial-scale=1'); }
function today_() { return Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd'); }
function stamp_() { return new Date().toISOString(); }
function getBook_() {
  var id=PropertiesService.getScriptProperties().getProperty('BOOK_ID');
  if(!id) throw new Error('初期セットアップが必要です。');
  if(['11xbH-0iLMPL7XEQt7FGFhDmT8-WWDQwMB_0olCfIEo8','1thOhu3AwgGLhP9sGV_wToRy1kyzD_rJbw_bjcQHV8j4'].indexOf(id)>=0) throw new Error('名簿への書き込みは禁止されています。');
  if(!bookCache_)bookCache_=SpreadsheetApp.openById(id);return bookCache_;
}
function requireAdmin_() {
  var email=Session.getActiveUser().getEmail().toLowerCase();
  var allowed=(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS')||'').toLowerCase().split(/[\s,;]+/).filter(Boolean);
  if(!email || allowed.indexOf(email)<0) throw new Error('会計担当者のGoogleアカウントでログインしてください。');
  return email;
}
function text_(v) { v=String(v==null?'':v);return /^[=+\-@\t\r]/.test(v)?"'"+v:v; }
function sheet_(name) { var s=getBook_().getSheetByName(name);if(!s)throw new Error(name+'シートがありません。');return s; }
function jsonRows_(name) {
  var s=sheet_(name), n=s.getLastRow();if(n<2)return [];
  return s.getRange(2,1,n-1,1).getValues().filter(function(r){return r[0]!=='';}).map(function(r){return JSON.parse(r[0]);});
}
function writeJsonRows_(name,rows) {
  var s=sheet_(name), n=s.getLastRow();
  ensureRows_(s,rows.length+1);
  if(rows.length) s.getRange(2,1,rows.length,1).setValues(rows.map(function(r){return [JSON.stringify(r)];}));
  if(n>rows.length+1)s.getRange(rows.length+2,1,n-rows.length-1,1).clearContent();
}
function appendJson_(name,row) { sheet_(name).appendRow([JSON.stringify(row)]); }
function ensureRows_(sheet,needed) {var max=sheet.getMaxRows();if(needed>max)sheet.insertRowsAfter(max,needed-max+100);}
function readSettings_() {
  var s=sheet_('設定').getRange('A5:B9').getValues(), o={};s.forEach(function(r){o[r[0]]=r[1];});
  var day=o['会計開始日'];if(day instanceof Date)day=Utilities.formatDate(day,'Asia/Tokyo','yyyy-MM-dd');
  return {startDate:String(day||''),bankOpening:o['銀行開始残高'],cashOpening:o['現金開始残高'],fiscalYear:Number(o['表示年度（開始年）']||Accounting.fiscalYear(today_())),note:String(o['引き継ぎメモ']||'')};
}
function periods_() {
  var s=sheet_('名簿設定'),n=s.getLastRow();if(n<5)return [];
  function day(v){return v instanceof Date?Utilities.formatDate(v,'Asia/Tokyo','yyyy-MM-dd'):String(v);}
  return s.getRange(5,1,n-4,15).getValues().filter(function(r){return r[0]!=='';}).map(function(r){
    var match=String(r[2]).match(/\/spreadsheets\/d\/([\w-]+)/);
    var columns={};ROSTER_FIELDS_.forEach(function(k,i){columns[k]=String(r[i+5]||'').trim();});
    return {start:day(r[0]),end:day(r[1]),spreadsheetId:match?match[1]:String(r[2]),sheetId:Number(r[3]),headerRow:Number(r[4]||1),columns:columns};
  });
}
function requests_() {
  var s=sheet_('立替申請'),n=s.getLastRow();if(n<2)return [];
  return s.getRange(2,1,n-1,Math.min(28,s.getMaxColumns())).getValues().map(function(r,i){return {
    row:i+2,id:String(r[0]),submittedAt:String(r[1]),websiteUserId:String(r[2]),accountName:String(r[3]),accountEmail:String(r[4]),rosterName:String(r[5]),university:String(r[6]),lineName:String(r[7]),
    date:r[8] instanceof Date?Utilities.formatDate(r[8],'Asia/Tokyo','yyyy-MM-dd'):String(r[8]),description:String(r[9]),amount:Number(r[10]),notes:String(r[11]),receiptUrl:String(r[12]),status:String(r[13]),memberId:String(r[14]),transactionId:String(r[15]),reviewNote:String(r[18]),
    refundMethod:String(r[21]||''),refundLineName:String(r[22]||''),bankName:String(r[23]||''),bankAccountName:String(r[24]||''),bankBranchName:String(r[25]||''),bankBranchCode:String(r[26]||''),bankAccountNumber:String(r[27]||'')
  };}).filter(function(r){return r.id;});
}
/** Add only the new request columns; never rewrite financial rows or the source roster. */
function initializeRefundFields() {
  requireAdmin_();
  var s=sheet_('立替申請');
  if(s.getRange(1,1).getValue()!=='申請ID')throw new Error('申請一覧の見出しを確認してください。');
  var max=s.getMaxColumns();if(max<28)s.insertColumnsAfter(max,28-max);
  var header=s.getRange(1,22,1,7),current=header.getValues()[0];
  if(current.some(function(v,i){return v!=='' && v!==REFUND_HEADERS_[i];}))throw new Error('返金方法の追加先に別の列があります。変更を中止しました。');
  header.setValues([REFUND_HEADERS_]);
  s.getRange(1,22,s.getMaxRows(),7).setNumberFormat('@');
  SpreadsheetApp.flush();
  return '希望の返金方法の保存欄を用意しました。';
}
function initializeAccounting() {
  var book=SpreadsheetApp.getActiveSpreadsheet();
  if(!book)throw new Error('会計スプレッドシートの「拡張機能 → Apps Script」から実行してください。');
  var owner=book.getOwner();var actor=Session.getActiveUser().getEmail();
  if(!owner || !actor || owner.getEmail().toLowerCase()!==actor.toLowerCase())throw new Error('会計ファイルの所有者が初期設定を行ってください。');
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('BOOK_ID') && props.getProperty('BOOK_ID')!==book.getId())throw new Error('既存の会計ファイルとは異なります。');
  if(!book.getSheetByName('設定') || !book.getSheetByName('立替申請'))throw new Error('会計テンプレートを先に用意してください。');
  props.setProperty('BOOK_ID',book.getId());
  if(!props.getProperty('ADMIN_EMAILS'))props.setProperty('ADMIN_EMAILS',actor.toLowerCase());
  book.setSpreadsheetTimeZone('Asia/Tokyo');book.setSpreadsheetLocale('ja_JP');
  PRIVATE_SHEETS_.forEach(function(name){var s=sheet_(name);if(s.getRange(1,1).getValue()!=='記録JSON')throw new Error(name+'の見出しが異なります。');s.hideSheet();});
  if(sheet_('立替申請').getRange(1,1).getValue()!=='申請ID')throw new Error('申請一覧の見出しを確認してください。');
  var triggers=ScriptApp.getProjectTriggers();
  if(!triggers.some(function(t){return t.getHandlerFunction()==='scheduledRosterRefresh';}))ScriptApp.newTrigger('scheduledRosterRefresh').timeBased().everyDays(1).atHour(6).inTimezone('Asia/Tokyo').create();
  props.setProperty('SETUP_AT',stamp_());
  try {syncRoster_();} catch(error){props.setProperty('ROSTER_ERROR',error.message);}
  onOpen();return '初期設定が完了しました。会計画面で開始日と残高を設定してください。';
}
function refreshRoster() { requireAdmin_();var result=accountingAction({action:'syncRoster'});if(!result.ok)throw new Error(result.message); }
function refreshAccounting() { requireAdmin_();renderReports_(); }
function scheduledRosterRefresh() {
  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{syncRoster_();}catch(error){PropertiesService.getScriptProperties().setProperty('ROSTER_ERROR',error.message);}finally{lock.releaseLock();}
}
function nameMap_(members) {var out={};members.forEach(function(p){out[p.id]=p.name;});return out;}
function bootstrap_() {
  var s=readSettings_(),events=jsonRows_('取引記録'),members=jsonRows_('人物対応'),calculated=null,issue='';
  try{calculated=Accounting.build(s,events);}catch(error){issue=error.message;}
  return {settings:s,members:members.map(function(p){return {id:p.id,name:p.name,university:p.university,lineName:p.lineName,active:p.active,siteUserIds:p.siteUserIds||[]};}),
    requests:requests_(),events:events,summary:calculated,months:calculated?Accounting.months(s,events,s.fiscalYear,today_()):[],checks:calculated?Accounting.reconcile(s,events,jsonRows_('残高確認記録')):[],
    periods:periods_(),rosterPending:jsonRows_('名簿確認'),issue:issue,rosterError:PropertiesService.getScriptProperties().getProperty('ROSTER_ERROR')||'',rosterUpdatedAt:PropertiesService.getScriptProperties().getProperty('ROSTER_UPDATED_AT')||'',
    bookUrl:getBook_().getUrl(),today:today_()};
}
function accountingAction(input) {
  var actor=requireAdmin_(),lock=LockService.getScriptLock();
  if(!input || typeof input.action!=='string')throw new Error('操作を確認してください。');
  lock.waitLock(20000);
  try {
    if(input.action==='bootstrap')return {ok:true,data:bootstrap_()};
    if(input.action==='transaction')registerTransaction_(input,actor);
    else if(input.action==='review')reviewRequest_(input,actor);
    else if(input.action==='cancel')cancelTransaction_(input,actor);
    else if(input.action==='check')registerCheck_(input,actor);
    else if(input.action==='settings')saveSettings_(input);
    else if(input.action==='periods')savePeriods_(input.periods);
    else if(input.action==='syncRoster')syncRoster_();
    else if(input.action==='resolveRoster')resolveRoster_(input);
    else if(input.action==='addPerson')addPerson_(input,actor);
    else if(input.action==='refresh'){}
    else throw new Error('対応していない操作です。');
    var warning='';try{renderReports_();}catch(error){warning='記録済みです。集計の更新には次の対応が必要です：'+error.message;}
    return {ok:true,data:bootstrap_(),warning:warning};
  }catch(error){return {ok:false,message:error.message||'処理できませんでした。'};}
  finally {lock.releaseLock();}
}
function member_(id) {var found=jsonRows_('人物対応').find(function(p){return p.id===id;});if(!found)throw new Error('人物を選択してください。');return found;}
function token_(v){if(typeof v!=='string'||!/^[a-f0-9-]{36}$/.test(v))throw new Error('画面を開き直してください。');return v;}
function registerTransaction_(input,actor) {
  var events=jsonRows_('取引記録'),s=readSettings_(),type=input.type;
  var row={id:'TX-'+token_(input.token),date:String(input.date),type:type,description:String(input.description||'').trim(),amount:Number(input.amount),account:String(input.account||''),from:String(input.from||''),to:String(input.to||''),memberId:String(input.memberId||''),advanceId:String(input.advanceId||''),createdAt:stamp_(),actor:actor,notes:String(input.notes||'')};
  if(row.description.length>200 || row.notes.length>3000)throw new Error('項目名または備考が長すぎます。');
  if(row.date>today_())throw new Error('今日までの日付で登録してください。');
  if(['advance','openingAdvance','refund'].indexOf(type)>=0)member_(row.memberId);
  var existing=events.find(function(e){return e.id===row.id;});
  if(existing){var keys=['date','type','description','amount','account','from','to','memberId','advanceId','notes'];if(keys.some(function(k){return existing[k]!==row[k];}))throw new Error('同じ登録番号で内容を変更できません。');return;}
  Accounting.build(s,events.concat([row]));appendJson_('取引記録',row);
}
function reviewRequest_(input,actor) {
  var r=requests_().find(function(r){return r.id===input.requestId;});if(!r)throw new Error('申請が見つかりません。');
  if(input.decision!=='approve' && input.decision!=='reject')throw new Error('承認または却下を指定してください。');
  var events=jsonRows_('取引記録'),original=events.find(function(e){return e.sourceRequestId===r.id;});
  if(r.status!=='未承認'){
    if((input.decision==='approve' && r.status==='承認済み' && r.memberId===input.memberId) || (input.decision==='reject' && r.status==='却下'))return;
    throw new Error('この申請は既に確認済みです。');
  }
  var note=String(input.note||'').trim();if(note.length>1000)throw new Error('確認メモは1000文字以内で入力してください。');
  if(input.decision==='reject') {
    if(original)throw new Error('この申請は計上済みです。承認を再実行して表示を復旧してください。');
    if(!note)throw new Error('却下理由を記入してください。');
    sheet_('立替申請').getRange(r.row,14,1,7).setValues([['却下','','',stamp_(),text_(actor),text_(note),'対象外']]);return;
  }
  var members=jsonRows_('人物対応'),p=members.find(function(p){return p.id===input.memberId;});if(!p)throw new Error('名簿の人物を確認して選択してください。');
  if(members.some(function(other){return other.id!==p.id && (other.siteUserIds||[]).indexOf(r.websiteUserId)>=0;}))throw new Error('このサイトアカウントは別の人物に対応しています。名簿の対応を確認してください。');
  var event={id:'REQ-'+r.id,date:r.date,type:'advance',description:r.description,amount:r.amount,memberId:p.id,sourceRequestId:r.id,createdAt:stamp_(),actor:actor,notes:r.notes,receiptUrl:r.receiptUrl};
  if(original && (original.memberId!==p.id || original.canceledAt))throw new Error('既存の計上内容を確認してください。');
  if(!original)Accounting.build(readSettings_(),events.concat([event]));
  p.siteUserIds=p.siteUserIds||[];if(p.siteUserIds.indexOf(r.websiteUserId)<0)p.siteUserIds.push(r.websiteUserId);
  writeJsonRows_('人物対応',members);
  if(!original)appendJson_('取引記録',event);
  sheet_('立替申請').getRange(r.row,14,1,7).setValues([['承認済み',p.id,event.id,stamp_(),text_(actor),text_(note),'未返金']]);
}
function cancelTransaction_(input,actor) {
  var events=jsonRows_('取引記録'),e=events.find(function(e){return e.id===input.id;});if(!e)throw new Error('取引が見つかりません。');if(e.canceledAt)return;
  if(!String(input.reason||'').trim())throw new Error('取消理由を記入してください。');
  e.canceledAt=stamp_();e.cancelReason=String(input.reason);e.canceledBy=actor;
  Accounting.build(readSettings_(),events);writeJsonRows_('取引記録',events);
  if(e.sourceRequestId){var r=requests_().find(function(r){return r.id===e.sourceRequestId;});if(r)sheet_('立替申請').getRange(r.row,14).setValue('取消済み');}
}
function registerCheck_(input,actor) {
  var checks=jsonRows_('残高確認記録');var id='CHK-'+token_(input.token);
  var c={id:id,date:String(input.date),account:String(input.account),actual:input.actual===''?'':Number(input.actual),createdAt:stamp_(),actor:actor};
  if(c.date>today_())throw new Error('今日までの日付で登録してください。');
  var old=checks.find(function(r){return r.id===id;});if(old){if(old.date!==c.date||old.actual!==c.actual||old.account!==c.account)throw new Error('同じ登録番号で内容を変更できません。');return;}
  Accounting.reconcile(readSettings_(),jsonRows_('取引記録'),checks.concat([c]));appendJson_('残高確認記録',c);
}
function saveSettings_(input) {
  var s={startDate:String(input.startDate),bankOpening:input.bankOpening===''?'':Number(input.bankOpening),cashOpening:input.cashOpening===''?'':Number(input.cashOpening),fiscalYear:Number(input.fiscalYear),note:String(input.note||'')};
  Accounting.validateSettings(s);if(s.startDate>today_())throw new Error('会計開始日は今日以前にしてください。');if(!Number.isInteger(s.fiscalYear)||s.fiscalYear<2000||s.fiscalYear>2200)throw new Error('表示年度を確認してください。');
  Accounting.build(s,jsonRows_('取引記録'));Accounting.reconcile(s,jsonRows_('取引記録'),jsonRows_('残高確認記録'));
  sheet_('設定').getRange('B5:B9').setValues([[s.startDate],[s.bankOpening],[s.cashOpening],[s.fiscalYear],[text_(s.note)]]);
}
function savePeriods_(rows) {
  if(!Array.isArray(rows)||!rows.length||rows.length>100)throw new Error('名簿の対象期間を指定してください。');
  var p=Accounting.periods(rows.map(function(r){var m=String(r.url||r.spreadsheetId).match(/\/spreadsheets\/d\/([\w-]+)/),columns={};ROSTER_FIELDS_.forEach(function(k){var v=String((r.columns||{})[k]||r['col_'+k]||'').trim().toUpperCase();if(v && v!=='-' && !/^[A-Z]{1,3}$/.test(v))throw new Error('列の対応は A・B・C などの列記号で指定してください。存在しない列は -、自動判定は空欄です。');columns[k]=v;});return {start:String(r.start),end:String(r.end),spreadsheetId:m?m[1]:String(r.spreadsheetId||r.url),sheetId:Number(r.sheetId),headerRow:Number(r.headerRow||1),columns:columns};}));
  if(p.some(function(r){return !/^[\w-]+$/.test(r.spreadsheetId)||r.spreadsheetId===getBook_().getId()||!Number.isInteger(r.sheetId)||r.sheetId<0||!Number.isInteger(r.headerRow)||r.headerRow<1;}))throw new Error('名簿URL・シートID・見出し行を確認してください。');
  var s=sheet_('名簿設定'),old=s.getLastRow();s.getRange(5,1,p.length,15).setValues(p.map(function(r){return [r.start,r.end,'https://docs.google.com/spreadsheets/d/'+r.spreadsheetId+'/edit',r.sheetId,r.headerRow].concat(ROSTER_FIELDS_.map(function(k){return r.columns[k];}));}));if(old>p.length+4)s.getRange(p.length+5,1,old-p.length-4,15).clearContent();
}
function digest_(value) {return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(function(b){return('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
/* This adapter only invokes read methods on the roster workbook. */
function readRoster_(period) {
  if(period.spreadsheetId===getBook_().getId())throw new Error('会計ファイルを名簿として参照できません。');
  var source=SpreadsheetApp.openById(period.spreadsheetId),tab=source.getSheets().find(function(s){return s.getSheetId()===period.sheetId;});if(!tab)throw new Error('名簿のシートIDが見つかりません。');
  var count=tab.getLastRow()-period.headerRow;if(count<1)throw new Error('名簿に回答がありません。');
  var headers=tab.getRange(period.headerRow,1,1,tab.getLastColumn()).getDisplayValues()[0];
  function col(key,regex,required){var explicit=String((period.columns||{})[key]||'').toUpperCase();if(explicit==='-'){if(required)throw new Error(key+'の列が必要です。');return -1;}if(explicit){var index=0;explicit.split('').forEach(function(c){index=index*26+c.charCodeAt(0)-64;});if(index<1||index>headers.length)throw new Error(key+'の列が名簿の範囲外です。');return index-1;}var matches=[];headers.forEach(function(h,i){if(regex.test(h))matches.push(i);});if(matches.length!==1 && required)throw new Error('名簿の見出しを確認してください：'+key);return matches.length===1?matches[0]:-1;}
  var cols={name:col('name',/^(氏名(?:\s|$)|名前$|お名前をフルネーム)/,true),kana:col('kana',/氏名フリガナ|お名前のフリガナ|ふりがな/,false),lineName:col('lineName',/LINE名|LINEの名前/i,false),university:col('university',/大学名/,false),studentId:col('studentId',/学籍番号/,false),grade:col('grade',/学年/,false),gender:col('gender',/性別/,false),department:col('department',/学部/,false),continuation:col('continuation',/継続しますか/,false),timestamp:col('timestamp',/タイムスタンプ/,false)};
  var rows=tab.getRange(period.headerRow+1,1,count,headers.length).getDisplayValues();
  return rows.filter(function(r){return String(r[cols.name]||'').trim();}).map(function(r){var p={};Object.keys(cols).forEach(function(k){p[k]=cols[k]>=0?String(r[cols[k]]||'').trim():'';});if(cols.continuation<0)p.continuation='はい';p.source=period.spreadsheetId+':'+period.sheetId;p.key=digest_(p.source+'|'+p.timestamp+'|'+p.name+'|'+p.kana+'|'+p.university+'|'+p.studentId+'|'+p.lineName);return p;});
}
function syncRoster_() {
  var props=PropertiesService.getScriptProperties(),periods=Accounting.periods(periods_()),current=Accounting.activePeriod(periods,today_()),incoming=[],members=jsonRows_('人物対応'),pending=[],updates={};
  periods.filter(function(p){return p.start<=today_();}).forEach(function(period){var rows=readRoster_(period);rows.sort(function(a,b){return a.timestamp.localeCompare(b.timestamp,undefined,{numeric:true});});rows.forEach(function(r){r.currentPeriod=period.start===current.start;incoming.push(r);});});
  incoming.forEach(function(r){
    var known=members.filter(function(p){return(p.sourceKeys||[]).indexOf(r.key)>=0;});var academic=Accounting.academicKey(r);
    if(!known.length && academic)known=members.filter(function(p){return(p.academicKeys||[]).indexOf(academic)>=0;});
    if(known.length>1){pending.push({record:r,candidates:known.map(function(p){return p.id;}),reason:'同じ識別情報が複数の人物にあります。'});return;}
    var p=known[0];
    if(!p){var possible=members.filter(function(p){return Accounting.normalize(p.name)===Accounting.normalize(r.name);});if(possible.length){pending.push({record:r,candidates:possible.map(function(p){return p.id;}),reason:'既存の人物との対応を確認してください。'});return;}
      if(r.continuation!=='はい')return;
      p={id:'P-'+Utilities.getUuid(),name:r.name,kana:r.kana,lineName:r.lineName,university:r.university,studentId:r.studentId,sourceKeys:[],academicKeys:[],siteUserIds:[],active:false};members.push(p);
    }
    if(p.sourceKeys.indexOf(r.key)<0)p.sourceKeys.push(r.key);if(academic&&p.academicKeys.indexOf(academic)<0)p.academicKeys.push(academic);
    p.name=r.name;p.kana=r.kana;p.lineName=r.lineName;p.university=r.university;p.studentId=r.studentId;p.gender=r.gender;p.grade=r.grade;p.department=r.department;
    if(r.currentPeriod)updates[p.id]=r.continuation==='はい';
  });
  members.forEach(function(p){p.active=updates[p.id]===true;});
  writeJsonRows_('人物対応',members);writeJsonRows_('名簿確認',pending);
  props.setProperty('ROSTER_UPDATED_AT',stamp_());props.deleteProperty('ROSTER_ERROR');
}
function resolveRoster_(input) {
  var pending=jsonRows_('名簿確認'),entry=pending.find(function(p){return p.record.key===input.key;});if(!entry)throw new Error('確認対象が見つかりません。');
  var members=jsonRows_('人物対応'),r=entry.record,p;
  if(input.memberId==='new'){p={id:'P-'+Utilities.getUuid(),name:r.name,kana:r.kana,lineName:r.lineName,university:r.university,studentId:r.studentId,sourceKeys:[],academicKeys:[],siteUserIds:[],active:r.continuation==='はい'};members.push(p);}
  else{p=members.find(function(p){return p.id===input.memberId;});if(!p)throw new Error('人物を選択してください。');}
  if(p.sourceKeys.indexOf(r.key)<0)p.sourceKeys.push(r.key);var k=Accounting.academicKey(r);if(k&&p.academicKeys.indexOf(k)<0)p.academicKeys.push(k);
  writeJsonRows_('人物対応',members);syncRoster_();
}
function addPerson_(input,actor) {
  var members=jsonRows_('人物対応'),id='P-'+token_(input.token),name=String(input.name||'').trim(),university=String(input.university||'').trim(),lineName=String(input.lineName||'').trim();
  if(!name||name.length>100||university.length>100||lineName.length>100)throw new Error('氏名・大学・LINE名を100文字以内で入力してください。');
  var existing=members.find(function(p){return p.id===id;});if(existing){if(existing.name!==name||existing.university!==university||existing.lineName!==lineName)throw new Error('同じ登録番号で内容を変更できません。');return;}
  members.push({id:id,name:name,university:university,lineName:lineName,kana:'',studentId:'',sourceKeys:[],academicKeys:[],siteUserIds:[],active:false,manual:true,createdAt:stamp_(),actor:actor});writeJsonRows_('人物対応',members);
}
function report_(name,headers,rows) {
  var s=sheet_(name),old=s.getLastRow();ensureRows_(s,rows.length+4);s.getRange(4,1,1,headers.length).setValues([headers]);
  if(rows.length)s.getRange(5,1,rows.length,headers.length).setValues(rows.map(function(r){return r.map(function(v){return typeof v==='string'?text_(v):v==null?'':v;});}));
  if(old>rows.length+4)s.getRange(rows.length+5,1,old-rows.length-4,headers.length).clearContent();
  s.getRange('A3').setValue('更新：'+Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy/MM/dd HH:mm'));
}
function renderReports_() {
  var s=readSettings_(),events=jsonRows_('取引記録'),b=Accounting.build(s,events),names=nameMap_(jsonRows_('人物対応')),checks=Accounting.reconcile(s,events,jsonRows_('残高確認記録'));
  var monthly=Accounting.months(s,events,s.fiscalYear,today_());
  report_('月次集計',['月','収入','支出（立替含む）','収支差額','銀行残高','現金残高','未返金額'],monthly.map(function(m){return[m.month,m.income,m.expense,m.net,m.bank,m.cash,m.outstanding];}));
  sheet_('月次集計').getRange(5,4,monthly.length,1).setFormulas(monthly.map(function(m,i){return [m.income!==null?'=B'+(i+5)+'-C'+(i+5):''];}));
  ['bank','cash'].forEach(function(account){
    var name=account==='bank'?'銀行通帳':'現金出納帳',items=[];
    b.rows.forEach(function(e,i){var delta=e[account+'Delta'];if(delta)items.push({date:e.date,order:i,row:[e.date,TYPES_[e.type],e.description,names[e.memberId]||'',Math.max(delta,0),Math.max(-delta,0),e[account+'Balance'],'','',e.notes||'']});});
    checks.filter(function(c){return c.account===account;}).forEach(function(c){items.push({date:c.date,order:Number.MAX_SAFE_INTEGER,row:[c.date,'残高確認','当日終了時点','',0,0,c.expected,c.actual,c.difference,'']});});
    items.sort(function(a,b){return a.date.localeCompare(b.date)||a.order-b.order;});
    var rows=[[s.startDate,'開始残高','繰越','',0,0,s[account+'Opening'],'','','']].concat(items.map(function(i){return i.row;}));
    report_(name,['日付','区分','項目名','立替者','入金','出金','計算残高','実残高','差額','備考'],rows);
    var report=sheet_(name);report.getRange(5,5,rows.length,5).setNumberFormat('#,##0"円";[Red](#,##0)"円";"—"');
    if(rows.length>1)report.getRange(6,7,rows.length-1,1).setFormulas(rows.slice(1).map(function(r,i){var row=i+6;return ['=G'+(row-1)+'+E'+row+'-F'+row];}));
    report.getRange(5,9,rows.length,1).setFormulas(rows.map(function(r,i){var row=i+5;return [r[7]!==''?'=H'+row+'-G'+row:''];}));
  });
  report_('立替精算',['立替ID','人物','立替日','項目名','立替額','返金済額','未返金額'],b.advances.map(function(a){return[a.id,names[a.memberId]||a.memberId,a.date,a.description,a.amount,a.repaid,a.outstanding];}));
  requests_().filter(function(r){return r.status==='承認済み';}).forEach(function(r){var a=b.advances.find(function(a){return a.id===r.transactionId;});sheet_('立替申請').getRange(r.row,20).setValue(a?(a.outstanding===0?'返金済み':a.repaid?'一部返金':'未返金'):'取消済み');});
}

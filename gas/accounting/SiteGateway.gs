/* Website-only signed gateway. Keep this in the SAME project as Core/Main so all writes share a ScriptLock. */
var AC_HISTORY_='会計操作履歴',AC_ROSTER_='共通名簿記録';
function ac_error_(code,message){var e=new Error(message||code);e.accountingCode=code;throw e;}
function ac_reply_(value){return ContentService.createTextOutput(JSON.stringify(Object.assign({gatewayVersion:1,envelopeVersion:2},value))).setMimeType(ContentService.MimeType.JSON);}
function ac_canonical_(v){if(Array.isArray(v))return '['+v.map(ac_canonical_).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+ac_canonical_(v[k]);}).join(',')+'}';return JSON.stringify(v);}
function ac_meta_(){return JSON.parse(PropertiesService.getScriptProperties().getProperty('ACCOUNTING_ROSTER_META')||'null');}
function ac_history_(){return jsonRows_(AC_HISTORY_);}
function ac_nonce_(nonce){
  var props=PropertiesService.getScriptProperties(),all=props.getProperties(),now=Date.now(),key='AC_NONCE_'+nonce,count=0;
  if(Number(all[key])>now)ac_error_('REPLAY');
  Object.keys(all).filter(function(k){return k.indexOf('AC_NONCE_')===0;}).forEach(function(k){if(Number(all[k])<=now)props.deleteProperty(k);else count++;});
  if(count>=1000)ac_error_('RETRY');props.setProperty(key,String(now+600000));
}
function ac_verify_(e){
  var secret=PropertiesService.getScriptProperties().getProperty('ACCOUNTING_ADMIN_WEBHOOK_SECRET');
  if(!secret||secret.length<32||!siteManaged_())ac_error_('NOT_CONFIGURED');
  if(!e||!e.postData||e.postData.contents.length>4000000)ac_error_('INVALID');
  var v=JSON.parse(e.postData.contents);
  if(v.version!==2||typeof v.timestamp!=='string'||!/^\d{13}$/.test(v.timestamp)||Math.abs(Date.now()-Number(v.timestamp))>300000||typeof v.nonce!=='string'||!/^[a-f0-9]{32}$/.test(v.nonce)||typeof v.payload!=='string'||typeof v.signature!=='string'||!/^[a-f0-9]{64}$/.test(v.signature))ac_error_('UNAUTHORIZED');
  var expected=Utilities.computeHmacSha256Signature('v2\n'+v.timestamp+'\n'+v.nonce+'\n'+v.payload,secret,Utilities.Charset.UTF_8).map(function(b){return('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  var diff=0;for(var i=0;i<64;i++)diff|=expected.charCodeAt(i)^v.signature.charCodeAt(i);if(diff)ac_error_('UNAUTHORIZED');
  return {nonce:v.nonce,payload:JSON.parse(v.payload)};
}
function doPost(e){
  var lock;
  try {
    var envelope=ac_verify_(e);lock=LockService.getScriptLock();lock.waitLock(20000);ac_nonce_(envelope.nonce);
    var input=envelope.payload;
    if(input.action==='health')return ac_reply_({ok:true,sharedRoster:true});
    if(input.action==='roster.sync'){ac_syncRoster_(input.snapshot);return ac_reply_({ok:true});}
    var actor=ac_actor_(input.actor);
    if(input.action==='bootstrap')return ac_reply_({ok:true,data:ac_data_()});
    return ac_reply_(ac_action_(input,actor));
  }catch(error){return ac_reply_({ok:false,code:error.accountingCode||'RETRY',message:error.accountingCode==='INVALID'?error.message:undefined});}
  finally{if(lock&&lock.hasLock()){SpreadsheetApp.flush();lock.releaseLock();}}
}
function ac_actor_(actor){
  if(!actor||['executive','admin'].indexOf(actor.role)<0||typeof actor.id!=='string'||!actor.id||actor.id.length>200||typeof actor.name!=='string'||actor.name.length>200)ac_error_('UNAUTHORIZED');
  return 'サイト会員：'+actor.name+' ['+actor.id+']';
}
function initializeWebsiteAccounting(){
  requireAdmin_();var props=PropertiesService.getScriptProperties();
  if((props.getProperty('ACCOUNTING_ADMIN_WEBHOOK_SECRET')||'').length<32)throw new Error('サイト管理用の秘密鍵を先に設定してください。');
  var lock=LockService.getScriptLock();lock.waitLock(20000);try{
  var book=getBook_();[AC_HISTORY_,AC_ROSTER_].forEach(function(name){var s=book.getSheetByName(name);if(!s){s=book.insertSheet(name);s.getRange(1,1).setValue('記録JSON');}else if(s.getRange(1,1).getValue()!=='記録JSON')throw new Error(name+'の見出しを確認してください。');});
  props.setProperty('ACCOUNTING_ROSTER_MODE','website');
  props.deleteProperty('ROSTER_ERROR');
  ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='scheduledRosterRefresh';}).forEach(function(t){ScriptApp.deleteTrigger(t);});
  SpreadsheetApp.flush();return 'サイト会計の準備が完了しました。名簿はAdminで適用した内容を使用します。';
  }finally{lock.releaseLock();}
}
function ac_revision_(){return digest_(ac_canonical_({settings:readSettings_(),events:jsonRows_('取引記録'),members:jsonRows_('人物対応'),checks:jsonRows_('残高確認記録'),requests:requests_(),roster:ac_meta_(),pending:jsonRows_('名簿確認')}));}
function ac_data_(){
  var data=bootstrap_(),history=ac_history_();data.revision=ac_revision_();data.sharedRoster=ac_meta_();
  delete data.periods;delete data.bookUrl;
  data.rosterPending=jsonRows_('名簿確認').filter(function(p){return p.shared;}).map(function(p){return {record:p.record,reason:p.reason};});
  data.pendingOperations=history.filter(function(o){return o.status==='pending';}).map(function(o){return {id:o.id,action:o.input.action,actor:o.actor,at:o.at};});
  data.history=history.slice(-100).reverse().map(function(o){return {id:o.id,action:o.input.action,actor:o.actor,at:o.at,status:o.status,target:o.input.requestId||o.input.id||o.input.key||o.input.action};});
  return data;
}
function ac_requireRoster_(input){var meta=ac_meta_();if(!meta||!input.rosterFingerprint||input.rosterFingerprint!==meta.fingerprint)ac_error_('ROSTER_PENDING');}
function ac_currentPerson_(id){var p=member_(id);if(!p.rosterKey||!p.active)ac_error_('INVALID','Adminの名簿で現在の在籍と人物対応が確認できる人を選んでください。');return p;}
function ac_validate_(input,actor){
  var action=input.action,s=readSettings_(),events=jsonRows_('取引記録');
  function bad(message){ac_error_('INVALID',message);}
  function str(key,max,required){if(typeof input[key]!=='string'||input[key].length>max||/\u0000/.test(input[key])||(required&&!input[key].trim()))bad('入力内容の形式・文字数を確認してください。');}
  try {
    if(action==='transaction'){
      ['date','type','description','account','from','to','memberId','advanceId','notes'].forEach(function(k){str(k,k==='notes'?3000:200,k==='description'||k==='date'||k==='type');});
      if(input.date>today_())bad('今日までの日付で登録してください。');
      if(['advance','openingAdvance'].indexOf(input.type)>=0){ac_requireRoster_(input);ac_currentPerson_(input.memberId);}
      if(input.type==='refund')member_(input.memberId);
      var row={id:'TX-'+input.operationId,date:input.date,type:input.type,description:input.description,amount:input.amount,account:input.account,from:input.from,to:input.to,memberId:input.memberId,advanceId:input.advanceId,notes:input.notes,createdAt:stamp_(),actor:actor};
      Accounting.build(s,events.concat([row]));
    }else if(action==='check'){
      if(input.date>today_())bad('今日までの日付で登録してください。');
      Accounting.reconcile(s,events,jsonRows_('残高確認記録').concat([{date:input.date,account:input.account,actual:input.actual}]));
    }else if(action==='settings'){
      str('note',3000,false);var next={startDate:input.startDate,bankOpening:input.bankOpening,cashOpening:input.cashOpening,fiscalYear:input.fiscalYear};
      Accounting.validateSettings(next);if(next.startDate>today_()||!Number.isInteger(next.fiscalYear)||next.fiscalYear<2000||next.fiscalYear>2200)bad('開始日・表示年度を確認してください。');
      Accounting.build(next,events);Accounting.reconcile(next,events,jsonRows_('残高確認記録'));
    }else if(action==='cancel'){
      str('reason',1000,true);var e=events.find(function(e){return e.id===input.id;});if(!e)ac_error_('NOT_FOUND');
      if(!e.canceledAt){e.canceledAt=stamp_();Accounting.build(s,events);}
    }else if(action==='review'){
      str('note',1000,false);var r=requests_().find(function(r){return r.id===input.requestId;});if(!r)ac_error_('NOT_FOUND');
      if(r.status!=='未承認')ac_error_('CONFLICT');
      var original=events.find(function(e){return e.sourceRequestId===r.id;});
      if(input.decision==='reject'){if(!input.note)bad('却下理由を入力してください。');if(original)bad('計上済みの申請です。承認を再確認してください。');}
      else if(input.decision==='approve'){
        ac_requireRoster_(input);var p=ac_currentPerson_(input.memberId);
        if(jsonRows_('人物対応').some(function(other){return other.id!==p.id&&(other.siteUserIds||[]).indexOf(r.websiteUserId)>=0;}))bad('Adminの名簿で連携されている人物と異なります。');
        if(original&&(original.memberId!==p.id||original.canceledAt))bad('既存の計上内容を確認してください。');
        if(!original)Accounting.build(s,events.concat([{id:'REQ-'+r.id,date:r.date,type:'advance',description:r.description,amount:r.amount,memberId:p.id,sourceRequestId:r.id,createdAt:stamp_(),actor:actor}]));
      }else bad('承認または却下を選択してください。');
    }else if(action==='resolveRoster'){
      ac_requireRoster_(input);ac_resolution_(input);
    }else if(action!=='refresh')bad('対応していない操作です。');
  }catch(error){if(error.accountingCode)throw error;bad(error.message);}
}
function ac_execute_(input,actor){
  input=Object.assign({},input,{token:input.operationId});
  if(input.action==='transaction')registerTransaction_(input,actor);
  else if(input.action==='review')reviewRequest_(input,actor);
  else if(input.action==='cancel')cancelTransaction_(input,actor);
  else if(input.action==='check')registerCheck_(input,actor);
  else if(input.action==='settings')saveSettings_(input);
  else if(input.action==='resolveRoster')ac_resolve_(input);
}
function ac_complete_(operation,index){
  ac_execute_(operation.input,operation.actor);SpreadsheetApp.flush();
  operation.status='done';operation.completedAt=stamp_();
  sheet_(AC_HISTORY_).getRange(index+2,1).setValue(JSON.stringify(operation));SpreadsheetApp.flush();
}
function ac_inputFingerprint_(input){var copy=Object.assign({},input,{actor:{id:input.actor.id}});delete copy.rosterFingerprint;return digest_(ac_canonical_(copy));}
function ac_action_(input,actor){
  if(typeof input.operationId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.operationId)||typeof input.expectedRevision!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedRevision))ac_error_('INVALID','画面を読み直してください。');
  var history=ac_history_(),fingerprint=ac_inputFingerprint_(input),index=history.findIndex(function(o){return o.id===input.operationId;}),warning='';
  if(input.action==='recover'){
    history.forEach(function(o,i){if(o.status==='pending')ac_complete_(o,i);});
  }else if(index>=0){
    var existing=history[index];if(existing.fingerprint!==fingerprint)ac_error_('CONFLICT');
    if(existing.status==='pending')ac_complete_(existing,index);
  }else{
    if(history.some(function(o){return o.status==='pending';}))ac_error_('PENDING');
    if(ac_revision_()!==input.expectedRevision)ac_error_('CONFLICT');
    ac_validate_(input,actor);
    var operation={id:input.operationId,fingerprint:fingerprint,actor:actor,at:stamp_(),input:input,status:'pending'};
    appendJson_(AC_HISTORY_,operation);SpreadsheetApp.flush();ac_complete_(operation,history.length);
  }
  try{renderReports_();}catch(error){warning='操作は記録済みですが、集計を更新できませんでした。設定を確認して再集計してください。';}
  return {ok:true,data:ac_data_(),warning:warning};
}
/* Plan against the complete snapshot before updating anyone. This makes matches
   independent of row order and prevents two roster records taking one person. */
function ac_rosterMatches_(records,members){
  var matches=Object.create(null),byName=Object.create(null),byLine=Object.create(null),rowBest=Object.create(null),personBest=Object.create(null);
  function norm(value){return Accounting.normalize(value);}
  function add(index,key,value){if(key)(index[key]||(index[key]=[])).push(value);}
  function best(index,key,score,value){var old=index[key];if(!old||score>old.score)index[key]={score:score,values:[value]};else if(score===old.score)old.values.push(value);}
  members.forEach(function(p){add(byName,norm(p.name),p);add(byLine,norm(p.lineName),p);});
  records.forEach(function(r){
    var name=norm(r.name),line=norm(r.lineName),university=norm(r.university);
    (byName[name]||[]).forEach(function(p){
      var previousUniversity=norm(p.university);
      if(university&&previousUniversity&&university!==previousUniversity)return;
      var score=line&&line===norm(p.lineName)?3:university&&university===previousUniversity?2:1;
      best(rowBest,r.key,score,p);best(personBest,p.id,score,r);
    });
  });
  records.forEach(function(r){
    if(r.uncertain)return;
    var bound=members.filter(function(p){return p.rosterKey===r.key;});
    if(bound.length){if(bound.length===1)matches[r.key]={person:bound[0],method:'existing'};return;}
    var linked=members.filter(function(p){return(p.legacySiteUserIds||[]).some(function(id){return r.siteUserIds.indexOf(id)>=0;});});
    if(linked.length){if(linked.length===1&&!linked[0].rosterKey)matches[r.key]={person:linked[0],method:'site-user'};return;}
    var names=byName[norm(r.name)]||[],lines=byLine[norm(r.lineName)]||[];
    // A unique LINE name pointing to a different full name is conflicting evidence.
    if(lines.length===1&&norm(lines[0].name)!==norm(r.name))return;
    var candidate=rowBest[r.key];
    if(candidate&&candidate.values.length===1){
      var p=candidate.values[0],reverse=personBest[p.id];
      if(!p.rosterKey&&reverse.values.length===1&&reverse.values[0].key===r.key)matches[r.key]={person:p,method:({1:'name',2:'name-university',3:'name-line'})[candidate.score]};
    }else if(!names.length&&!lines.length)matches[r.key]={person:ac_newPerson_(r),method:'new'};
  });
  // Confirmed account links take precedence over textual matches; never assign a
  // person twice even when an old account link points to a renamed roster entry.
  var claims=Object.create(null);
  records.forEach(function(r){var match=matches[r.key];if(match)add(claims,match.person.id,{key:r.key,match:match});});
  Object.keys(claims).forEach(function(id){var rows=claims[id];if(rows.length<2)return;var authoritative=rows.filter(function(row){return row.match.method==='existing'||row.match.method==='site-user';});rows.forEach(function(row){if(authoritative.length!==1||row!==authoritative[0])delete matches[row.key];});});
  return matches;
}
function ac_syncRoster_(snapshot){
  if(!snapshot||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<1||typeof snapshot.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.fingerprint)||typeof snapshot.title!=='string'||snapshot.title.length>500||typeof snapshot.source!=='string'||snapshot.source.length>2000||typeof snapshot.fetchedAt!=='string'||!Array.isArray(snapshot.records)||snapshot.records.length>10000)ac_error_('INVALID');
  var keys={},users={};snapshot.records.forEach(function(r){
    if(!r||typeof r.key!=='string'||!r.key||r.key.length>200||keys[r.key]||typeof r.name!=='string'||!r.name||r.name.length>200||typeof r.university!=='string'||r.university.length>200||typeof r.lineName!=='string'||r.lineName.length>200||typeof r.active!=='boolean'||typeof r.uncertain!=='boolean'||!Array.isArray(r.siteUserIds)||r.siteUserIds.length>1)ac_error_('INVALID');
    keys[r.key]=true;r.siteUserIds.forEach(function(id){if(typeof id!=='string'||!id||id.length>200||users[id])ac_error_('INVALID');users[id]=true;});
  });
  var previous=ac_meta_();if(previous&&snapshot.revision<previous.revision)ac_error_('CONFLICT');
  if(previous&&snapshot.revision===previous.revision){if(snapshot.fingerprint!==previous.fingerprint)ac_error_('CONFLICT');if(previous.matchingVersion===2)return;}
  if(ac_history_().some(function(o){return o.status==='pending';}))ac_error_('PENDING');
  var members=jsonRows_('人物対応'),pending=[];
  members.forEach(function(p){if(!p.legacySiteUserIds)p.legacySiteUserIds=(p.siteUserIds||[]).slice();p.active=false;p.siteUserIds=[];});
  var matches=ac_rosterMatches_(snapshot.records,members);
  snapshot.records.forEach(function(r){
    var match=matches[r.key],p=match&&match.person;
    if(!p){pending.push({shared:true,record:r,reason:r.uncertain?'Adminの名簿管理で本人・在籍状況を確認してください。':'氏名・LINE名・大学名で一意に対応できませんでした。過去の会計人物との対応を確認してください。'});return;}
    if(members.indexOf(p)<0)members.push(p);
    if(match.method!=='existing')p.rosterMatch={method:match.method,matchedAt:stamp_()};
    ac_person_(p,r);
  });
  writeJsonRows_('人物対応',members);writeJsonRows_('名簿確認',pending);writeJsonRows_(AC_ROSTER_,snapshot.records);SpreadsheetApp.flush();
  PropertiesService.getScriptProperties().setProperty('ACCOUNTING_ROSTER_META',JSON.stringify({revision:snapshot.revision,fingerprint:snapshot.fingerprint,source:snapshot.source,title:snapshot.title,fetchedAt:snapshot.fetchedAt,syncedAt:stamp_(),matchingVersion:2}));
}
function ac_newPerson_(r){return {id:'P-SITE-'+digest_(r.key).slice(0,32),sourceKeys:[],academicKeys:[],siteUserIds:[],createdAt:stamp_()};}
function ac_person_(person,row){person.rosterKey=row.key;person.name=row.name;person.university=row.university;person.lineName=row.lineName;person.active=row.active;person.siteUserIds=row.siteUserIds.slice();}
function ac_resolution_(input){
  var row=jsonRows_(AC_ROSTER_).find(function(r){return r.key===input.key;});if(!row)ac_error_('NOT_FOUND');if(row.uncertain)ac_error_('ROSTER_PENDING');
  var members=jsonRows_('人物対応'),mapped=members.find(function(p){return p.rosterKey===row.key;}),id=input.memberId==='new'?ac_newPerson_(row).id:input.memberId;
  if(mapped){if(mapped.id!==id)ac_error_('CONFLICT');return {row:row,person:mapped,members:members};}
  var person=input.memberId==='new'?ac_newPerson_(row):members.find(function(p){return p.id===id;});
  if(!person||person.rosterKey)ac_error_('INVALID','未対応の会計人物を選択してください。');
  return {row:row,person:person,members:members};
}
function ac_resolve_(input){
  var resolved=ac_resolution_(input);ac_person_(resolved.person,resolved.row);
  if(!resolved.members.some(function(p){return p.id===resolved.person.id;}))resolved.members.push(resolved.person);
  writeJsonRows_('人物対応',resolved.members);
  writeJsonRows_('名簿確認',jsonRows_('名簿確認').filter(function(p){return p.record.key!==input.key;}));
}

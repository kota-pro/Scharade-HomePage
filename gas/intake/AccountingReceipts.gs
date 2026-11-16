/* Called only after verification with ACCOUNTING_ADMIN_WEBHOOK_SECRET. */
function accountingReceiptRead_(p,config){
  function response(value){return Object.assign({gatewayVersion:1,envelopeVersion:2},value);}
  if(!p.actor||['executive','admin'].indexOf(p.actor.role)<0||typeof p.actor.id!=='string'||!p.actor.id)return response({ok:false,code:'UNAUTHORIZED'});
  if(!/^ADV-[a-f0-9]{32}$/.test(p.requestId||''))return response({ok:false,code:'NOT_FOUND'});
  var sheet=SpreadsheetApp.openById(config.getProperty('SPREADSHEET_ID')).getSheetByName('立替申請'),last=sheet.getLastRow();
  if(last<2)return response({ok:false,code:'NOT_FOUND'});
  var found=sheet.getRange(2,1,last-1,1).createTextFinder(p.requestId).matchEntireCell(true).findNext();
  if(!found)return response({ok:false,code:'NOT_FOUND'});
  var match=String(sheet.getRange(found.getRow(),13).getValue()).match(/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,200})\/view$/);
  if(!match)return response({ok:false,code:'NOT_FOUND'});
  var folder=config.getProperty('RECEIPT_FOLDER_ID'),meta;
  try{meta=Drive.Files.get(match[1],{fields:'id,name,trashed,mimeType,size,parents,appProperties'});}catch(error){return response({ok:false,code:'NOT_FOUND'});}
  if(!folder||meta.trashed||(meta.parents||[]).indexOf(folder)<0||!meta.appProperties||!/^REC-[a-f0-9]{32}$/.test(meta.appProperties.receiptId||'')||!/^[a-f0-9]{64}$/.test(meta.appProperties.sha256||'')||['image/jpeg','image/png','image/webp','application/pdf'].indexOf(meta.mimeType)<0||Number(meta.size)<1||Number(meta.size)>10*1024*1024)return response({ok:false,code:'NOT_FOUND'});
  var fetched=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+match[1]+'?alt=media',{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},followRedirects:false,muteHttpExceptions:true});
  if(fetched.getResponseCode()!==200)return response({ok:false,code:'RETRY'});
  var bytes=fetched.getContent(),digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  if(bytes.length!==Number(meta.size)||digest!==meta.appProperties.sha256)return response({ok:false,code:'RETRY'});
  return response({ok:true,data:Utilities.base64Encode(bytes),mimeType:meta.mimeType,size:bytes.length,name:meta.name});
}

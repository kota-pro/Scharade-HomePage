/*
 * Signed server-only gateway. Execute as the operating Google account,
 * allow anonymous HTTP access, and set WEBHOOK_SECRET in Script Properties.
 * Enable Forms API and Drive API in the linked standard Cloud project.
 */
function doPost(e) {
  function reply(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
  try {
    var cfg = PropertiesService.getScriptProperties(), secret = cfg.getProperty('WEBHOOK_SECRET');
    if (!secret || secret.length < 32 || !e || !e.postData || e.postData.contents.length > 2 * 1024 * 1024) return reply({ ok: false, code: 'NOT_CONFIGURED' });
    var envelope = JSON.parse(e.postData.contents);
    if (!envelope || envelope.version !== 2 || typeof envelope.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(envelope.nonce) || typeof envelope.timestamp !== 'string' || !/^\d{13}$/.test(envelope.timestamp) || Math.abs(Date.now() - Number(envelope.timestamp)) > 300000 || typeof envelope.payload !== 'string' || envelope.payload.length > 1900000 || typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/i.test(envelope.signature)) return reply({ ok: false, code: 'INVALID' });
    var expected = Utilities.computeHmacSha256Signature('v2\n' + envelope.timestamp + '\n' + envelope.nonce + '\n' + envelope.payload, secret, Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    if (!same_(expected, envelope.signature.toLowerCase())) return reply({ ok: false, code: 'UNAUTHORIZED' });
    if (!reserveSecurityNonce_(envelope.nonce)) return reply({ ok: false, code: 'REPLAY' });
    var payload = JSON.parse(envelope.payload);
    if (!payload || typeof payload.action !== 'string') return reply({ ok: false, code: 'INVALID' });
    if (payload.action === 'health') return reply(health_());
    if (payload.action === 'exhibition.delete') return reply(deleteExhibition_(payload));
    if (payload.action === 'form.create') return reply(createForm_(payload));
    if (payload.action === 'response.submit') return reply(submitResponses_(payload));
    if (payload.action === 'folders.ensure') return reply(withDriveLock_(function() { return ensureFolders_(payload); }));
    if (payload.action === 'file.begin') return reply(withDriveLock_(function() { return beginFile_(payload); }));
    if (payload.action === 'file.chunk') return reply(withDriveLock_(function() { return chunkFile_(payload); }));
    if (payload.action === 'shift.sheet.sync') return reply(syncShiftSheet_(payload));
    if (payload.action === 'sheet.read') return reply(readSheet_(payload));
    return reply({ ok: false, code: 'INVALID' });
  } catch (error) {
    console.log('exhibition-gas: request failed');
    return reply({ ok: false, code: 'FAILED' });
  }
}
function same_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0; for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function formsFetch_(path, method, body) {
  var options = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Type': 'application/json' }, muteHttpExceptions: true };
  if (body) options.payload = JSON.stringify(body);
  var response = UrlFetchApp.fetch('https://forms.googleapis.com/v1/' + path, options), code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('forms-' + code);
  return JSON.parse(response.getContentText() || '{}');
}
function health_() {
  var response = UrlFetchApp.fetch('https://forms.googleapis.com/v1/forms/exhibition_connection_probe', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if ([400, 404].indexOf(response.getResponseCode()) < 0) throw new Error('forms-health-' + response.getResponseCode());
  DriveApp.getRootFolder().getId();
  var about = driveJson_('about?fields=user(emailAddress)', 'get');
  return { ok: true, gatewayVersion: 3, envelopeVersion: 2, formsApi: true, driveApi: true, owner: about.user.emailAddress, shiftSheets: true, yearFolderSuffix: '年' };
}
// Read-only editor check; this also opens Google's authorization flow if needed.
function checkConnection() {
  var result = health_();
  console.log(JSON.stringify(result));
  return result;
}
function text_(value, max, required) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value) || (required && !value.trim())) throw new Error('invalid');
  return value.trim();
}
function assertExhibitionActive_(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || PropertiesService.getScriptProperties().getProperty('DELETED_' + id)) throw new Error('exhibition-deleted');
}
function formFingerprint_(title, fields) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify([title, fields]), Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function createForm_(p) {
  var title = text_(p.title, 200, true), exhibitionId = text_(p.exhibitionId, 100, true), version = p.schemaVersion;
  assertExhibitionActive_(exhibitionId);
  if (!Number.isSafeInteger(version) || version < 1 || !Array.isArray(p.fields) || !p.fields.length || p.fields.length > 140) throw new Error('invalid');
  var ids = {};
  p.fields.forEach(function(f) {
    if (!f || typeof f.id !== 'string' || !/^(?:[a-zA-Z]+|field:[a-f0-9-]{36})$/.test(f.id) || ids[f.id] || typeof f.paragraph !== 'boolean' || typeof f.required !== 'boolean') throw new Error('invalid');
    text_(f.title, 200, true); ids[f.id] = true;
  });
  return withDriveLock_(function() {
    assertExhibitionActive_(exhibitionId);
    var cfg = PropertiesService.getScriptProperties(), mainKey = 'FORM_MAIN_' + exhibitionId, key = 'EXHIBITION_' + exhibitionId + '_' + version;
    var state = JSON.parse(cfg.getProperty(mainKey) || '{}'), old = JSON.parse(cfg.getProperty(key) || '{}');
    if (!state.formId) {
      var candidate = p.formId || (old.complete && old.complete.formId) || old.formId;
      if (candidate) {
        var owner = JSON.parse(cfg.getProperty('FORM_' + candidate) || '{}');
        if (owner.exhibitionId && owner.exhibitionId !== exhibitionId) throw new Error('form-owner');
        if (!owner.exhibitionId && candidate !== old.formId && candidate !== (old.complete && old.complete.formId)) throw new Error('form-owner');
        state = { formId: candidate, spreadsheetId: p.spreadsheetId || (old.complete && old.complete.spreadsheetId) || old.spreadsheetId };
        var adopted = old.complete || JSON.parse(cfg.getProperty('EXHIBITION_' + exhibitionId + '_' + owner.schemaVersion) || '{}').complete;
        if (adopted && adopted.formId === candidate) cfg.setProperty('FORM_ITEMS_' + candidate, JSON.stringify(adopted.itemIds));
      } else state.formId = formsFetch_('forms', 'post', { info: { title: title, documentTitle: title } }).formId;
      cfg.setProperty(mainKey, JSON.stringify(state));
    }
    if (p.formId && p.formId !== state.formId) throw new Error('form-mismatch');
    if (state.schemaVersion > version) throw new Error('form-stale');
    var fingerprint = formFingerprint_(title, p.fields), model = formsFetch_('forms/' + encodeURIComponent(state.formId), 'get');
    var appForm = FormApp.openById(state.formId), appItems = appForm.getItems(), working = (model.items || []).slice();
    if (appItems.length !== working.length) throw new Error('form-items');
    var previous = JSON.parse(cfg.getProperty('FORM_ITEMS_' + state.formId) || '{}'), byApi = {};
    Object.keys(previous).forEach(function(fieldId) {
      for (var i = 0; i < appItems.length; i++) if (appItems[i].getId() === previous[fieldId]) byApi[fieldId] = working[i].itemId;
    });
    var pending = JSON.parse(cfg.getProperty('FORM_PENDING_' + exhibitionId) || '{}');
    var matches = working.length === p.fields.length && p.fields.every(function(f, i) {
      var item = working[i], question = item && item.questionItem && item.questionItem.question;
      return item && item.title === f.title && question && !!question.required === f.required && question.textQuestion && !!question.textQuestion.paragraph === f.paragraph;
    });
    if (!(matches && (state.fingerprint === fingerprint || pending.fingerprint === fingerprint))) {
      var requests = [{ updateFormInfo: { info: { title: title }, updateMask: 'title' } }];
      var wanted = p.fields.map(function(f) { return byApi[f.id]; }).filter(Boolean);
      for (var n = working.length - 1; n >= 0; n--) if (wanted.indexOf(working[n].itemId) < 0) { requests.push({ deleteItem: { location: { index: n } } }); working.splice(n, 1); }
      p.fields.forEach(function(f, index) {
        var apiId = byApi[f.id], existingIndex = working.findIndex(function(item) { return apiId && item.itemId === apiId; });
        var item = { title: f.title, questionItem: { question: { required: f.required, textQuestion: { paragraph: f.paragraph } } } };
        if (existingIndex >= 0) {
          if (existingIndex !== index) { requests.push({ moveItem: { originalLocation: { index: existingIndex }, newLocation: { index: index } } }); working.splice(index, 0, working.splice(existingIndex, 1)[0]); }
          item.itemId = working[index].itemId; item.questionItem.question.questionId = working[index].questionItem.question.questionId;
          requests.push({ updateItem: { item: item, location: { index: index }, updateMask: 'title,questionItem.question.required,questionItem.question.textQuestion' } });
        } else { requests.push({ createItem: { item: item, location: { index: index } } }); working.splice(index, 0, item); }
      });
      cfg.setProperty('FORM_PENDING_' + exhibitionId, JSON.stringify({ fingerprint: fingerprint }));
      formsFetch_('forms/' + encodeURIComponent(state.formId) + ':batchUpdate', 'post', { requests: requests, writeControl: { requiredRevisionId: model.revisionId } });
    }
    appForm = FormApp.openById(state.formId); appItems = appForm.getItems();
    if (appItems.length !== p.fields.length) throw new Error('form-items');
    var itemIds = {};
    p.fields.forEach(function(f, index) { if (appItems[index].getTitle() !== f.title) throw new Error('form-items'); itemIds[f.id] = appItems[index].getId(); });
    var destinationId = formsFetch_('forms/' + encodeURIComponent(state.formId), 'get').linkedSheetId;
    if (!state.spreadsheetId) { state.spreadsheetId = destinationId || SpreadsheetApp.create(title + '（回答）').getId(); cfg.setProperty(mainKey, JSON.stringify(state)); }
    if (p.spreadsheetId && p.spreadsheetId !== state.spreadsheetId) throw new Error('sheet-mismatch');
    if (destinationId !== state.spreadsheetId) appForm.setDestination(FormApp.DestinationType.SPREADSHEET, state.spreadsheetId);
    var spreadsheet = SpreadsheetApp.openById(state.spreadsheetId), log = spreadsheet.getSheetByName('__delivery');
    if (!log) { log = spreadsheet.insertSheet('__delivery'); log.appendRow(['idempotencyKey', 'responseId', 'layoutImageUrl', 'attemptedAt']); log.hideSheet(); }
    DriveApp.getFileById(state.formId).setName(title); DriveApp.getFileById(state.spreadsheetId).setName(title + '（回答）');
    if (p.year !== undefined) {
      var folders = ensureFolders_(p);
      DriveApp.getFileById(state.formId).moveTo(DriveApp.getFolderById(folders.folderId)); DriveApp.getFileById(state.spreadsheetId).moveTo(DriveApp.getFolderById(folders.folderId));
    }
    cfg.setProperty('FORM_' + state.formId, JSON.stringify({ exhibitionId: exhibitionId, schemaVersion: version }));
    cfg.setProperty('FORM_ITEMS_' + state.formId, JSON.stringify(itemIds));
    state.fingerprint = fingerprint; state.schemaVersion = version; cfg.setProperty(mainKey, JSON.stringify(state));
    cfg.deleteProperty('FORM_PENDING_' + exhibitionId);
    var complete = { ok: true, formId: state.formId, spreadsheetId: state.spreadsheetId, itemIds: itemIds };
    cfg.setProperty(key, JSON.stringify({ complete: complete })); return complete;
  });
}
function archiveAnswers_(form, row) {
  var book = SpreadsheetApp.openById(form.getDestinationId()), sheet = book.getSheetByName('提出データ');
  if (!sheet) { sheet = book.insertSheet('提出データ'); sheet.appendRow(['送信識別子', '項目名', '項目ID', '回答']); }
  var keys = Object.keys(row.answers), previous = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow()-1, 1).createTextFinder(row.idempotencyKey).matchEntireCell(true).findAll() : [];
  if (previous.length) { if (previous.length !== keys.length) throw new Error('answer-archive'); return; }
  function literal(value) { return /^[=+\-@]/.test(value) ? "'" + value : value; }
  var values = keys.map(function(key) { var answer = String(row.answers[key]); if (answer.length > 20000) throw new Error('answer-size'); return [row.idempotencyKey, literal(String((row.fieldLabels || {})[key] || key).slice(0,200)), key, literal(answer)]; });
  if (values.length) sheet.getRange(sheet.getLastRow()+1, 1, values.length, 4).setValues(values);
}
function deleteExhibition_(p) {
  if (!p || typeof p.exhibitionId !== 'string' || !/^[a-f0-9-]{36}$/.test(p.exhibitionId) || !Array.isArray(p.formIds) || !Array.isArray(p.spreadsheetIds) || !Array.isArray(p.fileIds) || p.formIds.length > 100 || p.spreadsheetIds.length > 100 || p.fileIds.length > 5000) throw new Error('invalid');
  return withDriveLock_(function() {
    var cfg = PropertiesService.getScriptProperties(), props = cfg.getProperties(), forms = [], sheets = [], folderState = JSON.parse(cfg.getProperty('FOLDERS_' + p.exhibitionId) || '{}');
    Object.keys(props).forEach(function(key) {
      if (key.indexOf('EXHIBITION_' + p.exhibitionId + '_') === 0 || key === 'FORM_MAIN_' + p.exhibitionId || key === 'SHIFT_SHEET_' + p.exhibitionId) {
        var state = JSON.parse(props[key]), record = state.complete || state;
        if (record.formId) forms.push(record.formId); if (record.spreadsheetId) sheets.push(record.spreadsheetId);
      }
      if (key.indexOf('FORM_') === 0 && key.indexOf('FORM_MAIN_') !== 0 && key.indexOf('FORM_ITEMS_') !== 0 && key.indexOf('FORM_PENDING_') !== 0) {
        var record = JSON.parse(props[key]); if (record.exhibitionId === p.exhibitionId) forms.push(key.slice(5));
      }
    });
    p.formIds.forEach(function(id) { if (forms.indexOf(id) < 0) throw new Error('delete-form-owner'); });
    p.spreadsheetIds.forEach(function(id) { if (sheets.indexOf(id) < 0) throw new Error('delete-sheet-owner'); });
    if (p.folderId && p.folderId !== folderState.folderId) throw new Error('delete-folder-owner');
    function metadata(id) { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error('file-id'); try { return driveJson_('files/' + encodeURIComponent(id) + '?fields=id,trashed,appProperties', 'get'); } catch(error) { if(String(error).indexOf('drive-404') >= 0) return null; throw error; } }
    p.fileIds.forEach(function(id) { var file = metadata(id); if (file && (!file.appProperties || file.appProperties.exhibitionId !== p.exhibitionId)) throw new Error('delete-file-owner'); });
    cfg.setProperty('DELETED_' + p.exhibitionId, 'true');
    var ids = forms.concat(sheets,p.fileIds,folderState.folderId ? [folderState.folderId] : []), unique = {};
    ids.forEach(function(id) { if(unique[id])return;unique[id]=true;var file=metadata(id);if(file && !file.trashed) driveJson_('files/' + encodeURIComponent(id),'patch',{trashed:true}); });
    return {ok:true,deleted:true};
  });
}
function deliverySheet_(form) {
  var id = form.getDestinationId(); if (!id) throw new Error('destination');
  var sheet = SpreadsheetApp.openById(id).getSheetByName('__delivery');
  if (!sheet) throw new Error('delivery-sheet');
  return sheet;
}
function delivery_(sheet, key) {
  if (sheet.getLastRow() < 2) return null;
  var match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(key).matchEntireCell(true).findNext();
  if (!match) return null;
  var row = match.getRow(), values = sheet.getRange(row, 1, 1, 4).getValues()[0];
  return { row: row, responseId: String(values[1] || ''), imageUrl: String(values[2] || ''), attemptedAt: values[3] };
}
function saveLayout_(data, key) {
  if (!data) return '';
  if (typeof data !== 'string' || data.length > 500000 || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new Error('layout');
  var bytes = Utilities.base64Decode(data);
  if (bytes.length < 8 || bytes.slice(0, 8).map(function(b) { return (b + 256) % 256; }).join(',') !== '137,80,78,71,13,10,26,10') throw new Error('layout-png');
  var folderId = PropertiesService.getScriptProperties().getProperty('LAYOUT_FOLDER_ID'), folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder(), name = 'layout-' + key + '.png';
  var existing = folder.getFilesByName(name);
  return (existing.hasNext() ? existing.next() : folder.createFile(Utilities.newBlob(bytes, 'image/png', name))).getUrl();
}
function submitResponses_(p) {
  if (typeof p.formId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(p.formId) || !p.itemIds || typeof p.itemIds !== 'object' || !Array.isArray(p.rows) || !p.rows.length || p.rows.length > 8 || !PropertiesService.getScriptProperties().getProperty('FORM_' + p.formId)) throw new Error('invalid');
  var delivered = [], lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    assertExhibitionActive_(JSON.parse(PropertiesService.getScriptProperties().getProperty('FORM_' + p.formId)).exhibitionId);
    var form = FormApp.openById(p.formId), sheet = deliverySheet_(form), items = {};
    form.getItems().forEach(function(item) { items[String(item.getId())] = item; });
    var currentItemIds = JSON.parse(PropertiesService.getScriptProperties().getProperty('FORM_ITEMS_' + p.formId) || JSON.stringify(p.itemIds));
    var keyItem = items[String(currentItemIds.deliveryKey)];
    if (!keyItem) {
      keyItem = form.getItems().filter(function(item) { return item.getTitle() === '送信識別子'; })[0] || form.addTextItem().setTitle('送信識別子');
    }
    p.rows.forEach(function(row) {
      if (!row || typeof row.idempotencyKey !== 'string' || !/^[a-f0-9-]{36}:[1-9][0-9]*:[a-f0-9-]{36}$/.test(row.idempotencyKey) || !row.answers || typeof row.answers !== 'object' || Object.keys(row.answers).length > 140) throw new Error('invalid');
      var journal = delivery_(sheet, row.idempotencyKey);
      if (journal && journal.responseId) { delivered.push(row.idempotencyKey); return; }
      // Repair a crash after FormResponse.submit() but before the journal update.
      if (journal) {
        var existing = form.getResponses(new Date(new Date(journal.attemptedAt).getTime() - 5000)).filter(function(response) {
          var answer = response.getResponseForItem(keyItem); return answer && String(answer.getResponse()) === row.idempotencyKey;
        })[0];
        if (existing) { sheet.getRange(journal.row, 2).setValue(existing.getId()); delivered.push(row.idempotencyKey); return; }
      }
      var imageUrl = journal ? journal.imageUrl : saveLayout_(row.layoutImagePng || '', row.idempotencyKey.replace(/:/g, '-'));
      if (!journal) { sheet.appendRow([row.idempotencyKey, '', imageUrl, new Date()]); journal = { row: sheet.getLastRow() }; SpreadsheetApp.flush(); }
      archiveAnswers_(form, row);
      var response = form.createResponse();
      Object.keys(currentItemIds).forEach(function(key) {
        var item = items[String(currentItemIds[key])], value = key === 'deliveryKey' ? row.idempotencyKey : key === 'layoutImage' && imageUrl ? imageUrl : row.answers[key] === undefined ? '' : String(row.answers[key]);
        if (!item || value.length > 20000) throw new Error('item');
        if (item.getType() === FormApp.ItemType.TEXT) response.withItemResponse(item.asTextItem().createResponse(value));
        else if (item.getType() === FormApp.ItemType.PARAGRAPH_TEXT) response.withItemResponse(item.asParagraphTextItem().createResponse(value));
        else throw new Error('item');
      });
      if (!currentItemIds.deliveryKey) response.withItemResponse(keyItem.asTextItem().createResponse(row.idempotencyKey));
      var submitted = response.submit();
      sheet.getRange(journal.row, 2).setValue(submitted.getId()); SpreadsheetApp.flush();
      delivered.push(row.idempotencyKey);
    });
  } finally { try { lock.releaseLock(); } catch (_) {} }
  return { ok: true, delivered: delivered };
}
function readSheet_(p) {
  if (typeof p.sourceSpreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(p.sourceSpreadsheetId)) throw new Error('invalid');
  var source = SpreadsheetApp.openById(p.sourceSpreadsheetId), sheet = source.getSheets()[0];
  if (!sheet) throw new Error('source-sheet');
  var range = sheet.getDataRange(), rows = range.getNumRows(), columns = range.getNumColumns();
  if (rows > 2001 || columns > 200 || rows * columns > 100000) throw new Error('source-size');
  var values = range.getDisplayValues();
  if (values.some(function(row) { return row.some(function(value) { return value.length > 4000; }); }) || JSON.stringify(values).length > 1900000) throw new Error('source-size');
  return { ok: true, sheetName: sheet.getName(), values: values };
}

function withDriveLock_(action) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); return action(); }
  finally { try { lock.releaseLock(); } catch (_) {} }
}
function driveJson_(path, method, body) {
  var options = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/' + path, options);
  if (r.getResponseCode() < 200 || r.getResponseCode() >= 300) throw new Error('drive-' + r.getResponseCode());
  return JSON.parse(r.getContentText() || '{}');
}
function driveOwner_() {
  var owner = driveJson_('about?fields=user(emailAddress)', 'get').user.emailAddress;
  if (owner !== 'sharadeshashinten@gmail.com') throw new Error('drive-owner');
  return owner;
}
function ensureFolders_(p) {
  assertExhibitionActive_(p.exhibitionId);
  var exhibitionId = text_(p.exhibitionId, 100, true), title = text_(p.exhibitionTitle, 150, true), year = p.year;
  if (!/^[a-f0-9-]{36}$/.test(exhibitionId) || !Number.isSafeInteger(year) || year < 2000 || year > 9999) throw new Error('folders');
  var owner = driveOwner_(), cfg = PropertiesService.getScriptProperties(), key = 'FOLDERS_' + exhibitionId, state = JSON.parse(cfg.getProperty(key) || '{}');
  function child(parent, name) { var found = parent.getFoldersByName(name); return found.hasNext() ? found.next() : parent.createFolder(name); }
  var yearFolderName = String(year) + '年', annual = child(DriveApp.getRootFolder(), yearFolderName), official = child(annual, '公式サイト');
  var folder = state.folderId ? DriveApp.getFolderById(state.folderId) : child(official, title);
  // Save the exhibition folder before creating children so interrupted retries reuse it.
  state.folderId = folder.getId(); cfg.setProperty(key, JSON.stringify(state));
  if (state.year !== year || state.title !== title || state.yearFolderName !== yearFolderName) { folder.setName(title); folder.moveTo(official); }
  state.originalsId = state.originalsId || child(folder, '作品データ').getId(); cfg.setProperty(key, JSON.stringify(state));
  state.layoutsId = state.layoutsId || child(folder, '組写真レイアウト').getId(); cfg.setProperty(key, JSON.stringify(state));
  state.outputsId = state.outputsId || child(folder, '出力資料').getId();
  state.year = year; state.title = title; state.yearFolderName = yearFolderName; cfg.setProperty(key, JSON.stringify(state));
  return { ok: true, owner: owner, folderId: state.folderId, originalsId: state.originalsId, layoutsId: state.layoutsId, outputsId: state.outputsId, yearFolderName: yearFolderName };
}
function uploadFileState_(p) {
  if (!p || typeof p.key !== 'string' || !/^[a-f0-9-]{36}$/.test(p.key) || typeof p.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.sha256)) throw new Error('file-key');
  var cfg = PropertiesService.getScriptProperties(), key = 'FILE_' + p.key, state = JSON.parse(cfg.getProperty(key) || '{}');
  if (state.sha256 && state.sha256 !== p.sha256) throw new Error('file-checksum');
  return { cfg: cfg, key: key, state: state };
}
function existingFile_(key, sha256) {
  var q = "trashed = false and appProperties has { key='exhibitionFileKey' and value='" + key + "' }";
  var files = driveJson_('files?q=' + encodeURIComponent(q) + '&fields=files(id,webViewLink,size,appProperties)&pageSize=2', 'get').files || [];
  if (files.length > 1) throw new Error('file-duplicate');
  if (!files.length) return null;
  if (files[0].appProperties.sha256 !== sha256) throw new Error('file-checksum');
  return files[0];
}
function completeFile_(record, file) {
  record.state.fileId = file.id; record.state.url = file.webViewLink || 'https://drive.google.com/file/d/' + file.id + '/view';
  delete record.state.session; record.cfg.setProperty(record.key, JSON.stringify(record.state));
  return { ok: true, done: true, owner: 'sharadeshashinten@gmail.com', fileId: record.state.fileId, url: record.state.url };
}
function sessionResponse_(record, response) {
  var code = response.getResponseCode();
  if (code === 200 || code === 201) return completeFile_(record, JSON.parse(response.getContentText()));
  if (code === 404 || code === 410) { delete record.state.session; record.cfg.setProperty(record.key, JSON.stringify(record.state)); return null; }
  if (code !== 308) throw new Error('drive-upload-' + code);
  var headers = response.getAllHeaders(), range = headers.Range || headers.range || '', match = /^bytes=0-(\d+)$/.exec(String(range));
  var offset = match ? Number(match[1]) + 1 : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= record.state.size) throw new Error('drive-offset');
  return { ok: true, done: false, offset: offset };
}
function uploadStatus_(record) {
  if (!record.state.session) return null;
  return sessionResponse_(record, UrlFetchApp.fetch(record.state.session, { method: 'put', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Range': 'bytes */' + record.state.size }, payload: '', followRedirects: false, muteHttpExceptions: true }));
}
function beginFile_(p) {
  var record = uploadFileState_(p), state = record.state;
  assertExhibitionActive_(p.exhibitionId); state.exhibitionId = p.exhibitionId;
  driveOwner_();
  if (!Number.isSafeInteger(p.size) || p.size < 1 || p.size > 80 * 1024 * 1024 || ['image/jpeg', 'image/png', 'image/svg+xml', 'application/pdf'].indexOf(p.mimeType) < 0 || ['originals', 'layouts', 'outputs'].indexOf(p.category) < 0) throw new Error('file-size');
  if (state.size && state.size !== p.size) throw new Error('file-size');
  state.sha256 = p.sha256; state.size = p.size;
  if (state.fileId) return completeFile_(record, { id: state.fileId, webViewLink: state.url });
  var existing = existingFile_(p.key, p.sha256);
  if (existing) return completeFile_(record, existing);
  var progress = uploadStatus_(record);
  if (progress) return progress;
  var folders = ensureFolders_(p), folderId = folders[p.category + 'Id'];
  var metadata = { name: text_(p.name, 180, true), mimeType: p.mimeType, parents: [folderId], appProperties: { exhibitionFileKey: p.key, sha256: p.sha256, exhibitionId: p.exhibitionId } };
  var response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': p.mimeType, 'X-Upload-Content-Length': String(p.size) }, payload: JSON.stringify(metadata), followRedirects: false, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('drive-begin-' + response.getResponseCode());
  var headers = response.getAllHeaders(), session = String(headers.Location || headers.location || '');
  if (!/^https:\/\/(?:www\.googleapis\.com|content\.googleapis\.com)\/upload\/drive\/v3\/files\?/.test(session)) throw new Error('drive-session');
  state.session = session; state.mimeType = p.mimeType; state.size = p.size; state.sha256 = p.sha256; record.cfg.setProperty(record.key, JSON.stringify(state));
  return { ok: true, done: false, offset: 0 };
}
function chunkFile_(p) {
  var record = uploadFileState_(p), state = record.state;
  assertExhibitionActive_(state.exhibitionId);
  if (state.fileId) return completeFile_(record, { id: state.fileId, webViewLink: state.url });
  if (!state.session || !Number.isSafeInteger(p.offset) || p.offset < 0 || typeof p.data !== 'string' || p.data.length > 1400000 || !/^[A-Za-z0-9+/=]+$/.test(p.data)) throw new Error('file-chunk');
  var progress = uploadStatus_(record);
  if (!progress) throw new Error('file-session-expired');
  if (progress.done || progress.offset !== p.offset) return progress;
  var bytes = Utilities.base64Decode(p.data);
  if (!bytes.length || bytes.length > 1024 * 1024 || p.offset + bytes.length > state.size || (p.offset + bytes.length < state.size && bytes.length % (256 * 1024) !== 0)) throw new Error('file-chunk-size');
  var response = UrlFetchApp.fetch(state.session, { method: 'put', contentType: state.mimeType || 'application/octet-stream', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'Content-Range': 'bytes ' + p.offset + '-' + (p.offset + bytes.length - 1) + '/' + state.size }, payload: bytes, followRedirects: false, muteHttpExceptions: true });
  var result = sessionResponse_(record, response);
  if (!result) throw new Error('file-session-expired');
  return result;
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

/** Separate from FORM_MAIN_: reuses one shift spreadsheet and never touches photo form answers. */
function syncShiftSheet_(p) {
  assertExhibitionActive_(p.exhibitionId);
  if (!Number.isSafeInteger(p.revision) || p.revision < 1 || !Array.isArray(p.people) || !Array.isArray(p.responses) || !Array.isArray(p.slots) || p.people.length > 20000 || p.slots.length > 9000) throw new Error('shift-input');
  return withDriveLock_(function() {
    assertExhibitionActive_(p.exhibitionId);
    var owner = driveOwner_(), cfg = PropertiesService.getScriptProperties(), key = 'SHIFT_SHEET_' + p.exhibitionId, state = JSON.parse(cfg.getProperty(key) || '{}'), folders = ensureFolders_(p);
    if (!state.spreadsheetId) {
      // Drive appProperties make a crash between create and property-save recoverable.
      var q = "trashed = false and appProperties has { key='exhibitionShiftId' and value='" + p.exhibitionId + "' }";
      var found = driveJson_('files?q=' + encodeURIComponent(q) + '&fields=files(id)&pageSize=2', 'get').files || [];
      if (found.length > 1) throw new Error('shift-duplicate');
      state.spreadsheetId = found.length ? found[0].id : driveJson_('files?fields=id', 'post', { name: text_(p.exhibitionTitle, 150, true) + '（展示シフト）', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folders.folderId], appProperties: { exhibitionId: p.exhibitionId, exhibitionShiftId: p.exhibitionId } }).id;
      cfg.setProperty(key, JSON.stringify(state));
    }
    if ((state.revision || 0) > p.revision) throw new Error('shift-stale');
    if (state.revision === p.revision) return { ok: true, owner: owner, spreadsheetId: state.spreadsheetId, revision: p.revision };
    DriveApp.getFileById(state.spreadsheetId).setName(p.exhibitionTitle + '（展示シフト）').moveTo(DriveApp.getFolderById(folders.folderId));
    var book = SpreadsheetApp.openById(state.spreadsheetId), people = {}, slots = {};
    p.people.forEach(function(person) { people[person.id] = person; }); p.slots.forEach(function(slot) { slots[slot.id] = slot; });
    function literal(value) { var s = String(value == null ? '' : value); if (s.length > 49000) throw new Error('shift-cell'); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }
    function write(name, values) { var sheet = book.getSheetByName(name) || book.insertSheet(name); sheet.clearContents(); sheet.getRange(1, 1, values.length, values[0].length).setNumberFormat('@').setValues(values.map(function(row) { return row.map(literal); })); sheet.setFrozenRows(1); }
    var answers = [['会員ID', '名前', 'LINE名', '提出状況', '希望時間', '提出日時', '回答版']];
    p.responses.forEach(function(response) { var person = people[response.userId]; if (!person) return; var s = response.submitted; answers.push([person.id, person.name, person.lineName || '', !s ? '下書き' : s.scheduleKey !== p.scheduleKey ? '要再確認' : s.none ? '提出済み・入れる時間はない' : '提出済み', s ? (s.slotIds || []).map(function(id) { return id.replace('/', ' '); }).join(' / ') : '', s ? s.at : '', response.revision]); });
    write('希望回答', answers);
    var table = [['公開版', '日付', '開始', '終了', '担当者1', '担当者2', '不足人数']];
    if (p.published) { var names = {}; p.published.people.forEach(function(person) { names[person.id] = person.name; }); p.published.slots.forEach(function(slot) { var own = p.published.assignments.filter(function(a) { return a.slotId === slot.id; }); table.push([p.published.version, slot.date, slot.start, slot.end, own[0] ? names[own[0].personId] || '担当者' : '', own[1] ? names[own[1].personId] || '担当者' : '', 2 - own.length]); }); }
    write('確定シフト', table); SpreadsheetApp.flush();
    state.revision = p.revision; cfg.setProperty(key, JSON.stringify(state));
    return { ok: true, owner: owner, spreadsheetId: state.spreadsheetId, revision: p.revision };
  });
}

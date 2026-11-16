/* Dedicated, signed gateway. Deploy as contact@scharade.jp. Never deploy under the exhibition account. */
var CLUB_OWNER_ = "contact@scharade.jp";
var CLUB_ROOT_ = "1iJ_g3gkRoGoIb1AigDBvoPOuRivX6pWl";
var CLUB_TEMPLATES_ = {
  admission: "1wQQmvzPNlDA66-2Lu2x7_uTkwHRguTHreKoXEtnClZ0",
  continuation_spring: "1QeXfKp-_gQFRvfuuJtV5r0azKW59K7aNtiGzkTe0CVA",
  continuation_autumn: "1iHikd_Ilz8esxyR6YG9s7h08Eu4pwg22Rm9bBYtUoL8",
  welcome_photo: "1YwYANiDVlZeKQpjV2Rc2i6avk544FIixi6C-G_xG7Ms",
  welcome_meal: "1GW7Q7fLJ7DqOgVblOsYZgMweskY9vuc_y2THx6SS7EU",
};
function clubReply_(value) {
  return ContentService.createTextOutput(
    JSON.stringify(
      Object.assign({ owner: CLUB_OWNER_, rootFolderId: CLUB_ROOT_ }, value),
    ),
  ).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  try {
    var cfg = PropertiesService.getScriptProperties(),
      secret = cfg.getProperty("WEBHOOK_SECRET");
    if (
      !secret ||
      secret.length < 32 ||
      !e ||
      !e.postData ||
      e.postData.contents.length > 8 * 1024 * 1024
    )
      throw new Error("NOT_CONFIGURED");
    var envelope = JSON.parse(e.postData.contents);
    if (
      envelope.version !== 2 ||
      typeof envelope.timestamp !== "string" ||
      !/^\d{13}$/.test(envelope.timestamp) ||
      Math.abs(Date.now() - Number(envelope.timestamp)) > 300000 ||
      typeof envelope.nonce !== "string" ||
      !/^[a-f0-9]{32}$/.test(envelope.nonce) ||
      typeof envelope.payload !== "string" ||
      typeof envelope.signature !== "string" ||
      !/^[a-f0-9]{64}$/i.test(envelope.signature)
    )
      throw new Error("UNAUTHORIZED");
    var expected = Utilities.computeHmacSha256Signature(
      "v2\n" +
        envelope.timestamp +
        "\n" +
        envelope.nonce +
        "\n" +
        envelope.payload,
      secret,
      Utilities.Charset.UTF_8,
    )
      .map(clubHex_)
      .join("");
    var diff = expected.length ^ envelope.signature.length;
    for (var i = 0; i < expected.length; i++)
      diff |=
        expected.charCodeAt(i) ^
        (envelope.signature.toLowerCase().charCodeAt(i) || 0);
    if (diff) throw new Error("UNAUTHORIZED");
    clubNonce_(envelope.nonce);
    clubConnection_();
    var p = JSON.parse(envelope.payload);
    if (p.action === "health")
      return clubReply_({
        ok: true,
        gatewayVersion: 1,
        triggerReady: clubTriggerReady_(),
      });
    if (p.action === "roster.resolve")
      return clubReply_({
        ok: true,
        sources: {
          admission: clubResolve_(p.sources.admission),
          continuation: clubResolve_(p.sources.continuation),
        },
      });
    if (p.action === "roster.read") {
      clubTerm_(p.term);
      return clubReply_({
        ok: true,
        bundles: ["admission", "continuation"].map(function (kind) {
          return clubReadRoster_(p.term[kind], kind);
        }),
      });
    }
    if (p.action === "form.delete")
      return clubReply_(
        clubLock_(function () {
          return clubDelete_(p);
        }),
      );
    if (p.action === "form.mutate")
      return clubReply_(
        clubLock_(function () {
          return { ok: true, form: clubMutate_(p) };
        }),
      );
    if (p.action === "forms.status")
      return clubReply_(
        clubLock_(function () {
          if (!Array.isArray(p.ids) || p.ids.length > 50)
            throw new Error("INVALID");
          return {
            ok: true,
            forms: p.ids.map(function (id) {
              clubUuid_(id);
              var state = clubState_(id);
              if (state.deleting || state.deletedAt)
                throw new Error("FORM_DELETED");
              if (!state.complete) throw new Error("CONFLICT");
              return clubRemote_(id, state, true);
            }),
          };
        }),
      );
    if (p.action === "roster.export")
      return clubReply_(
        clubLock_(function () {
          return clubExport_(p);
        }),
      );
    throw new Error("INVALID");
  } catch (error) {
    var code = String((error && error.message) || "FAILED");
    if (
      [
        "NOT_CONFIGURED",
        "UNAUTHORIZED",
        "REPLAY",
        "INVALID",
        "INVALID_SOURCE",
        "INVALID_ROSTER",
        "TEMPLATE_CHANGED",
        "OWNER_MISMATCH",
        "CONFLICT",
        "RECONCILING",
        "UPLOAD_SETUP_REQUIRED",
        "UPLOAD_CHECK_FAILED",
        "FORM_DELETED",
        "DELETE_CHECK_FAILED",
        "CAPACITY_TRIGGER_FAILED",
      ].indexOf(code) < 0
    )
      code = "FAILED";
    return clubReply_({ ok: false, code: code });
  }
}
function clubHex_(b) {
  return ("0" + ((b + 256) % 256).toString(16)).slice(-2);
}
function clubHash_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(value),
    Utilities.Charset.UTF_8,
  )
    .map(clubHex_)
    .join("");
}
function clubNorm_(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .toLowerCase();
}
function clubLock_(callback) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    return callback();
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
function clubNonce_(nonce) {
  clubLock_(function () {
    var cfg = PropertiesService.getScriptProperties(),
      values = cfg.getProperties(),
      now = Date.now(),
      count = 0,
      key = "CLUB_NONCE_" + nonce;
    if (Number(values[key]) > now) throw new Error("REPLAY");
    Object.keys(values).forEach(function (key) {
      if (key.indexOf("CLUB_NONCE_") !== 0) return;
      if (Number(values[key]) <= now) cfg.deleteProperty(key);
      else count++;
    });
    if (count >= 2000) throw new Error("FAILED");
    cfg.setProperty(key, String(now + 600000));
  });
}
function clubConnection_() {
  var user = Drive.About.get({ fields: "user(emailAddress)" }).user;
  var root = Drive.Files.get(CLUB_ROOT_, {
    fields: "id,mimeType,trashed,capabilities(canAddChildren)",
  });
  if (
    !user ||
    user.emailAddress !== CLUB_OWNER_ ||
    root.trashed ||
    root.mimeType !== "application/vnd.google-apps.folder" ||
    root.capabilities.canAddChildren !== true
  )
    throw new Error("OWNER_MISMATCH");
}
function clubTriggerReady_() {
  return ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === "closeDueClubForms";
  });
}
/** Run once as contact@scharade.jp, after setting WEBHOOK_SECRET in Script Properties. Never logs the secret. */
function initializeClubForms() {
  clubConnection_();
  var secret =
    PropertiesService.getScriptProperties().getProperty("WEBHOOK_SECRET");
  if (!secret || secret.length < 32)
    throw new Error(
      "Set WEBHOOK_SECRET (at least 32 characters) in Script Properties.",
    );
  if (!clubTriggerReady_())
    ScriptApp.newTrigger("closeDueClubForms")
      .timeBased()
      .everyMinutes(1)
      .create();
  console.log(
    JSON.stringify({
      owner: CLUB_OWNER_,
      rootFolderId: CLUB_ROOT_,
      triggerReady: clubTriggerReady_(),
    }),
  );
}
function clubUuid_(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new Error("INVALID");
  return value;
}
function clubId_(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(value))
    throw new Error("INVALID_SOURCE");
  return value;
}
function clubSheet_(source) {
  if (!source || !Number.isSafeInteger(source.sheetId) || source.sheetId < 0)
    throw new Error("INVALID_SOURCE");
  clubId_(source.spreadsheetId);
  return source;
}
function clubTerm_(term) {
  if (
    !term ||
    !Number.isSafeInteger(term.year) ||
    term.year < 2000 ||
    term.year > 9999 ||
    ["spring", "autumn"].indexOf(term.season) < 0
  )
    throw new Error("INVALID");
  if (term.admission || term.continuation) {
    clubSheet_(term.admission);
    clubSheet_(term.continuation);
    if (
      term.admission.spreadsheetId === term.continuation.spreadsheetId &&
      term.admission.sheetId === term.continuation.sheetId
    )
      throw new Error("INVALID_SOURCE");
  }
}
function clubState_(id) {
  return JSON.parse(
    PropertiesService.getScriptProperties().getProperty("CLUB_FORM_" + id) ||
      "{}",
  );
}
function clubSave_(id, state) {
  PropertiesService.getScriptProperties().setProperty(
    "CLUB_FORM_" + id,
    JSON.stringify(state),
  );
}
function clubText_(value, max, required) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value) ||
    (required && !value.trim())
  )
    throw new Error("INVALID");
  return value.trim();
}
function clubDate_(value, required) {
  if (!required && !value) return "";
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("INVALID");
  return value;
}
function clubInput_(input) {
  clubTerm_(input);
  if (
    ["admission", "continuation", "welcome_photo", "welcome_meal"].indexOf(
      input.kind,
    ) < 0 ||
    !Number.isSafeInteger(input.fee) ||
    input.fee < 0
  )
    throw new Error("INVALID");
  clubDate_(input.deadline, true);
  var welcome = input.kind.indexOf("welcome_") === 0;
  if (
    input.capacity !== undefined &&
    (!Number.isSafeInteger(input.capacity) ||
      input.capacity < 1 ||
      input.kind === "continuation")
  )
    throw new Error("INVALID");
  if (
    (input.feeOnDay !== undefined && typeof input.feeOnDay !== "boolean") ||
    (input.feeOnDay === true && !welcome)
  )
    throw new Error("INVALID");
  if (welcome) {
    clubDate_(input.startsAt, true);
    clubDate_(input.endsAt, false);
    clubText_(input.eventName, 150, true);
    clubText_(input.place, 500, true);
    if (input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt))
      throw new Error("INVALID");
  }
  return input;
}
function clubChild_(parent, name) {
  var folders = DriveApp.getFolderById(parent).getFoldersByName(name),
    first = folders.hasNext() ? folders.next() : null;
  if (folders.hasNext()) throw new Error("CONFLICT");
  return first
    ? first.getId()
    : DriveApp.getFolderById(parent).createFolder(name).getId();
}
function clubFolder_(year, welcome) {
  var annual = clubChild_(CLUB_ROOT_, String(year) + "運営資料");
  return clubChild_(
    annual,
    String(year) + (welcome ? " 新歓" : " 入会・継続フォーム"),
  );
}
function clubFind_(key, parent, mime) {
  var q =
    "trashed = false and '" +
    parent +
    "' in parents and mimeType = '" +
    mime +
    "' and appProperties has { key='clubFormsKey' and value='" +
    key +
    "' }";
  var files =
    Drive.Files.list({ q: q, fields: "files(id)", pageSize: 2 }).files || [];
  if (files.length > 1) throw new Error("CONFLICT");
  return files[0] && files[0].id;
}
/** Tag on the creation itself. An uncertain result is reconciled; it never blindly creates another copy. */
function clubCreateFile_(
  state,
  field,
  key,
  parent,
  mime,
  name,
  templateId,
  save,
) {
  if (state[field]) return state[field];
  var found = clubFind_(key, parent, mime);
  if (found) {
    state[field] = found;
    delete state[field + "Pending"];
    save();
    return found;
  }
  if (state[field + "Pending"]) throw new Error("RECONCILING");
  state[field + "Pending"] = true;
  save();
  var metadata = {
    name: name,
    mimeType: mime,
    parents: [parent],
    appProperties: { clubFormsKey: key },
  };
  var file = templateId
    ? Drive.Files.copy(metadata, templateId, { fields: "id" })
    : Drive.Files.create(metadata, null, { fields: "id" });
  state[field] = file.id;
  delete state[field + "Pending"];
  save();
  return file.id;
}
function clubTermState_(term) {
  var key = "CLUB_TERM_" + term.year + "_" + term.season,
    cfg = PropertiesService.getScriptProperties();
  var state = JSON.parse(cfg.getProperty(key) || "{}"),
    folder = clubFolder_(term.year, false);
  clubCreateFile_(
    state,
    "spreadsheetId",
    "term-" + term.year + "-" + term.season,
    folder,
    "application/vnd.google-apps.spreadsheet",
    term.year +
      "年 " +
      (term.season === "spring" ? "春" : "秋") +
      " サークル員名簿",
    null,
    function () {
      cfg.setProperty(key, JSON.stringify(state));
    },
  );
  clubInitializeBook_(state, function () {
    cfg.setProperty(key, JSON.stringify(state));
  });
  return { key: key, state: state };
}
/** Drive-created Sheets default to GMT; set the response locale before connecting a form. */
function clubInitializeBook_(state, save, force) {
  if (state.bookInitialized && !force) return;
  var book = SpreadsheetApp.openById(state.spreadsheetId);
  book.setSpreadsheetTimeZone("Asia/Tokyo");
  book.setSpreadsheetLocale("ja_JP");
  state.bookInitialized = true;
  save();
}
function clubResponseSheet_(formId, spreadsheetId) {
  var book = SpreadsheetApp.openById(spreadsheetId),
    sheets = book.getSheets(),
    result = [];
  sheets.forEach(function (sheet) {
    var url = sheet.getFormUrl();
    if (!url) return;
    try {
      if (FormApp.openByUrl(url).getId() === formId) result.push(sheet);
    } catch (error) {}
  });
  if (result.length !== 1) throw new Error("RECONCILING");
  return result[0];
}
function clubResolve_(source) {
  if (source && source.formId) {
    var form = FormApp.openById(clubId_(source.formId)),
      spreadsheetId = clubDestination_(form);
    if (!spreadsheetId) throw new Error("INVALID_SOURCE");
    return {
      spreadsheetId: spreadsheetId,
      sheetId: clubResponseSheet_(source.formId, spreadsheetId).getSheetId(),
    };
  }
  clubSheet_(source);
  var book = SpreadsheetApp.openById(source.spreadsheetId),
    sheet = book.getSheets().find(function (sheet) {
      return sheet.getSheetId() === source.sheetId;
    });
  if (!sheet) throw new Error("INVALID_SOURCE");
  return { spreadsheetId: source.spreadsheetId, sheetId: source.sheetId };
}
function clubDestination_(form) {
  try {
    return form.getDestinationId();
  } catch (error) {
    return null;
  }
}
function clubReadRoster_(source, kind) {
  clubSheet_(source);
  var book = SpreadsheetApp.openById(source.spreadsheetId),
    sheet = book.getSheets().find(function (sheet) {
      return sheet.getSheetId() === source.sheetId;
    });
  if (
    !sheet ||
    sheet.getLastRow() > 4001 ||
    sheet.getLastColumn() > 100 ||
    sheet.getLastColumn() < 1
  )
    throw new Error("INVALID_ROSTER");
  var headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  function column(regex, required) {
    var found = [];
    headers.forEach(function (value, index) {
      if (regex.test(clubNorm_(value))) found.push(index);
    });
    if (found.length > 1 || (required && !found.length))
      throw new Error("INVALID_ROSTER");
    return found.length ? found[0] : -1;
  }
  var columns = {
    name: column(/^(氏名(?:[（(]|$)|名前$|お名前をフルネーム)/, true),
    university: column(/大学名/, false),
    gender: column(/性別/, false),
    grade: column(/学年/, true),
    lineName: column(/line.*(?:名|名前)/, false),
    studentId: column(/学籍番号/, false),
    kana: column(/氏名フリガナ|お名前のフリガナ|ふりがな/, false),
    continuation: column(/継続しますか/, kind === "continuation"),
    timestamp: column(/タイムスタンプ|回答日時/, true),
  };
  var count = Math.max(0, sheet.getLastRow() - 1),
    values = {},
    rawTime = [];
  // No image uploads, bank details, or free-form messages leave the source spreadsheet.
  Object.keys(columns).forEach(function (key) {
    values[key] =
      columns[key] < 0 || !count
        ? []
        : sheet.getRange(2, columns[key] + 1, count, 1).getDisplayValues();
  });
  if (count)
    rawTime = sheet.getRange(2, columns.timestamp + 1, count, 1).getValues();
  var rows = [];
  for (var i = 0; i < count; i++) {
    function val(key) {
      var value = values[key][i] ? String(values[key][i][0] || "").trim() : "";
      if (value.length > 200) throw new Error("INVALID_ROSTER");
      return value;
    }
    var name = val("name");
    if (!name) continue;
    var university = val("university"),
      student = clubNorm_(val("studentId")),
      kana = clubNorm_(val("kana"));
    var identityHash = student
        ? clubHash_([clubNorm_(university), student])
        : "",
      kanaHash = kana ? clubHash_(kana) : "";
    var raw = rawTime[i][0],
      time =
        Object.prototype.toString.call(raw) === "[object Date]"
          ? raw.getTime()
          : Date.parse(
              val("timestamp").replace(/\//g, "-").replace(" ", "T") + "+09:00",
            );
    if (!Number.isFinite(time)) throw new Error("INVALID_ROSTER");
    var answer = clubNorm_(val("continuation")),
      active =
        kind === "admission"
          ? true
          : answer === "はい"
            ? true
            : answer === "いいえ" || answer === "継続しない"
              ? false
              : null;
    rows.push({
      key: clubHash_([
        source.spreadsheetId,
        source.sheetId,
        clubNorm_(name),
        clubNorm_(university),
        identityHash || kanaHash,
      ]),
      name: name,
      university: university,
      lineName: val("lineName"),
      gender: val("gender"),
      grade: val("grade"),
      identityHash: identityHash,
      kanaHash: kanaHash,
      submittedAt: new Date(time).toISOString(),
      active: active,
    });
  }
  return {
    kind: kind,
    spreadsheetId: source.spreadsheetId,
    sheetId: source.sheetId,
    title: book.getName(),
    sheetTitle: sheet.getName(),
    rows: rows,
  };
}
function clubDescription_(base, input) {
  return (
    clubBaseDescription_(base, input) +
    (input.capacity
      ? "\n定員：" + input.capacity + "人（定員に達し次第、受付終了）"
      : "")
  );
}
function clubBaseDescription_(base, input) {
  var season = input.season === "spring" ? "春" : "秋",
    deadline = Utilities.formatDate(
      new Date(input.deadline),
      "Asia/Tokyo",
      "yyyy/M/d(E) HH:mm",
    ),
    fee = input.fee === 0 ? "無料" : String(input.fee) + "円";
  if (input.kind.indexOf("welcome_") === 0) {
    if (input.feeOnDay === true) fee = "当日、参加費がかかる場合があります";
    var day = Utilities.formatDate(
        new Date(input.startsAt),
        "Asia/Tokyo",
        "yyyy/M/d(E)",
      ),
      time =
        Utilities.formatDate(new Date(input.startsAt), "Asia/Tokyo", "HH:mm") +
        (input.endsAt
          ? "-" +
            Utilities.formatDate(new Date(input.endsAt), "Asia/Tokyo", "HH:mm")
          : "～");
    [
      ["日付", day],
      ["時間", time],
      ["場所", input.place],
      ["参加費", fee],
    ].forEach(function (pair) {
      var regex = new RegExp("^" + pair[0] + "[：:].*$", "m");
      if (!regex.test(base)) throw new Error("TEMPLATE_CHANGED");
      base = base.replace(regex, function () {
        return pair[0] + "：" + pair[1];
      });
    });
    if (!/※当申請フォームの提出期限[^\n]*/.test(base))
      throw new Error("TEMPLATE_CHANGED");
    return base.replace(/※当申請フォームの提出期限[^\n]*/, function () {
      return "※提出期限：" + deadline + "（日本時間）";
    });
  }
  base = base.replace(/来期[（(][^）)]*[）)]/g, function () {
    return input.year + "年" + season + "の在籍継続";
  });
  base = base.replace(/期限は[^\n]*までです。?/g, "");
  if (input.kind === "admission" && !/会費[（(][\d,]+円[）)]/.test(base))
    throw new Error("TEMPLATE_CHANGED");
  base = base.replace(/会費[（(][\d,]+円[）)]/g, function () {
    return "会費（" + fee + "）";
  });
  base = base.replace(/会費[：:]\s*[\d,]+円/g, function () {
    return "会費：" + fee;
  });
  return (
    base.trim() +
    "\n\n【" +
    input.year +
    "年 " +
    season +
    "】\n会費：" +
    fee +
    "\n提出期限：" +
    deadline +
    "（日本時間）"
  );
}
function clubTitle_(input) {
  if (input.kind.indexOf("welcome_") === 0) return input.eventName;
  var season = input.season === "spring" ? "春" : "秋";
  return (
    input.year +
    "年 " +
    season +
    " " +
    (input.kind === "admission"
      ? "写団シャレード入会・部室鍵登録フォーム"
      : input.kind === "continuation"
        ? "写団シャレード継続確認フォーム"
        : input.eventName)
  );
}
function clubDeleteFile_(state, field, key, mime) {
  var id = state[field];
  if (!id) {
    var matches =
      Drive.Files.list({
        q:
          "mimeType = '" +
          mime +
          "' and appProperties has { key='clubFormsKey' and value='" +
          key +
          "' }",
        fields: "files(id)",
        pageSize: 2,
      }).files || [];
    if (matches.length > 1) throw new Error("CONFLICT");
    if (!matches.length) {
      if (state[field + "Pending"]) throw new Error("RECONCILING");
      return null;
    }
    id = matches[0].id;
  }
  var file;
  try {
    file = Drive.Files.get(id, {
      fields: "id,mimeType,trashed,appProperties,capabilities(canTrash)",
    });
  } catch (error) {
    throw new Error("DELETE_CHECK_FAILED");
  }
  if (
    file.mimeType !== mime ||
    !file.appProperties ||
    file.appProperties.clubFormsKey !== key ||
    (!file.trashed &&
      (!file.capabilities || file.capabilities.canTrash !== true))
  )
    throw new Error("DELETE_CHECK_FAILED");
  state[field] = id;
  delete state[field + "Pending"];
  return { id: id, trashed: file.trashed === true };
}
function clubDelete_(p) {
  clubUuid_(p.id);
  clubUuid_(p.operationId);
  if (!Number.isSafeInteger(p.revision) || p.revision < 1)
    throw new Error("INVALID");
  var state = clubState_(p.id);
  if (
    (state.revision || 0) > p.revision ||
    ((state.revision || 0) === p.revision &&
      state.deleteOperationId !== p.operationId)
  )
    throw new Error("CONFLICT");
  if (state.deletedAt)
    return { ok: true, id: p.id, revision: p.revision, deleted: true };
  state.deleting = true;
  state.revision = p.revision;
  state.deleteOperationId = p.operationId;
  clubSave_(p.id, state);
  var form = clubDeleteFile_(
      state,
      "formId",
      "form-" + p.id,
      "application/vnd.google-apps.form",
    ),
    answers = clubDeleteFile_(
      state,
      "spreadsheetId",
      "answers-" + p.id,
      "application/vnd.google-apps.spreadsheet",
    );
  clubSave_(p.id, state);
  if (state.formId)
    clubCapacityTrigger_(
      {
        getId: function () {
          return state.formId;
        },
      },
      false,
    );
  if (form && !form.trashed)
    FormApp.openById(form.id).setAcceptingResponses(false);
  [form, answers].forEach(function (file) {
    if (file && !file.trashed)
      Drive.Files.update({ trashed: true }, file.id, null, {
        fields: "id,trashed",
      });
  });
  state.state = "closed";
  state.deletedAt = new Date().toISOString();
  clubSave_(p.id, state);
  return { ok: true, id: p.id, revision: p.revision, deleted: true };
}
function clubMutate_(p) {
  clubUuid_(p.id);
  clubUuid_(p.operationId);
  clubInput_(p.input);
  if (
    !Number.isSafeInteger(p.revision) ||
    p.revision < 1 ||
    ["draft", "open", "closed"].indexOf(p.desiredState) < 0 ||
    ["create", "update", "open", "close"].indexOf(p.operation) < 0
  )
    throw new Error("INVALID");
  if (p.desiredState === "open" && Date.parse(p.input.deadline) <= Date.now())
    throw new Error("INVALID");
  var state = clubState_(p.id),
    fingerprint = clubHash_([p.operation, p.input, p.desiredState]),
    title = clubTitle_(p.input);
  if (state.deleting || state.deletedAt) throw new Error("FORM_DELETED");
  if (
    state.revision > p.revision ||
    (state.revision === p.revision &&
      state.fingerprint &&
      state.fingerprint !== fingerprint)
  )
    throw new Error("CONFLICT");
  if (
    state.complete &&
    state.revision === p.revision &&
    state.fingerprint === fingerprint
  )
    return clubRemote_(p.id, state, true);
  if (
    state.complete &&
    (p.input.year !== state.input.year ||
      p.input.season !== state.input.season ||
      p.input.kind !== state.input.kind)
  )
    throw new Error("CONFLICT");
  if (!state.formId && p.operation !== "create") throw new Error("CONFLICT");
  if (!clubTriggerReady_()) throw new Error("NOT_CONFIGURED");
  var welcome = p.input.kind.indexOf("welcome_") === 0,
    folder = clubFolder_(p.input.year, welcome),
    save = function () {
      clubSave_(p.id, state);
    };
  if (!state.formId) {
    var templateId =
      CLUB_TEMPLATES_[
        p.input.kind === "continuation"
          ? "continuation_" + p.input.season
          : p.input.kind
      ];
    var template = FormApp.openById(templateId),
      titles = template.getItems().map(function (item) {
        return item.getTitle();
      });
    if (
      !titles.some(function (value) {
        return /名前|氏名/.test(value);
      }) ||
      !titles.some(function (value) {
        return /学年/.test(value);
      }) ||
      (p.input.kind === "continuation" &&
        !titles.some(function (value) {
          return /継続しますか/.test(value);
        }))
    )
      throw new Error("TEMPLATE_CHANGED");
    state.baseDescription = template.getDescription();
    clubDescription_(state.baseDescription, p.input);
    save();
    clubCreateFile_(
      state,
      "formId",
      "form-" + p.id,
      folder,
      "application/vnd.google-apps.form",
      title,
      templateId,
      save,
    );
  }
  var form = FormApp.openById(state.formId);
  if (!state.complete) {
    if (
      form.supportsAdvancedResponderPermissions &&
      form.supportsAdvancedResponderPermissions()
    )
      form.setPublished(false);
    form.setAcceptingResponses(false);
    form.getItems().forEach(function (item) {
      var original = item.getTitle(),
        changed = original.replace(/会計星山/g, "会計担当");
      if (p.input.season === "autumn")
        changed = changed.replace(/春からの学年/g, "現在の学年");
      if (changed !== original) item.setTitle(changed);
      var type = String(item.getType()),
        typed = null;
      if (type === "TEXT") typed = item.asTextItem();
      else if (type === "PARAGRAPH_TEXT") typed = item.asParagraphTextItem();
      else if (type === "MULTIPLE_CHOICE") typed = item.asMultipleChoiceItem();
      if (typed && p.input.season === "autumn") {
        var help = typed.getHelpText();
        if (help && help.indexOf("春からの学年") >= 0)
          typed.setHelpText(help.replace(/春からの学年/g, "現在の学年"));
      }
    });
  }
  form
    .setTitle(title)
    .setDescription(clubDescription_(state.baseDescription, p.input));
  Drive.Files.update({ name: title }, state.formId, null, { fields: "id" });
  clubCreateFile_(
    state,
    "spreadsheetId",
    "answers-" + p.id,
    folder,
    "application/vnd.google-apps.spreadsheet",
    title + "（回答）",
    null,
    save,
  );
  clubInitializeBook_(state, save);
  if (clubDestination_(form) !== state.spreadsheetId)
    form.setDestination(
      FormApp.DestinationType.SPREADSHEET,
      state.spreadsheetId,
    );
  // Forms may reset the answer book's timezone while connecting the destination.
  clubInitializeBook_(state, save, true);
  state.sheetId = clubResponseSheet_(
    state.formId,
    state.spreadsheetId,
  ).getSheetId();
  Drive.Files.update({ name: title + "（回答）" }, state.spreadsheetId, null, {
    fields: "id",
  });
  if (!welcome)
    state.mergedSpreadsheetId = clubTermState_(p.input).state.spreadsheetId;
  var nextState = p.desiredState;
  if (p.desiredState === "open") {
    if (!clubUploadStatus_(form).ready)
      throw new Error("UPLOAD_SETUP_REQUIRED");
    var full =
      p.input.capacity && form.getResponses().length >= p.input.capacity;
    if (full) {
      form.setAcceptingResponses(false);
      state.closedReason = "capacity";
      nextState = "closed";
      clubCapacityTrigger_(form, false);
    } else {
      // Install before opening; a quota/permission failure must never open an unguarded form.
      clubCapacityTrigger_(form, Boolean(p.input.capacity));
      if (
        form.supportsAdvancedResponderPermissions &&
        form.supportsAdvancedResponderPermissions() &&
        !form.isPublished()
      )
        form.setPublished(true);
      form.setAcceptingResponses(true);
      state.wasOpened = true;
      delete state.closedReason;
    }
  } else {
    form.setAcceptingResponses(false);
    clubCapacityTrigger_(form, false);
    if (p.desiredState === "closed") state.closedReason = "manual";
  }
  state.input = p.input;
  state.revision = p.revision;
  state.fingerprint = fingerprint;
  state.operationId = p.operationId;
  state.state = nextState;
  state.complete = true;
  state.folderId = folder;
  save();
  return clubRemote_(p.id, state, true);
}
/** The accepting flag stays true on broken upload copies. Check Google's actual folder IDs. */
function clubUploadStatus_(form) {
  var expected = form.getItems().filter(function (item) {
    return String(item.getType()) === "FILE_UPLOAD";
  }).length;
  if (!expected) return { required: false, ready: true };
  var response = UrlFetchApp.fetch(
    "https://forms.googleapis.com/v1/forms/" + form.getId(),
    {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    },
  );
  if (response.getResponseCode() !== 200)
    throw new Error("UPLOAD_CHECK_FAILED");
  var data = JSON.parse(response.getContentText()),
    uploads = (data.items || []).filter(function (item) {
      return item.questionItem && item.questionItem.question.fileUploadQuestion;
    });
  if (uploads.length !== expected) throw new Error("UPLOAD_CHECK_FAILED");
  var ready = uploads.every(function (item) {
    var id = item.questionItem.question.fileUploadQuestion.folderId;
    if (!id) return false;
    var folder;
    try {
      folder = Drive.Files.get(id, {
        fields: "mimeType,trashed,capabilities(canAddChildren)",
      });
    } catch (error) {
      throw new Error("UPLOAD_CHECK_FAILED");
    }
    return (
      folder.mimeType === "application/vnd.google-apps.folder" &&
      !folder.trashed &&
      folder.capabilities &&
      folder.capabilities.canAddChildren === true
    );
  });
  return { required: true, ready: ready };
}
function clubRemote_(id, state, check) {
  var form = FormApp.openById(state.formId),
    upload = clubUploadStatus_(form);
  if (check && state.complete) {
    clubCheckLimits_(id, state, form);
    if (!upload.ready) {
      if (form.isAcceptingResponses()) form.setAcceptingResponses(false);
      if (state.state !== "draft") {
        state.state = "closed";
        state.closedReason = "upload_setup";
      }
    } else if (
      form.isAcceptingResponses() &&
      (!form.supportsAdvancedResponderPermissions ||
        !form.supportsAdvancedResponderPermissions() ||
        form.isPublished())
    ) {
      state.state = "open";
      delete state.closedReason;
    } else if (state.state !== "draft") {
      state.state = "closed";
      state.closedReason = state.closedReason || "manual";
    }
    if (!form.isAcceptingResponses()) clubCapacityTrigger_(form, false);
    clubSave_(id, state);
  }
  return {
    id: id,
    formId: state.formId,
    spreadsheetId: state.spreadsheetId,
    sheetId: state.sheetId,
    editUrl: form.getEditUrl(),
    responseUrl: form.getPublishedUrl(),
    spreadsheetUrl:
      SpreadsheetApp.openById(state.spreadsheetId).getUrl() +
      "#gid=" +
      state.sheetId,
    folderUrl: DriveApp.getFolderById(state.folderId).getUrl(),
    mergedSpreadsheetUrl: state.mergedSpreadsheetId
      ? SpreadsheetApp.openById(state.mergedSpreadsheetId).getUrl()
      : undefined,
    state: state.state,
    revision: state.revision,
    closedReason: state.closedReason,
    uploadRequired: upload.required,
    uploadReady: upload.ready,
    responseCount: state.input.capacity ? state.responseCount : undefined,
  };
}
/** Submission triggers react promptly; the shared minute trigger retries missed/failed events. */
function clubCapacityTrigger_(form, enabled) {
  var found = false;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (
      trigger.getHandlerFunction() !== "closeFullClubForm" ||
      trigger.getTriggerSourceId() !== form.getId()
    )
      return;
    if (enabled && !found) found = true;
    else ScriptApp.deleteTrigger(trigger);
  });
  if (enabled && !found) {
    try {
      ScriptApp.newTrigger("closeFullClubForm")
        .forForm(form)
        .onFormSubmit()
        .create();
    } catch (error) {
      throw new Error("CAPACITY_TRIGGER_FAILED");
    }
  }
}
function clubCheckLimits_(id, state, form) {
  var count = state.input.capacity ? form.getResponses().length : undefined;
  state.responseCount = count;
  var reason =
    Date.parse(state.input.deadline) <= Date.now()
      ? "deadline"
      : state.input.capacity && count >= state.input.capacity
        ? "capacity"
        : null;
  var closed = false;
  if (reason && form.isAcceptingResponses()) {
    form.setAcceptingResponses(false);
    state.state = "closed";
    state.closedReason = reason;
    closed = true;
  }
  if (!form.isAcceptingResponses()) clubCapacityTrigger_(form, false);
  clubSave_(id, state);
  return closed;
}
function closeFullClubForm(e) {
  if (!e || !e.source || !e.source.getId) return;
  return clubLock_(function () {
    var values = PropertiesService.getScriptProperties().getProperties();
    Object.keys(values).some(function (key) {
      if (key.indexOf("CLUB_FORM_") !== 0) return false;
      var state = JSON.parse(values[key]);
      if (state.formId !== e.source.getId()) return false;
      if (state.complete && state.input && !state.deleting && !state.deletedAt)
        clubCheckLimits_(key.slice(10), state, e.source);
      return true;
    });
  });
}
/** Closes managed forms on deadlines or capacity even while the website is stopped. */
function closeDueClubForms() {
  clubConnection_();
  return clubLock_(function () {
    var values = PropertiesService.getScriptProperties().getProperties(),
      closed = 0;
    Object.keys(values).forEach(function (key) {
      if (key.indexOf("CLUB_FORM_") !== 0) return;
      var state = JSON.parse(values[key]);
      if (
        state.deleting ||
        state.deletedAt ||
        !state.complete ||
        !state.input ||
        (Date.parse(state.input.deadline) > Date.now() && !state.input.capacity)
      )
        return;
      try {
        var form = FormApp.openById(state.formId);
        if (clubCheckLimits_(key.slice(10), state, form)) closed++;
      } catch (error) {
        console.log("club-forms: automatic close will retry");
      }
    });
    return closed;
  });
}
function clubExport_(p) {
  clubUuid_(p.id);
  clubTerm_(p.term);
  if (!Number.isSafeInteger(p.revision) || p.revision < 1)
    throw new Error("INVALID");
  ["active", "retired", "review"].forEach(function (key) {
    if (
      !Array.isArray(p[key]) ||
      p[key].length > 10000 ||
      p[key].some(function (row) {
        return (
          !Array.isArray(row) ||
          row.length !== 10 ||
          row.some(function (value) {
            return typeof value !== "string" || value.length > 2000;
          })
        );
      })
    )
      throw new Error("INVALID");
  });
  var entry = clubTermState_(p.term),
    state = entry.state,
    cfg = PropertiesService.getScriptProperties(),
    fingerprint = clubHash_([p.active, p.retired, p.review]);
  if (state.revision > p.revision)
    return {
      ok: true,
      spreadsheetUrl: SpreadsheetApp.openById(state.spreadsheetId).getUrl(),
    };
  if (
    state.revision === p.revision &&
    state.fingerprint &&
    state.fingerprint !== fingerprint
  )
    throw new Error("CONFLICT");
  var book = SpreadsheetApp.openById(state.spreadsheetId),
    headers = [
      "人物ID",
      "氏名",
      "大学名",
      "学年",
      "性別",
      "LINE名",
      "在籍状態",
      "要確認事項",
      "回答元・回答日時",
      "退会日時",
    ];
  function literal(value) {
    return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  }
  [
    ["在籍者", p.active],
    ["退会者", p.retired],
    ["要確認", p.review],
  ].forEach(function (pair) {
    var sheet = book.getSheetByName(pair[0]) || book.insertSheet(pair[0]),
      values = [headers].concat(pair[1]).map(function (row) {
        return row.map(literal);
      });
    if (sheet.getMaxRows() < values.length)
      sheet.insertRowsAfter(
        sheet.getMaxRows(),
        values.length - sheet.getMaxRows(),
      );
    if (sheet.getMaxColumns() < 10)
      sheet.insertColumnsAfter(
        sheet.getMaxColumns(),
        10 - sheet.getMaxColumns(),
      );
    sheet
      .getRange(1, 1, Math.max(sheet.getLastRow(), values.length), 10)
      .clearContent();
    sheet
      .getRange(1, 1, values.length, 10)
      .setNumberFormat("@")
      .setValues(values);
    sheet.setFrozenRows(1);
    sheet
      .getRange(1, 1)
      .setNote(
        "自動生成の確定名簿です。訂正は元のフォーム回答で行い、サイトの名簿画面で確認・適用してください。更新日時：" +
          Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm"),
      );
  });
  SpreadsheetApp.flush();
  state.revision = p.revision;
  state.fingerprint = fingerprint;
  cfg.setProperty(entry.key, JSON.stringify(state));
  return { ok: true, spreadsheetUrl: book.getUrl() };
}

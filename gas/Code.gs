/**
 * Secret Gift｜開源交換禮物報名與抽籤工具
 * Google Apps Script backend (bound to the Google Sheet).
 *
 * Public web entry points: doGet / doPost (only the actions in PUBLIC_ACTIONS).
 * Organizer tools live in the Sheets menu「🎁 交換禮物管理」and are NOT reachable from the web.
 */

var SHEET = {
  SETTINGS: '活動設定',
  PARTICIPANTS: '參加名單',
  DRAW: '抽籤結果',
  LOG: '操作紀錄'
};

var TZ = 'Asia/Taipei';

var STATUS = {
  OPEN: 'REGISTRATION_OPEN',
  CLOSED: 'REGISTRATION_CLOSED',
  READY: 'DRAW_READY',
  PUBLISHED: 'DRAW_PUBLISHED',
  COMPLETED: 'COMPLETED'
};
var ALL_STATUSES = [STATUS.OPEN, STATUS.CLOSED, STATUS.READY, STATUS.PUBLISHED, STATUS.COMPLETED];

var PARTICIPANT_HEADERS = ['participant_id', 'participant_no', 'name', 'email', 'email_normalized', 'keyword',
  'registration_status', 'created_at', 'updated_at', 'deleted_at'];
// Keep the organizer-friendly columns first. The ID columns remain at the end so
// the program can validate exact identities even when two people use the same name.
var DRAW_HEADERS = ['送禮人編號', '送禮人姓名', '收禮人編號', '收禮人姓名', '收禮人寫的形容詞', '配對時間',
  'draw_id', 'sender_id', 'receiver_id', 'assigned_keyword', 'created_at'];
var LOG_HEADERS = ['log_id', 'operation', 'target_id', 'operator', 'timestamp', 'result', 'details'];

var SETTINGS_DEFAULTS = [
  ['event_id', 'GIFT-2026', '活動識別碼'],
  ['event_name', '交換禮物大會｜Secret Gift', '活動名稱'],
  ['event_date', '2026-12-25', '活動日期（YYYY-MM-DD；部署前請修改）'],
  ['budget_min', '500', '最低預算'],
  ['budget_max', '600', '最高預算'],
  ['registration_deadline', '2026-12-20 23:59', '報名截止（YYYY-MM-DD HH:mm，台灣時間；部署前請修改）'],
  ['status', STATUS.OPEN, '活動狀態：' + ALL_STATUSES.join(' / ')],
  ['timezone', TZ, '時區（請勿修改）'],
  ['draw_id', '', '目前抽籤批次（系統產生，請勿手動修改）'],
  ['draw_timestamp', '', '配對產生時間（系統產生）'],
  ['next_participant_no', '1', '下一個參加編號（系統產生）']
];

var LIMITS = { NAME: 30, KEYWORD: 20, EMAIL: 254 };
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var PROTECT_TAG = 'SecretGift lock';

/* ------------------------------------------------------------------ */
/* Web entry points                                                    */
/* ------------------------------------------------------------------ */

var PUBLIC_ACTIONS = {
  getEventInfo: function () { return getEventInfo(); },
  registerParticipant: function (p) { return registerParticipant(p); },
  getRegistration: function (p) { return getRegistration(p); },
  updateRegistration: function (p) { return updateRegistration(p); },
  getMyAssignment: function (p) { return getMyAssignment(p); }
};

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'getEventInfo';
  if (action === 'ping') return json_({ success: true, data: { pong: true } });
  if (action !== 'getEventInfo') {
    return json_({ success: false, error: { code: 'BAD_REQUEST', message: 'Use POST for this action.' } });
  }
  return respond_(function () { return getEventInfo(); });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } });
  }
  var handler = PUBLIC_ACTIONS.hasOwnProperty(body.action) ? PUBLIC_ACTIONS[body.action] : null;
  if (!handler) return json_({ success: false, error: { code: 'BAD_REQUEST', message: 'Unknown action.' } });
  return respond_(function () { return handler(body); });
}

function respond_(fn) {
  try {
    return json_({ success: true, data: fn() });
  } catch (err) {
    if (err && err.code) return json_({ success: false, error: { code: err.code, message: err.message } });
    console.error(err && err.stack ? err.stack : err);
    return json_({ success: false, error: { code: 'SERVER_ERROR', message: '目前無法取得資料，請再試一次' } });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  var err = new Error(message);
  err.code = code;
  throw err;
}

/* ------------------------------------------------------------------ */
/* Public services                                                     */
/* ------------------------------------------------------------------ */

function getEventInfo() {
  var s = readSettings_();
  var count = readParticipants_().filter(isActive_).length;
  return {
    eventName: s.event_name,
    eventDate: s.event_date,
    budgetMin: Number(s.budget_min),
    budgetMax: Number(s.budget_max),
    registrationDeadline: s.registration_deadline,
    status: effectiveStatus_(s, new Date()),
    participantCount: count
  };
}

function registerParticipant(p) {
  var input = validateRegistration_(p, true);
  return withLock_(function () {
    var s = readSettings_();
    assertOpen_(s);
    var people = readParticipants_();
    var dup = people.some(function (x) { return isActive_(x) && x.email_normalized === input.emailNormalized; });
    if (dup) fail_('DUPLICATE', '這個 Email 已經報名囉！');

    var no = Math.max(Number(s.next_participant_no) || 1, maxParticipantNo_(people) + 1);
    // Reserve the number first: if the row write fails the number is skipped, never reused.
    writeSetting_('next_participant_no', String(no + 1));

    var now = nowText_();
    var record = {
      participant_id: 'P-' + Utilities.getUuid(),
      participant_no: formatNo_(no),
      name: input.name,
      email: input.email,
      email_normalized: input.emailNormalized,
      keyword: input.keyword,
      registration_status: 'ACTIVE',
      created_at: now,
      updated_at: now,
      deleted_at: ''
    };
    appendRecord_(SHEET.PARTICIPANTS, PARTICIPANT_HEADERS, record);
    SpreadsheetApp.flush();
    return {
      participantId: record.participant_id,
      participantNo: record.participant_no,
      name: record.name,
      email: record.email,
      keyword: record.keyword
    };
  });
}

function getRegistration(p) {
  var email = validateEmail_(p && p.email);
  var s = readSettings_();
  var person = findActiveByEmail_(readParticipants_(), email);
  if (!person) fail_('NOT_FOUND', '找不到你的報名紀錄，請確認 Email 是否正確');
  return {
    participantNo: person.participant_no,
    name: person.name,
    email: person.email,
    keyword: person.keyword,
    canEdit: effectiveStatus_(s, new Date()) === STATUS.OPEN
  };
}

function updateRegistration(p) {
  var input = validateRegistration_(p, true);
  return withLock_(function () {
    var s = readSettings_();
    assertOpen_(s);
    var people = readParticipants_();
    var person = findActiveByEmail_(people, input.emailNormalized);
    if (!person) fail_('NOT_FOUND', '找不到你的報名紀錄，請確認 Email 是否正確');
    updateRecord_(SHEET.PARTICIPANTS, person._row, {
      name: input.name,
      keyword: input.keyword,
      updated_at: nowText_()
    });
    SpreadsheetApp.flush();
    return {
      participantNo: person.participant_no,
      name: input.name,
      email: person.email,
      keyword: input.keyword
    };
  });
}

function getMyAssignment(p) {
  var email = validateEmail_(p && p.email);
  var s = readSettings_();
  var status = effectiveStatus_(s, new Date());
  if (status !== STATUS.PUBLISHED && status !== STATUS.COMPLETED) {
    fail_('PENDING', '秘密任務還在準備中，敬請期待！');
  }
  var person = findActiveByEmail_(readParticipants_(), email);
  if (!person) fail_('NOT_FOUND', '找不到你的報名紀錄，請確認 Email 是否正確');
  var pair = readDrawRows_().filter(function (r) {
    return r.draw_id === s.draw_id && r.sender_id === person.participant_id;
  })[0];
  if (!pair) fail_('NOT_FOUND', '找不到你的報名紀錄，請確認 Email 是否正確');
  return {
    participantNo: person.participant_no,
    name: person.name,
    assignedKeyword: pair.assigned_keyword,
    eventDate: s.event_date,
    budgetMin: Number(s.budget_min),
    budgetMax: Number(s.budget_max)
  };
}

/* ------------------------------------------------------------------ */
/* Validation & status                                                 */
/* ------------------------------------------------------------------ */

function normalizeEmail_(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

function validateEmail_(email) {
  var n = normalizeEmail_(email);
  if (!n) fail_('REQUIRED', '這個欄位還沒填寫喔！');
  if (n.length > LIMITS.EMAIL || !EMAIL_RE.test(n)) fail_('INVALID_EMAIL', '請輸入正確的 Email 格式');
  return n;
}

function validateRegistration_(p) {
  p = p || {};
  var name = String(p.name == null ? '' : p.name).trim();
  var keyword = String(p.keyword == null ? '' : p.keyword).trim();
  var email = String(p.email == null ? '' : p.email).trim();
  if (!name || !keyword || !email) fail_('REQUIRED', '這個欄位還沒填寫喔！');
  if (name.length > LIMITS.NAME) fail_('NAME_TOO_LONG', '名字最多 30 個字');
  if (keyword.length > LIMITS.KEYWORD) fail_('KEYWORD_TOO_LONG', '形容詞最多 20 個字');
  var normalized = validateEmail_(email);
  return { name: name, keyword: keyword, email: email, emailNormalized: normalized };
}

function parseDeadline_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') return value;
  var m = String(value).trim().match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  var pad = function (n) { return ('0' + n).slice(-2); };
  var hh = m[4] != null ? pad(m[4]) : '23';
  var mm = m[5] != null ? m[5] : '59';
  return new Date(m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) + 'T' + hh + ':' + mm + ':00+08:00');
}

function effectiveStatus_(s, now) {
  var status = String(s.status || '').trim();
  if (ALL_STATUSES.indexOf(status) === -1) status = STATUS.CLOSED;
  if (status === STATUS.OPEN) {
    var deadline = parseDeadline_(s.registration_deadline);
    if (deadline && now.getTime() > deadline.getTime()) return STATUS.CLOSED;
  }
  return status;
}

function assertOpen_(s) {
  if (effectiveStatus_(s, new Date()) !== STATUS.OPEN) fail_('CLOSED', '報名已經結束囉！');
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) fail_('SERVER_ERROR', '找不到工作表「' + name + '」，請先執行「初始化工作表」。');
  return sh;
}

function readSettings_() {
  var values = sheet_(SHEET.SETTINGS).getDataRange().getValues();
  var out = {};
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (!key) continue;
    var v = values[i][1];
    out[key] = Object.prototype.toString.call(v) === '[object Date]' ? v : String(v == null ? '' : v).trim();
  }
  return out;
}

function writeSetting_(key, value) {
  var sh = sheet_(SHEET.SETTINGS);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value, '']);
}

function readTable_(name) {
  var values = sheet_(name).getDataRange().getValues();
  if (!values.length) return [];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    var obj = { _row: i + 1 };
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = row[c];
      obj[headers[c]] = Object.prototype.toString.call(v) === '[object Date]'
        ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss')
        : String(v == null ? '' : v).trim();
    }
    rows.push(obj);
  }
  return rows;
}

function headerIndex_(name) {
  var sh = sheet_(name);
  var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  return { sheet: sh, headers: headers };
}

function appendRecord_(name, expectedHeaders, record) {
  var info = headerIndex_(name);
  expectedHeaders.forEach(function (h) {
    if (info.headers.indexOf(h) === -1) fail_('SERVER_ERROR', '工作表「' + name + '」缺少欄位 ' + h);
  });
  var row = info.headers.map(function (h) { return record.hasOwnProperty(h) ? record[h] : ''; });
  var target = info.sheet.getLastRow() + 1;
  info.sheet.getRange(target, 1, 1, row.length).setValues([row]);
  return target;
}

function updateRecord_(name, rowNumber, patch) {
  var info = headerIndex_(name);
  Object.keys(patch).forEach(function (key) {
    var col = info.headers.indexOf(key);
    if (col === -1) fail_('SERVER_ERROR', '工作表「' + name + '」缺少欄位 ' + key);
    info.sheet.getRange(rowNumber, col + 1).setValue(patch[key]);
  });
}

function readParticipants_() { return readTable_(SHEET.PARTICIPANTS); }
function readDrawRows_() { return readTable_(SHEET.DRAW); }
function isActive_(p) { return p.registration_status === 'ACTIVE'; }

function findActiveByEmail_(people, normalizedEmail) {
  return people.filter(function (x) { return isActive_(x) && x.email_normalized === normalizedEmail; })[0] || null;
}

function maxParticipantNo_(people) {
  return people.reduce(function (max, p) {
    var n = parseInt(String(p.participant_no).replace(/\D/g, ''), 10);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);
}

function formatNo_(n) { return 'No.' + ('00' + n).slice(-3); }

function nowText_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('BUSY', '目前無法取得資料，請再試一次');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Draw logic (pure, unit-tested)                                      */
/* ------------------------------------------------------------------ */

/** Random derangement: returns receivers[i] for senders[i], never receivers[i] === senders[i]. */
function derange_(ids, random) {
  random = random || Math.random;
  var n = ids.length;
  if (n < 2) fail_('DRAW_INVALID', '至少需要 2 位參加者才能抽籤。');
  for (var attempt = 0; attempt < 10000; attempt++) {
    var p = ids.slice();
    for (var i = n - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var t = p[i]; p[i] = p[j]; p[j] = t;
    }
    var ok = true;
    for (var k = 0; k < n; k++) { if (p[k] === ids[k]) { ok = false; break; } }
    if (ok) return p;
  }
  fail_('DRAW_INVALID', '產生配對失敗，請再試一次。');
}

/** Returns a list of problems; empty list means the pairs are complete and valid. */
function validatePairs_(pairs, participants) {
  var problems = [];
  var byId = {};
  participants.forEach(function (p) { byId[p.participant_id] = p; });
  var senders = {}, receivers = {};
  if (pairs.length !== participants.length) {
    problems.push('配對筆數（' + pairs.length + '）與有效參加者人數（' + participants.length + '）不一致');
  }
  pairs.forEach(function (r) {
    if (!byId[r.sender_id]) problems.push('送禮者 ' + r.sender_id + ' 不是有效參加者');
    if (!byId[r.receiver_id]) problems.push('收禮者 ' + r.receiver_id + ' 不是有效參加者');
    if (r.sender_id === r.receiver_id) problems.push(r.sender_id + ' 抽到自己');
    if (senders[r.sender_id]) problems.push(r.sender_id + ' 送出超過一份');
    if (receivers[r.receiver_id]) problems.push(r.receiver_id + ' 收到超過一份');
    senders[r.sender_id] = true;
    receivers[r.receiver_id] = true;
    var receiver = byId[r.receiver_id];
    if (receiver && receiver.keyword !== r.assigned_keyword) {
      problems.push(receiver.participant_no + ' 的形容詞已被修改，與配對結果不一致');
    }
  });
  participants.forEach(function (p) {
    if (!senders[p.participant_id]) problems.push(p.participant_no + ' 沒有送禮對象');
    if (!receivers[p.participant_id]) problems.push(p.participant_no + ' 沒有收到禮物');
  });
  return problems;
}

function precheckDraw_(s, participants, now) {
  var problems = [];
  var status = effectiveStatus_(s, now);
  if (status !== STATUS.CLOSED) {
    problems.push(status === STATUS.OPEN
      ? '報名還在進行中。請先到 Settings 把 status 改成 REGISTRATION_CLOSED（或等報名截止）。'
      : '目前狀態是 ' + status + '，只有 REGISTRATION_CLOSED 才能抽籤。');
  }
  if (s.draw_id) problems.push('已經有抽籤結果（' + s.draw_id + '）。如要重抽，請先使用「重置抽籤結果」。');
  if (participants.length < 2) problems.push('有效參加者只有 ' + participants.length + ' 位，至少需要 2 位。');
  var seen = {};
  participants.forEach(function (p) {
    if (seen[p.email_normalized]) problems.push('Email 重複：' + p.email);
    seen[p.email_normalized] = true;
    if (!p.keyword) problems.push(p.participant_no + ' 沒有填形容詞');
  });
  return problems;
}

/* ------------------------------------------------------------------ */
/* Organizer operations (called from the Sheets menu only)             */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎁 交換禮物管理')
    .addItem('產生抽籤結果', 'menuRunDraw')
    .addItem('公布抽籤結果', 'menuPublishDraw')
    .addItem('重置抽籤結果', 'menuResetDraw')
    .addSeparator()
    .addItem('刪除選取的參加者', 'menuDeleteSelected')
    .addItem('清除全部測試資料', 'menuClearTestData')
    .addSeparator()
    .addItem('初始化工作表（第一次使用）', 'setupSheets')
    .addToUi();
}

function menuRunDraw() { adminRun_('產生抽籤', runDraw_); }
function menuPublishDraw() { adminRun_('公布抽籤', publishDraw_); }
function menuResetDraw() { adminRun_('重置抽籤', resetDraw_); }
function menuDeleteSelected() { adminRun_('刪除參加者', deleteSelected_); }
function menuClearTestData() { adminRun_('清除測試資料', clearTestData_); }

function adminRun_(label, fn) {
  var ui = SpreadsheetApp.getUi();
  try {
    var message = withLock_(function () { return fn(ui); });
    if (message) ui.alert(label, message, ui.ButtonSet.OK);
  } catch (err) {
    if (!(err && err.code === 'CANCELLED')) {
      logOperation_(label, '', 'FAILED', err && err.message ? err.message : String(err));
    }
    ui.alert(label + '：未執行', err && err.message ? err.message : String(err), ui.ButtonSet.OK);
  }
}

function confirm_(ui, title, text) {
  var r = ui.alert(title, text, ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) fail_('CANCELLED', '已取消，沒有做任何變更。');
}

function runDraw_(ui) {
  var s = readSettings_();
  var participants = readParticipants_().filter(isActive_);
  var leftover = readDrawRows_().length;
  var problems = precheckDraw_(s, participants, new Date());
  if (leftover && !s.draw_id) problems.push('抽籤結果裡還有舊資料，請先使用「重置抽籤結果」。');
  if (problems.length) fail_('DRAW_INVALID', problems.join('\n'));

  confirm_(ui, '產生抽籤結果', '共 ' + participants.length + ' 位有效參加者。\n確定要產生抽籤結果嗎？（產生後不會自動公布）');

  var ids = participants.map(function (p) { return p.participant_id; });
  var receivers = derange_(ids);
  var byId = {};
  participants.forEach(function (p) { byId[p.participant_id] = p; });
  var drawId = 'D-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 8);
  var now = nowText_();
  var pairs = ids.map(function (sender, i) {
    var senderPerson = byId[sender];
    var receiverPerson = byId[receivers[i]];
    return {
      '送禮人編號': senderPerson.participant_no,
      '送禮人姓名': senderPerson.name,
      '收禮人編號': receiverPerson.participant_no,
      '收禮人姓名': receiverPerson.name,
      '收禮人寫的形容詞': receiverPerson.keyword,
      '配對時間': now,
      draw_id: drawId,
      sender_id: sender,
      receiver_id: receivers[i],
      assigned_keyword: receiverPerson.keyword,
      created_at: now
    };
  });
  var problemsAfter = validatePairs_(pairs, participants);
  if (problemsAfter.length) fail_('DRAW_INVALID', problemsAfter.join('\n'));

  var info = headerIndex_(SHEET.DRAW);
  var rows = pairs.map(function (r) { return info.headers.map(function (h) { return r.hasOwnProperty(h) ? r[h] : ''; }); });
  var start = info.sheet.getLastRow() + 1;
  info.sheet.getRange(start, 1, rows.length, info.headers.length).setValues(rows);
  try {
    writeSetting_('draw_id', drawId);
    writeSetting_('draw_timestamp', now);
    writeSetting_('status', STATUS.READY);
    SpreadsheetApp.flush();
  } catch (err) {
    info.sheet.getRange(start, 1, rows.length, info.headers.length).clearContent();
    writeSetting_('draw_id', '');
    writeSetting_('draw_timestamp', '');
    throw err;
  }
  lockSheets_();
  logOperation_('RUN_DRAW', drawId, 'SUCCESS', participants.length + ' 位參加者完成配對');
  return '抽籤完成！共 ' + pairs.length + ' 組配對，狀態已改為 DRAW_READY。\n確認抽籤結果沒問題後，再使用「公布抽籤結果」。';
}

function publishDraw_(ui) {
  var s = readSettings_();
  if (s.status !== STATUS.READY) fail_('PUBLISH_INVALID', '目前狀態是 ' + s.status + '，只有 DRAW_READY 才能公布。');
  var participants = readParticipants_().filter(isActive_);
  var pairs = readDrawRows_().filter(function (r) { return r.draw_id === s.draw_id; });
  var problems = validatePairs_(pairs, participants);
  if (!s.draw_id) problems.unshift('找不到目前的抽籤批次（draw_id）。');
  if (problems.length) fail_('PUBLISH_INVALID', '配對資料不完整，不能公布：\n' + problems.join('\n'));

  confirm_(ui, '公布抽籤結果', '共 ' + pairs.length + ' 組配對。\n公布後參加者就能查看秘密任務，而且不能再用一般功能重抽。確定要公布嗎？');
  writeSetting_('status', STATUS.PUBLISHED);
  SpreadsheetApp.flush();
  logOperation_('PUBLISH_DRAW', s.draw_id, 'SUCCESS', pairs.length + ' 組配對已公布');
  return '已公布！網站現在會顯示「秘密任務已公布」。';
}

function resetDraw_(ui) {
  var s = readSettings_();
  if (s.status === STATUS.PUBLISHED || s.status === STATUS.COMPLETED) {
    fail_('RESET_BLOCKED', '抽籤結果已公布，不能使用一般重置功能。');
  }
  var rows = readDrawRows_();
  if (!rows.length && !s.draw_id) fail_('RESET_BLOCKED', '目前沒有抽籤結果，不需要重置。');

  confirm_(ui, '重置抽籤結果', '會清除 ' + rows.length + ' 筆配對（報名資料不受影響），狀態回到 REGISTRATION_CLOSED。\n清除前會自動備份。確定要重置嗎？');
  var backup = backupSheet_(SHEET.DRAW);
  unlockSheets_();
  clearDataRows_(SHEET.DRAW);
  writeSetting_('draw_id', '');
  writeSetting_('draw_timestamp', '');
  writeSetting_('status', STATUS.CLOSED);
  SpreadsheetApp.flush();
  logOperation_('RESET_DRAW', s.draw_id || '', 'SUCCESS', '清除 ' + rows.length + ' 筆配對；備份：' + backup);
  return '已重置。舊配對備份在隱藏工作表「' + backup + '」。';
}

function deleteSelected_(ui) {
  var sheet = ss_().getActiveSheet();
  if (sheet.getName() !== SHEET.PARTICIPANTS) fail_('DELETE_INVALID', '請先到「參加名單」工作表，點選要刪除的那一列。');
  var row = sheet.getActiveRange().getRow();
  if (row < 2) fail_('DELETE_INVALID', '請點選參加者資料列（不是標題列）。');
  var person = readParticipants_().filter(function (p) { return p._row === row; })[0];
  if (!person || !person.participant_id) fail_('DELETE_INVALID', '這一列沒有參加者資料。');
  if (!isActive_(person)) fail_('DELETE_INVALID', '這位參加者已經是刪除狀態。');

  var s = readSettings_();
  if (s.status === STATUS.READY) fail_('DELETE_BLOCKED', '已經產生抽籤結果。請先「重置抽籤結果」，再刪除參加者。');
  if (s.status === STATUS.PUBLISHED || s.status === STATUS.COMPLETED) {
    fail_('DELETE_BLOCKED', '抽籤結果已公布，不能使用一般刪除功能。');
  }

  confirm_(ui, '刪除參加者', '姓名：' + person.name + '\nEmail：' + person.email + '\n參加編號：' + person.participant_no +
    '\n\n確定要刪除嗎？（資料會標記為 DELETED，不會真的移除，可以追查）');
  var now = nowText_();
  updateRecord_(SHEET.PARTICIPANTS, row, { registration_status: 'DELETED', deleted_at: now, updated_at: now });
  SpreadsheetApp.flush();
  logOperation_('DELETE_PARTICIPANT', person.participant_id, 'SUCCESS', person.participant_no + ' ' + person.email);
  return '已刪除 ' + person.participant_no + '（' + person.name + '）。這個 Email 可以重新報名。';
}

function clearTestData_(ui) {
  var s = readSettings_();
  if (s.status === STATUS.PUBLISHED || s.status === STATUS.COMPLETED) {
    fail_('CLEAR_BLOCKED', '抽籤結果已公布，不能使用一般清除功能。');
  }
  var people = readParticipants_();
  var draws = readDrawRows_();
  var answer = ui.prompt('清除全部測試資料',
    '將清除：報名資料 ' + people.length + ' 筆、配對 ' + draws.length + ' 筆，並把參加編號重設為 No.001。\n' +
    '活動名稱、日期、預算、截止時間會保留，清除前會自動備份。\n\n確定的話請輸入「清除」兩個字：', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK || String(answer.getResponseText()).trim() !== '清除') {
    fail_('CANCELLED', '已取消，沒有做任何變更。');
  }
  var b1 = backupSheet_(SHEET.PARTICIPANTS);
  var b2 = backupSheet_(SHEET.DRAW);
  unlockSheets_();
  clearDataRows_(SHEET.PARTICIPANTS);
  clearDataRows_(SHEET.DRAW);
  writeSetting_('draw_id', '');
  writeSetting_('draw_timestamp', '');
  writeSetting_('next_participant_no', '1');
  writeSetting_('status', STATUS.OPEN);
  SpreadsheetApp.flush();
  logOperation_('CLEAR_TEST_DATA', '', 'SUCCESS', '清除報名 ' + people.length + ' 筆、配對 ' + draws.length + ' 筆；備份：' + b1 + '、' + b2);
  return '已清除。網站回到「報名中」。備份在隱藏工作表「' + b1 + '」「' + b2 + '」。';
}

/* ------------------------------------------------------------------ */
/* Admin helpers                                                       */
/* ------------------------------------------------------------------ */

function backupSheet_(name) {
  var src = sheet_(name);
  var label = '備份_' + name + '_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss');
  var copy = src.copyTo(ss_());
  copy.setName(label);
  copy.hideSheet();
  return label;
}

function clearDataRows_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), 1)).clearContent();
}

function lockSheets_() {
  [SHEET.DRAW, SHEET.PARTICIPANTS].forEach(function (name) {
    var p = sheet_(name).protect();
    p.setDescription(PROTECT_TAG + '：抽籤後請勿修改，否則配對會不一致');
    p.setWarningOnly(true);
  });
}

function unlockSheets_() {
  [SHEET.DRAW, SHEET.PARTICIPANTS].forEach(function (name) {
    sheet_(name).getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) {
      if (String(p.getDescription()).indexOf(PROTECT_TAG) === 0) p.remove();
    });
  });
}

function logOperation_(operation, targetId, result, details) {
  try {
    var operator = '';
    try { operator = Session.getActiveUser().getEmail(); } catch (e) { operator = ''; }
    appendRecord_(SHEET.LOG, LOG_HEADERS, {
      log_id: 'L-' + Utilities.getUuid(),
      operation: operation,
      target_id: targetId || '',
      operator: operator || '（執行環境未提供使用者）',
      timestamp: nowText_(),
      result: result,
      details: details || ''
    });
  } catch (err) {
    console.error('log failed', err);
  }
}

/* ------------------------------------------------------------------ */
/* First-time setup                                                    */
/* ------------------------------------------------------------------ */

function setupSheets() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);
  ensureSheet_(SHEET.SETTINGS, ['field', 'value', 'note']);
  ensureSheet_(SHEET.PARTICIPANTS, PARTICIPANT_HEADERS);
  ensureSheet_(SHEET.DRAW, DRAW_HEADERS);
  ensureSheet_(SHEET.LOG, LOG_HEADERS);

  var settings = ss.getSheetByName(SHEET.SETTINGS);
  var existing = {};
  settings.getDataRange().getValues().slice(1).forEach(function (r) { existing[String(r[0]).trim()] = true; });
  SETTINGS_DEFAULTS.forEach(function (row) {
    if (!existing[row[0]]) settings.appendRow(row);
  });
  var statusRow = settings.getDataRange().getValues().map(function (r) { return String(r[0]).trim(); }).indexOf('status');
  if (statusRow > 0) {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(ALL_STATUSES, true).setAllowInvalid(false).build();
    settings.getRange(statusRow + 1, 2).setDataValidation(rule);
  }
  try {
    SpreadsheetApp.getUi().alert('初始化完成', '已建立活動設定、參加名單、抽籤結果、操作紀錄。\n請檢查「活動設定」的活動資訊與報名截止時間。', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* run from the editor: no UI */ }
}

function ensureSheet_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  // Store everything as plain text so Sheets never re-interprets emails, numbers or dates.
  sh.getRange(1, 1, sh.getMaxRows(), Math.max(headers.length, sh.getMaxColumns())).setNumberFormat('@');
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

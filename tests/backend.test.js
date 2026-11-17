'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('../dev/gas-mock');

const BEFORE_DEADLINE = new Date('2026-11-17T10:00:00+08:00');
const AFTER_DEADLINE = new Date('2026-11-25T00:00:01+08:00');

function fresh() {
  const gas = createGas({ now: BEFORE_DEADLINE, operator: 'organizer@example.com' });
  gas.context.setupSheets();
  return gas;
}

function rows(gas, name) {
  return gas.context.readTable_(name);
}

function setStatus(gas, status) {
  gas.context.writeSetting_('status', status);
}

function register(gas, name, email, keyword) {
  return gas.call('registerParticipant', { name, email, keyword });
}

function seed(gas, n) {
  const kws = ['毛毛的', '香香的', '閃亮亮的', '軟軟的', '甜甜的', '暖暖的', '亮晶晶的', '圓圓的'];
  for (let i = 0; i < n; i++) {
    const r = register(gas, '朋友' + (i + 1), `friend${i + 1}@example.com`, kws[i % kws.length]);
    assert.equal(r.success, true, JSON.stringify(r));
  }
}

function admin(gas, fnName) {
  return gas.context[fnName](gas.ui);
}

function adminError(gas, fnName) {
  try {
    admin(gas, fnName);
  } catch (err) {
    return err;
  }
  assert.fail(fnName + ' should have failed');
}

/* ---------- setup & event info ---------- */

test('setup creates the four sheets with default settings', () => {
  const gas = fresh();
  for (const n of ['活動設定', '參加名單', '抽籤結果', '操作紀錄']) {
    assert.ok(gas.ss.getSheetByName(n), n + ' missing');
  }
  const s = gas.context.readSettings_();
  assert.equal(s.event_name, 'H組聖誕趴－交換禮物大會');
  assert.equal(s.registration_deadline, '2026-11-24 23:59');
  assert.equal(s.next_participant_no, '1');
  // Running setup twice must not duplicate settings rows.
  gas.context.setupSheets();
  const keys = gas.ss.getSheetByName('活動設定').getDataRange().getValues().slice(1).map((r) => r[0]);
  assert.equal(new Set(keys).size, keys.length);
});

test('getEventInfo reads from Sheets and counts only ACTIVE participants', () => {
  const gas = fresh();
  let r = gas.call('getEventInfo');
  assert.deepEqual(r.data, {
    eventName: 'H組聖誕趴－交換禮物大會', eventDate: '2026-12-18', budgetMin: 500, budgetMax: 600,
    registrationDeadline: '2026-11-24 23:59', status: 'REGISTRATION_OPEN', participantCount: 0
  });
  seed(gas, 3);
  gas.ss.active = gas.ss.getSheetByName('參加名單');
  gas.ss.active.activeRow = 2;
  admin(gas, 'deleteSelected_');
  r = gas.call('getEventInfo');
  assert.equal(r.data.participantCount, 2);
  const viaGet = JSON.parse(gas.context.doGet({ parameter: {} }).getContent());
  assert.equal(viaGet.data.participantCount, 2);
});

test('status comes from Sheets; past the deadline OPEN is reported as CLOSED', () => {
  const gas = fresh();
  setStatus(gas, 'DRAW_PUBLISHED');
  assert.equal(gas.call('getEventInfo').data.status, 'DRAW_PUBLISHED');
  setStatus(gas, 'REGISTRATION_OPEN');
  gas.clock.now = AFTER_DEADLINE;
  assert.equal(gas.call('getEventInfo').data.status, 'REGISTRATION_CLOSED');
});

/* ---------- registration ---------- */

test('register writes to Sheets and returns a participant number', () => {
  const gas = fresh();
  const r = register(gas, ' Amy ', ' Amy@Example.COM ', ' 毛毛的 ');
  assert.equal(r.success, true);
  assert.equal(r.data.participantNo, 'No.001');
  assert.equal(r.data.name, 'Amy');
  assert.equal(r.data.keyword, '毛毛的');
  const list = rows(gas, '參加名單');
  assert.equal(list.length, 1);
  assert.equal(list[0].email_normalized, 'amy@example.com');
  assert.equal(list[0].registration_status, 'ACTIVE');
  assert.match(list[0].participant_id, /^P-/);
  assert.equal(gas.context.readSettings_().next_participant_no, '2');
});

test('duplicate email (different case / spaces) is rejected; no second row', () => {
  const gas = fresh();
  register(gas, 'Amy', 'amy@example.com', '毛毛的');
  const r = register(gas, 'Amy 2', '  AMY@example.com ', '香香的');
  assert.equal(r.success, false);
  assert.equal(r.error.code, 'DUPLICATE');
  assert.equal(r.error.message, '這個 Email 已經報名囉！');
  assert.equal(rows(gas, '參加名單').length, 1);
});

test('gmail dots / plus are NOT stripped (they count as different emails)', () => {
  const gas = fresh();
  assert.equal(register(gas, 'A', 'a.b@gmail.com', 'x').success, true);
  assert.equal(register(gas, 'B', 'ab@gmail.com', 'x').success, true);
  assert.equal(register(gas, 'C', 'ab+1@gmail.com', 'x').success, true);
});

test('same name and same keyword are allowed with different emails', () => {
  const gas = fresh();
  assert.equal(register(gas, '小魚', 'a@example.com', '毛毛的').data.participantNo, 'No.001');
  assert.equal(register(gas, '小魚', 'b@example.com', '毛毛的').data.participantNo, 'No.002');
});

test('validation errors use the PRD messages and write nothing', () => {
  const gas = fresh();
  const cases = [
    [{ name: '', email: 'a@example.com', keyword: 'x' }, 'REQUIRED', '這個欄位還沒填寫喔！'],
    [{ name: 'A', email: 'not-an-email', keyword: 'x' }, 'INVALID_EMAIL', '請輸入正確的 Email 格式'],
    [{ name: 'A', email: 'a@example', keyword: 'x' }, 'INVALID_EMAIL', '請輸入正確的 Email 格式'],
    [{ name: 'A'.repeat(31), email: 'a@example.com', keyword: 'x' }, 'NAME_TOO_LONG', '名字最多 30 個字'],
    [{ name: 'A', email: 'a@example.com', keyword: '字'.repeat(21) }, 'KEYWORD_TOO_LONG', '形容詞最多 20 個字']
  ];
  for (const [payload, code, message] of cases) {
    const r = gas.call('registerParticipant', payload);
    assert.equal(r.success, false);
    assert.equal(r.error.code, code);
    assert.equal(r.error.message, message);
  }
  assert.equal(register(gas, 'A'.repeat(30), 'a@example.com', '字'.repeat(20)).success, true);
  assert.equal(rows(gas, '參加名單').length, 1);
});

test('registration is refused after the deadline and when the organizer closes it', () => {
  const gas = fresh();
  setStatus(gas, 'REGISTRATION_CLOSED');
  let r = register(gas, 'A', 'a@example.com', 'x');
  assert.equal(r.error.code, 'CLOSED');
  assert.equal(r.error.message, '報名已經結束囉！');
  setStatus(gas, 'REGISTRATION_OPEN');
  gas.clock.now = AFTER_DEADLINE;
  r = register(gas, 'A', 'a@example.com', 'x');
  assert.equal(r.error.code, 'CLOSED');
  assert.equal(rows(gas, '參加名單').length, 0);
});

test('a failed Sheets write never reports success', () => {
  const gas = fresh();
  gas.ss.getSheetByName('參加名單').failWrites = true;
  const r = register(gas, 'A', 'a@example.com', 'x');
  assert.equal(r.success, false);
  assert.equal(r.error.code, 'SERVER_ERROR');
  assert.equal(r.error.message, '目前無法取得資料，請再試一次');
  gas.ss.getSheetByName('參加名單').failWrites = false;
  assert.equal(rows(gas, '參加名單').length, 0);
  // The reserved number is skipped, never reused.
  assert.equal(register(gas, 'A', 'a@example.com', 'x').data.participantNo, 'No.002');
});

/* ---------- lookup & update ---------- */

test('getRegistration returns only that person; unknown email is NOT_FOUND', () => {
  const gas = fresh();
  seed(gas, 3);
  const r = gas.call('getRegistration', { email: ' FRIEND2@example.com' });
  assert.deepEqual(r.data, { participantNo: 'No.002', name: '朋友2', email: 'friend2@example.com', keyword: '香香的', canEdit: true });
  const miss = gas.call('getRegistration', { email: 'nobody@example.com' });
  assert.equal(miss.error.code, 'NOT_FOUND');
  assert.equal(miss.error.message, '找不到你的報名紀錄，請確認 Email 是否正確');
});

test('updateRegistration changes name/keyword, keeps id and number, adds no row', () => {
  const gas = fresh();
  seed(gas, 2);
  const before = rows(gas, '參加名單')[0];
  gas.clock.now = new Date(BEFORE_DEADLINE.getTime() + 60000);
  const r = gas.call('updateRegistration', { email: 'friend1@example.com', name: '新名字', keyword: '軟綿綿的' });
  assert.equal(r.success, true);
  const after = rows(gas, '參加名單');
  assert.equal(after.length, 2);
  assert.equal(after[0].participant_id, before.participant_id);
  assert.equal(after[0].participant_no, 'No.001');
  assert.equal(after[0].name, '新名字');
  assert.equal(after[0].keyword, '軟綿綿的');
  assert.equal(after[0].email, before.email);
  assert.notEqual(after[0].updated_at, before.updated_at);
});

test('update is refused after the deadline even from a stale page', () => {
  const gas = fresh();
  seed(gas, 1);
  gas.clock.now = AFTER_DEADLINE;
  const r = gas.call('updateRegistration', { email: 'friend1@example.com', name: 'X', keyword: 'Y' });
  assert.equal(r.error.code, 'CLOSED');
  assert.equal(rows(gas, '參加名單')[0].name, '朋友1');
  assert.equal(gas.call('getRegistration', { email: 'friend1@example.com' }).data.canEdit, false);
});

/* ---------- draw ---------- */

test('derangement: nobody draws themselves, everyone gives and receives exactly once', () => {
  const gas = fresh();
  for (let n = 2; n <= 15; n++) {
    const ids = Array.from({ length: n }, (_, i) => 'P' + i);
    for (let run = 0; run < 300; run++) {
      const out = gas.context.derange_(ids);
      assert.equal(out.length, n);
      assert.equal(new Set(out).size, n);
      out.forEach((r, i) => assert.notEqual(r, ids[i]));
    }
  }
  assert.throws(() => gas.context.derange_(['only']), /至少需要 2 位/);
});

test('draw is blocked while registration is open, with fewer than 2 people, or twice', () => {
  const gas = fresh();
  seed(gas, 1);
  assert.match(adminError(gas, 'runDraw_').message, /報名還在進行中/);
  setStatus(gas, 'REGISTRATION_CLOSED');
  assert.match(adminError(gas, 'runDraw_').message, /至少需要 2 位/);
  setStatus(gas, 'REGISTRATION_OPEN');
  seed2(gas);
  setStatus(gas, 'REGISTRATION_CLOSED');
  admin(gas, 'runDraw_');
  setStatus(gas, 'REGISTRATION_CLOSED');
  assert.match(adminError(gas, 'runDraw_').message, /已經有抽籤結果/);
});

function seed2(gas) {
  assert.equal(register(gas, '第二位', 'second@example.com', '圓圓的').success, true);
}

test('two people are paired with each other', () => {
  const gas = fresh();
  seed(gas, 2);
  setStatus(gas, 'REGISTRATION_CLOSED');
  admin(gas, 'runDraw_');
  const people = rows(gas, '參加名單');
  const pairs = rows(gas, '抽籤結果');
  assert.equal(pairs.length, 2);
  const a = pairs.find((p) => p.sender_id === people[0].participant_id);
  assert.equal(a.receiver_id, people[1].participant_id);
  assert.equal(a.assigned_keyword, people[1].keyword);
});

test('draw stores a complete valid result, sets DRAW_READY, and does not publish', () => {
  const gas = fresh();
  seed(gas, 7);
  gas.clock.now = AFTER_DEADLINE; // OPEN past the deadline counts as closed
  admin(gas, 'runDraw_');
  const s = gas.context.readSettings_();
  assert.equal(s.status, 'DRAW_READY');
  assert.match(s.draw_id, /^D-/);
  const people = rows(gas, '參加名單');
  const pairs = rows(gas, '抽籤結果');
  assert.deepEqual(Array.from(gas.context.validatePairs_(pairs, people)), []);
  pairs.forEach((p) => assert.equal(p.draw_id, s.draw_id));
  assert.equal(gas.call('getMyAssignment', { email: 'friend1@example.com' }).error.code, 'PENDING');
  assert.ok(gas.ss.getSheetByName('抽籤結果').protections.length >= 1, 'sheet should be warning-protected');
  assert.ok(rows(gas, '操作紀錄').some((l) => l.operation === 'RUN_DRAW' && l.result === 'SUCCESS'));
});

test('cancelling the confirmation changes nothing', () => {
  const gas = fresh();
  seed(gas, 3);
  setStatus(gas, 'REGISTRATION_CLOSED');
  gas.ui.answers.push('NO');
  assert.equal(adminError(gas, 'runDraw_').code, 'CANCELLED');
  assert.equal(rows(gas, '抽籤結果').length, 0);
  assert.equal(gas.context.readSettings_().status, 'REGISTRATION_CLOSED');
});

/* ---------- publish & assignment ---------- */

function drawAndPublish(gas, n = 5) {
  seed(gas, n);
  setStatus(gas, 'REGISTRATION_CLOSED');
  admin(gas, 'runDraw_');
  admin(gas, 'publishDraw_');
}

test('publish needs DRAW_READY and moves to DRAW_PUBLISHED', () => {
  const gas = fresh();
  seed(gas, 3);
  setStatus(gas, 'REGISTRATION_CLOSED');
  assert.match(adminError(gas, 'publishDraw_').message, /只有 DRAW_READY 才能公布/);
  admin(gas, 'runDraw_');
  admin(gas, 'publishDraw_');
  assert.equal(gas.context.readSettings_().status, 'DRAW_PUBLISHED');
  assert.equal(gas.call('getEventInfo').data.status, 'DRAW_PUBLISHED');
});

test('publish refuses results that no longer match the participants', () => {
  const gas = fresh();
  seed(gas, 4);
  setStatus(gas, 'REGISTRATION_CLOSED');
  admin(gas, 'runDraw_');
  const target = rows(gas, '參加名單')[2];
  gas.context.updateRecord_('參加名單', target._row, { keyword: '被偷改了' });
  assert.match(adminError(gas, 'publishDraw_').message, /不能公布[\s\S]*形容詞已被修改/);
  assert.equal(gas.context.readSettings_().status, 'DRAW_READY');
});

test('assignment returns only my keyword; fixed across queries; no receiver data', () => {
  const gas = fresh();
  drawAndPublish(gas, 6);
  const people = rows(gas, '參加名單');
  const pairs = rows(gas, '抽籤結果');
  for (const me of people) {
    const r1 = gas.call('getMyAssignment', { email: me.email.toUpperCase() });
    const r2 = gas.call('getMyAssignment', { email: me.email });
    assert.equal(r1.success, true);
    assert.deepEqual(r1.data, r2.data);
    assert.deepEqual(Object.keys(r1.data).sort(), ['assignedKeyword', 'budgetMax', 'budgetMin', 'eventDate', 'name', 'participantNo']);
    const pair = pairs.find((p) => p.sender_id === me.participant_id);
    const receiver = people.find((p) => p.participant_id === pair.receiver_id);
    assert.equal(r1.data.assignedKeyword, receiver.keyword);
    const raw = JSON.stringify(r1);
    assert.ok(!raw.includes(receiver.participant_id) && !raw.includes(receiver.email), 'receiver leaked');
  }
  assert.equal(gas.call('getMyAssignment', { email: 'stranger@example.com' }).error.code, 'NOT_FOUND');
  assert.equal(gas.call('getMyAssignment', { email: 'bad' }).error.code, 'INVALID_EMAIL');
  // Querying never changes the stored pairs.
  assert.deepEqual(rows(gas, '抽籤結果'), pairs);
});

test('COMPLETED still allows looking up the existing task', () => {
  const gas = fresh();
  drawAndPublish(gas, 3);
  setStatus(gas, 'COMPLETED');
  assert.equal(gas.call('getMyAssignment', { email: 'friend1@example.com' }).success, true);
});

test('after publishing: reset, delete and clear are all blocked', () => {
  const gas = fresh();
  drawAndPublish(gas, 3);
  assert.match(adminError(gas, 'resetDraw_').message, /已公布/);
  gas.ss.getSheetByName('參加名單').activeRow = 2;
  gas.ss.active = gas.ss.getSheetByName('參加名單');
  assert.match(adminError(gas, 'deleteSelected_').message, /已公布/);
  assert.match(adminError(gas, 'clearTestData_').message, /已公布/);
  assert.equal(rows(gas, '抽籤結果').length, 3);
});

/* ---------- organizer management ---------- */

test('reset clears pairs (with backup), keeps registrations, returns to CLOSED', () => {
  const gas = fresh();
  seed(gas, 4);
  setStatus(gas, 'REGISTRATION_CLOSED');
  admin(gas, 'runDraw_');
  admin(gas, 'resetDraw_');
  const s = gas.context.readSettings_();
  assert.equal(s.status, 'REGISTRATION_CLOSED');
  assert.equal(s.draw_id, '');
  assert.equal(s.draw_timestamp, '');
  assert.equal(rows(gas, '抽籤結果').length, 0);
  assert.equal(rows(gas, '參加名單').length, 4);
  const backup = gas.ss.getSheets().find((sh) => sh.name.startsWith('備份_抽籤結果_'));
  assert.ok(backup && backup.hidden);
  assert.equal(gas.ss.getSheetByName('抽籤結果').protections.length, 0);
  admin(gas, 'runDraw_'); // can draw again after reset
  assert.equal(rows(gas, '抽籤結果').length, 4);
});

test('delete soft-deletes; email can re-register; numbers are not reused', () => {
  const gas = fresh();
  seed(gas, 3);
  const sheet = gas.ss.getSheetByName('參加名單');
  gas.ss.active = sheet;
  sheet.activeRow = 3; // friend2
  admin(gas, 'deleteSelected_');
  const list = rows(gas, '參加名單');
  assert.equal(list[1].registration_status, 'DELETED');
  assert.ok(list[1].deleted_at);
  assert.equal(list.length, 3, 'row kept for recovery');
  assert.equal(list[0].participant_no, 'No.001');
  assert.equal(list[2].participant_no, 'No.003');
  assert.equal(gas.call('getRegistration', { email: 'friend2@example.com' }).error.code, 'NOT_FOUND');
  const again = register(gas, '朋友2', 'friend2@example.com', '新的');
  assert.equal(again.data.participantNo, 'No.004');
  assert.equal(gas.call('getEventInfo').data.participantCount, 3);
});

test('delete is blocked in DRAW_READY and requires selecting a participant row', () => {
  const gas = fresh();
  seed(gas, 3);
  const sheet = gas.ss.getSheetByName('參加名單');
  gas.ss.active = gas.ss.getSheetByName('活動設定');
  assert.match(adminError(gas, 'deleteSelected_').message, /請先到「參加名單」/);
  gas.ss.active = sheet;
  sheet.activeRow = 1;
  assert.match(adminError(gas, 'deleteSelected_').message, /不是標題列/);
  setStatus(gas, 'REGISTRATION_CLOSED');
  admin(gas, 'runDraw_');
  sheet.activeRow = 2;
  assert.match(adminError(gas, 'deleteSelected_').message, /請先「重置抽籤結果」/);
});

test('clear test data wipes registrations and pairs but keeps event settings', () => {
  const gas = fresh();
  gas.context.writeSetting_('event_name', '測試活動名稱');
  seed(gas, 4);
  setStatus(gas, 'REGISTRATION_CLOSED');
  admin(gas, 'runDraw_');
  gas.ui.answers.push({ button: 'OK', text: '不要' });
  assert.equal(adminError(gas, 'clearTestData_').code, 'CANCELLED');
  assert.equal(rows(gas, '參加名單').length, 4);
  admin(gas, 'clearTestData_'); // default answer types 清除
  const s = gas.context.readSettings_();
  assert.equal(rows(gas, '參加名單').length, 0);
  assert.equal(rows(gas, '抽籤結果').length, 0);
  assert.equal(s.status, 'REGISTRATION_OPEN');
  assert.equal(s.next_participant_no, '1');
  assert.equal(s.draw_id, '');
  assert.equal(s.event_name, '測試活動名稱');
  assert.equal(s.budget_min, '500');
  assert.ok(gas.ss.getSheets().some((sh) => sh.name.startsWith('備份_參加名單_')));
  assert.equal(register(gas, 'A', 'a@example.com', 'x').data.participantNo, 'No.001');
});

test('menu wrapper logs failures and shows the reason', () => {
  const gas = fresh();
  gas.context.menuRunDraw();
  const last = gas.ui.alerts[gas.ui.alerts.length - 1];
  assert.match(last.title, /未執行/);
  assert.ok(rows(gas, '操作紀錄').some((l) => l.result === 'FAILED'));
  assert.ok(rows(gas, '操作紀錄').every((l) => l.operator === 'organizer@example.com'));
});

/* ---------- web surface ---------- */

test('only public actions are reachable from the web', () => {
  const gas = fresh();
  for (const action of ['runDraw_', 'publishDraw_', 'resetDraw_', 'clearTestData_', 'deleteSelected_', 'setupSheets', 'menuRunDraw', 'readParticipants_']) {
    const r = gas.call(action);
    assert.equal(r.success, false);
    assert.equal(r.error.code, 'BAD_REQUEST');
  }
  const bad = JSON.parse(gas.context.doPost({ postData: { contents: '{nope' } }).getContent());
  assert.equal(bad.error.code, 'BAD_REQUEST');
  const getOther = JSON.parse(gas.context.doGet({ parameter: { action: 'getMyAssignment' } }).getContent());
  assert.equal(getOther.error.code, 'BAD_REQUEST');
});

test('no public response ever contains the participant list', () => {
  const gas = fresh();
  drawAndPublish(gas, 4);
  const responses = [
    gas.call('getEventInfo'),
    gas.call('getRegistration', { email: 'friend1@example.com' }),
    gas.call('getMyAssignment', { email: 'friend1@example.com' })
  ].map((r) => JSON.stringify(r));
  for (const text of responses) {
    for (const other of ['friend2@example.com', 'friend3@example.com', 'friend4@example.com']) {
      assert.ok(!text.includes(other), 'leaked ' + other);
    }
  }
});

/* Secret Gift front end: hash router + views P01–P09, wired to the Apps Script API. */
(function () {
  'use strict';

  var api = window.SGApi;
  var B = window.Buddy;
  var app = document.getElementById('app');

  var state = {
    event: null,        // getEventInfo()
    registered: null,   // P03 data after registering
    reg: null,          // P05 data after looking up a registration
    assignment: null,   // P09 data after the mission login
    prefill: ''         // email carried between pages
  };

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var LIMIT = { name: 30, keyword: 20 };
  var MSG = {
    REQUIRED: '這個欄位還沒填寫喔！',
    INVALID_EMAIL: '請輸入正確的 Email 格式',
    DUPLICATE: '這個 Email 已經報名囉！',
    NOT_FOUND: '找不到你的報名紀錄，請確認 Email 是否正確',
    CLOSED: '報名已經結束囉！',
    PENDING: '秘密任務還在準備中，敬請期待！',
    ERROR: '目前無法取得資料，請再試一次',
    LOADING: '資料處理中，請稍候',
    SUCCESS: '你的秘密願望已經送出！',
    UPDATED: '你的報名資料已經更新！',
    NAME_TOO_LONG: '名字最多 30 個字',
    KEYWORD_TOO_LONG: '形容詞最多 20 個字'
  };

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  var teardown = [];
  function onCleanup(fn) { teardown.push(fn); }
  function cleanup() { while (teardown.length) { try { teardown.pop()(); } catch (e) { /* ignore */ } } }
  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    onCleanup(function () { target.removeEventListener(type, fn, opts); });
  }
  function later(fn, ms) { var t = setTimeout(fn, ms); onCleanup(function () { clearTimeout(t); }); return t; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function pct(n, d) { return (n / d * 100).toFixed(3) + '%'; }
  function at(x, y, w, W, H) { return 'left:' + pct(x, W) + ';top:' + pct(y, H) + (w != null ? ';width:' + pct(w, W) : ''); }

  function bud(o, cls, style) {
    return '<div class="buddy ' + (cls || '') + '" data-buddy="' + esc(JSON.stringify(o)) + '"' +
      (style ? ' style="' + style + '"' : '') + '>' + B.svg(o) + '</div>';
  }
  function setBuddy(el, patch) {
    if (!el) return;
    var o = JSON.parse(el.getAttribute('data-buddy'));
    var changed = false;
    Object.keys(patch).forEach(function (k) { if (o[k] !== patch[k]) { o[k] = patch[k]; changed = true; } });
    if (!changed) return;
    el.setAttribute('data-buddy', JSON.stringify(o));
    el.innerHTML = B.svg(o);
  }

  var WD = ['日', '一', '二', '三', '四', '五', '六'];
  function ymd(str) {
    str = String(str || '');
    // Google Sheets date cells arrive as UTC timestamps (e.g. 2026-12-17T16:00:00.000Z): read them in Taipei time.
    if (/T\d{2}:\d{2}/.test(str) && /(Z|[+-]\d{2}:?\d{2})$/.test(str)) {
      var t = new Date(str);
      if (!isNaN(t)) {
        var tw = new Date(t.getTime() + 8 * 3600 * 1000);
        str = tw.getUTCFullYear() + '-' + (tw.getUTCMonth() + 1) + '-' + tw.getUTCDate();
      }
    }
    var m = str.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    return { y: y, m: mo, d: d, w: WD[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()] };
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function fmtLong(str) { var p = ymd(str); return p ? p.y + '/' + two(p.m) + '/' + two(p.d) + '（' + p.w + '）' : esc(str); }
  function fmtShort(str) { var p = ymd(str); return p ? p.m + '/' + p.d + '（' + p.w + '）' : esc(str); }
  function fmtMD(str) { var p = ymd(str); return p ? p.m + '/' + p.d : esc(str); }
  function budget(min, max) { return 'NT$' + min + '–' + max; }

  function statusInfo(s) {
    switch (s) {
      case 'REGISTRATION_OPEN': return { label: '報名中', dot: 'green' };
      case 'DRAW_PUBLISHED': return { label: '秘密任務已公布', dot: 'green' };
      case 'COMPLETED': return { label: '活動結束', dot: 'orange' };
      default: return { label: '報名截止／等待抽籤', dot: 'yellow' };
    }
  }

  var ICON = {
    arrow: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    back: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    lock: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#171717" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    gift: '<svg class="inline-gift" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="10" width="18" height="11" rx="2" fill="#FF6A00"/><rect x="2" y="7" width="20" height="5" rx="1.5" fill="#FF6A00"/><rect x="10.5" y="7" width="3" height="14" fill="#009C63"/><path d="M12 7c-2-4-6-3.5-5-1s5 1 5 1c0 0 4 1.5 5-1s-3-3-5 1z" fill="#009C63"/></svg>'
  };
  var DOTS = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';

  function topMain(right) {
    return '<header class="topbar"><a class="wordmark" href="#/"><i aria-hidden="true"></i>Secret Gift</a>' + (right || '') + '</header>';
  }
  function topBack(href, label) {
    return '<header class="topbar topbar-back"><a class="back" href="' + href + '" aria-label="' + label + '">' + ICON.back +
      '</a><span class="wordmark-sm">Secret Gift</span></header>';
  }
  var LOOKUP_PILL = '<a class="pill-link" href="#/lookup">查看／修改報名</a>';

  function mount(title, html, cls) {
    document.title = title + '｜Secret Gift';
    app.innerHTML = '<main class="page ' + (cls || '') + '">' + html + '</main>';
    window.scrollTo(0, 0);
  }

  function toast(msg, kind) {
    var old = $('.toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast' + (kind === 'error' ? ' toast-error' : '');
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    t.innerHTML = '<span class="toast-icon" aria-hidden="true">' + (kind === 'error' ? '!' : ICON.check) + '</span><span>' + esc(msg) + '</span>';
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('toast-out'); }, 2400);
    setTimeout(function () { t.remove(); }, 2800);
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    if (busy) {
      btn.setAttribute('data-label', btn.innerHTML);
      btn.innerHTML = MSG.LOADING + DOTS;
      btn.disabled = true;
      btn.classList.add('is-busy');
      btn.setAttribute('aria-busy', 'true');
    } else if (btn.hasAttribute('data-label')) {
      btn.innerHTML = btn.getAttribute('data-label');
      btn.removeAttribute('data-label');
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
    }
  }

  /* Form field with an optional character peeking from behind the input. */
  function field(o) {
    var peek = o.peek ? '<div class="peek" id="pk-' + o.id + '" aria-hidden="true">' +
      bud({ who: o.peek, mood: o.mood || 'open', legs: false, lookX: -0.7, lookY: 0.7 }) + '</div>' : '';
    return '<div class="field" data-field="' + o.id + '">' +
      '<label for="f-' + o.id + '">' + o.label + '</label>' +
      '<div class="input-wrap">' + peek +
      '<input class="inp" id="f-' + o.id + '" name="' + o.id + '"' +
      (o.type ? ' type="' + o.type + '"' : '') +
      (o.autocomplete ? ' autocomplete="' + o.autocomplete + '"' : ' autocomplete="off"') +
      (o.maxlength ? ' maxlength="' + o.maxlength + '"' : '') +
      (o.inputmode ? ' inputmode="' + o.inputmode + '"' : '') +
      ' placeholder="' + esc(o.placeholder || '') + '" value="' + esc(o.value || '') + '" aria-describedby="m-' + o.id + '">' +
      '</div>' +
      '<p class="help" id="m-' + o.id + '"' + (o.help ? '' : ' hidden') + ' data-help="' + esc(o.help || '') + '">' + (o.help || '') + '</p>' +
      '</div>';
  }

  /* Field error handling shared by every form. */
  function fieldUi(id, moods) {
    var input = $('#f-' + id);
    var peek = $('#pk-' + id);
    var msg = $('#m-' + id);
    var focused = false, error = false;
    moods = moods || { idle: 'open', focus: 'happy' };
    function sync() {
      if (peek) {
        peek.classList.toggle('up', focused || error);
        setBuddy(peek.firstElementChild, { mood: error ? 'wow' : (focused ? moods.focus : moods.idle) });
      }
    }
    listen(input, 'focus', function () { focused = true; sync(); });
    listen(input, 'blur', function () { focused = false; sync(); });
    return {
      input: input,
      value: function () { return input.value.trim(); },
      error: function (text, extraHtml) {
        error = !!text;
        input.classList.toggle('err', error);
        input.setAttribute('aria-invalid', error ? 'true' : 'false');
        if (error) {
          msg.hidden = false;
          msg.className = 'err-msg';
          msg.setAttribute('role', 'alert');
          msg.innerHTML = '<span>' + esc(text) + (extraHtml || '') + '</span>';
        } else {
          msg.className = 'help';
          msg.removeAttribute('role');
          msg.innerHTML = msg.getAttribute('data-help');
          msg.hidden = !msg.getAttribute('data-help');
        }
        sync();
      }
    };
  }

  function emailError(v) {
    if (!v) return MSG.REQUIRED;
    if (!EMAIL_RE.test(v)) return MSG.INVALID_EMAIL;
    return '';
  }
  function textError(v, max, tooLong) {
    if (!v) return MSG.REQUIRED;
    if (v.length > max) return tooLong;
    return '';
  }

  /* ---------------------------------------------------------------- */
  /* Router                                                            */
  /* ---------------------------------------------------------------- */

  function route() { return location.hash.replace(/^#\/?/, '').split('?')[0]; }
  function go(path) {
    if (route() === path) render();
    else location.hash = '#/' + path;
  }
  function stage() {
    var s = state.event.status;
    if (s === 'REGISTRATION_OPEN') return 1;
    if (s === 'DRAW_PUBLISHED' || s === 'COMPLETED') return 3;
    return 2;
  }

  function render() {
    cleanup();
    if (!state.event) return;
    var r = route(), st = stage(), view;
    if (r === 'join') view = st === 1 ? viewJoin : viewClosed;
    else if (r === 'joined') view = state.registered ? viewJoined : '';
    else if (r === 'lookup') view = st === 1 ? viewLookup : '';
    else if (r === 'edit') view = st !== 1 ? viewClosed : (state.reg ? viewEdit : 'lookup');
    else if (r === 'mission') view = st === 3 ? viewMissionLogin : (st === 2 ? viewPending : '');
    else if (r === 'task') view = st === 3 ? (state.assignment ? viewTask : 'mission') : '';
    else view = st === 1 ? viewHome : (st === 2 ? viewWaiting : viewMissionHome);

    if (typeof view === 'string') {
      if (view === r) view = viewHome;
      else { location.replace('#/' + view); return; }
    }
    view();
    var h1 = $('main h1');
    if (h1) { h1.setAttribute('tabindex', '-1'); }
  }

  /** Re-read the event from Sheets (used when landing on a home screen). */
  var refreshing = null;
  function refreshEvent() {
    if (refreshing) return refreshing;
    refreshing = api.getEventInfo().then(function (ev) {
      refreshing = null;
      var before = state.event;
      state.event = ev;
      var stageChanged = !before || before.status !== ev.status;
      if (stageChanged || JSON.stringify(ev) !== JSON.stringify(before)) {
        if (stageChanged || route() === '') render();
      }
      return stageChanged;
    }, function () { refreshing = null; return false; });
    return refreshing;
  }

  function handleStale(err) {
    if (err.code === 'CLOSED' || err.code === 'PENDING') {
      refreshEvent();
      if (err.code === 'CLOSED') viewClosed(); else viewPending();
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Boot, loading & fatal error                                       */
  /* ---------------------------------------------------------------- */

  function viewLoading() {
    document.title = 'Secret Gift';
    app.innerHTML = '<main class="page page-center" aria-busy="true">' +
      bud({ who: 'zing', mood: 'open', legs: false, lookY: 0.8 }, 'hop center-buddy') +
      '<p class="center-text" role="status">' + MSG.LOADING + DOTS + '</p></main>';
  }

  function viewFatal(err) {
    cleanup();
    var text = err && err.code === 'NOT_CONFIGURED' ? err.message : MSG.ERROR;
    mount('發生錯誤', topMain() +
      '<div class="state-block">' + bud({ who: 'pine', mood: 'wow', legs: false }, 'state-buddy') +
      '<h1 class="state-title">' + esc(text) + '</h1>' +
      '<button type="button" class="btn btn-ghost" id="retry">再試一次</button></div>');
    $('#retry').addEventListener('click', boot);
  }

  function boot() {
    viewLoading();
    api.getEventInfo().then(function (ev) {
      state.event = ev;
      render();
    }, viewFatal);
  }

  /* ---------------------------------------------------------------- */
  /* P01 · Home (registration open)                                    */
  /* ---------------------------------------------------------------- */

  function infoGrid(ev, lastLabel, lastValue) {
    return '<section class="info-grid" aria-label="活動資訊">' +
      '<div><p>活動日期</p><strong>' + fmtLong(ev.eventDate) + '</strong></div>' +
      '<div><p>禮物預算</p><strong>' + budget(ev.budgetMin, ev.budgetMax) + '</strong></div>' +
      '<div><p>報名截止</p><strong>' + fmtLong(ev.registrationDeadline) + '</strong></div>' +
      '<div><p>' + lastLabel + '</p><strong>' + lastValue + '</strong></div></section>';
  }

  function viewHome() {
    var ev = state.event;
    var W = 390, H = 172;
    mount('報名交換禮物', topMain(LOOKUP_PILL) +
      '<div class="intro">' +
        '<span class="status"><i class="dot green"></i>報名中 · ' + fmtShort(ev.registrationDeadline) + '截止</span>' +
        '<p class="event-name">' + esc(ev.eventName) + '</p>' +
        '<h1 class="h1 h1-l">留下一個<span class="hl">形容詞</span>，<br>換一份驚喜。</h1>' +
        '<p class="lead">說出你想收到什麼樣的禮物，再替另一位朋友準備一份。誰送給誰，' + fmtMD(ev.eventDate) + ' 當天才揭曉。</p>' +
      '</div>' +
      '<div class="stage" style="aspect-ratio:' + W + '/' + H + ';margin-top:10px" aria-hidden="true">' +
        bud({ who: 'momo', mood: 'open', legs: false }, 'abs bob eye', at(92, 12, 150, W, H) + ';z-index:1') +
        bud({ who: 'boxi', mood: 'open', legs: false }, 'abs eye', at(196, 34, 124, W, H) + ';z-index:1') +
        '<div class="abs lid-kraft" style="left:' + pct(8, W) + ';right:' + pct(8, W) + ';top:' + pct(120, H) + ';bottom:0;z-index:2"></div>' +
        bud({ who: 'pine', mood: 'open', arms: 'down' }, 'abs eye', at(2, 26, 104, W, H) + ';z-index:3') +
        bud({ who: 'zing', mood: 'open', arms: 'up' }, 'abs hop eye', at(290, 30, 100, W, H) + ';z-index:3') +
      '</div>' +
      '<div class="giftbox">' +
        '<a class="btn btn-dark" href="#/join" id="hot">我要參加交換禮物' + ICON.arrow + '</a>' +
        '<a class="text-link text-link-left" href="#/lookup">已經報名了？查看／修改報名</a>' +
      '</div>' +
      infoGrid(ev, '參加人數', '已有 ' + Number(ev.participantCount || 0) + ' 人報名') +
      '<section class="howto" aria-labelledby="howto">' +
        '<h2 class="h2" id="howto">怎麼玩？</h2><ol>' +
        '<li>' + bud({ who: 'bloom', mood: 'calm', legs: false }, 'step-buddy') + '<div>' +
          '<p class="step-no">STEP 01</p><p class="step-title">留下你的形容詞</p>' +
          '<p class="step-text">填寫一個你希望收到的禮物形容詞，例如：</p>' +
          '<div class="tags"><span class="tag">毛毛的</span><span class="tag tag-pink">香香的</span><span class="tag tag-purple">閃亮亮的</span></div>' +
        '</div></li>' +
        '<li>' + bud({ who: 'pine', mood: 'sly', legs: false }, 'step-buddy') + '<div>' +
          '<p class="step-no">STEP 02</p><p class="step-title">等待秘密配對</p>' +
          '<p class="step-text">報名截止後，由主辦人確認名單並統一進行隨機配對。</p></div></li>' +
        '<li>' + bud({ who: 'boxi', mood: 'happy', legs: false }, 'step-buddy') + '<div>' +
          '<p class="step-no">STEP 03</p><p class="step-title">準備驚喜禮物</p>' +
          '<p class="step-text">查看自己抽中的形容詞，依照關鍵詞準備 ' + budget(ev.budgetMin, ev.budgetMax) + ' 的禮物，活動當天才揭曉送禮對象。</p></div></li>' +
        '</ol></section>' +
      '<div class="actions">' +
        '<a class="btn" href="#/join">我要參加交換禮物</a>' +
        '<a class="text-link" href="#/lookup">查看／修改報名</a>' +
      '</div>', 'page-home');

    eyeFollow($$('.eye'));
    var hot = $('#hot');
    var moodsHot = { pine: 'sly', momo: 'happy', boxi: 'happy', zing: 'wow' };
    function setHot(on) {
      $$('.eye').forEach(function (el) {
        var who = JSON.parse(el.getAttribute('data-buddy')).who;
        setBuddy(el, { mood: on ? moodsHot[who] : 'open' });
      });
    }
    listen(hot, 'mouseenter', function () { setHot(true); });
    listen(hot, 'mouseleave', function () { setHot(false); });
    listen(hot, 'focus', function () { setHot(true); });
    listen(hot, 'blur', function () { setHot(false); });
  }

  function eyeFollow(els) {
    var target = null, raf = 0;
    function defaultTarget() {
      var h = $('main h1');
      if (!h) return null;
      var r = h.getBoundingClientRect();
      return { x: r.left + r.width * 0.4, y: r.top + r.height / 2 };
    }
    function apply() {
      raf = 0;
      var t = target || defaultTarget();
      if (!t) return;
      els.forEach(function (el) {
        var o = JSON.parse(el.getAttribute('data-buddy'));
        var r = el.getBoundingClientRect();
        var a = B.faceAnchor(o.who);
        var dx = t.x - (r.left + r.width * a.x), dy = t.y - (r.top + r.height * a.y);
        var d = Math.max(Math.hypot(dx, dy), 80);
        setBuddy(el, { lookX: Math.round(dx / d * 10) / 10, lookY: Math.round(dy / d * 10) / 10 });
      });
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(apply); }
    listen(document, 'pointermove', function (e) { target = { x: e.clientX, y: e.clientY }; schedule(); });
    listen(document, 'pointerleave', function () { target = null; schedule(); });
    listen(window, 'scroll', schedule, { passive: true });
    onCleanup(function () { if (raf) cancelAnimationFrame(raf); });
    apply();
  }

  /* ---------------------------------------------------------------- */
  /* P02 · Registration form                                           */
  /* ---------------------------------------------------------------- */

  function viewJoin() {
    mount('報名表單', topBack('#/', '返回首頁') +
      '<div class="intro">' +
        '<p class="eyebrow">STEP 01 · 留下你的形容詞</p>' +
        '<h1 class="h1 h1-s">報名交換禮物</h1>' +
        '<p class="lead">三個欄位就完成。最重要的是最後一題：你想收到什麼樣的禮物？</p>' +
      '</div>' +
      '<form class="form" id="form" novalidate>' +
        field({ id: 'name', label: '你的名字', placeholder: '大家平常怎麼叫你？', autocomplete: 'nickname', maxlength: LIMIT.name, peek: 'momo' }) +
        field({ id: 'email', label: '你的 Email', type: 'email', placeholder: 'example@gmail.com', autocomplete: 'email', inputmode: 'email', peek: 'boxi',
          value: state.prefill, help: '之後只需要輸入這個 Email，就能查看你的秘密任務！' }) +
        field({ id: 'keyword', label: '你想收到什麼樣的禮物？', placeholder: '例如：毛毛的', maxlength: LIMIT.keyword, peek: 'bloom', mood: 'calm',
          help: '請填寫一個形容詞，不要直接指定商品喔！<br>主辦方會把你踢掉重寫：（' }) +
        '<div class="actions actions-tight">' +
          '<button type="submit" class="btn" id="submit">送出報名</button>' +
          '<a class="text-link" href="#/">返回首頁</a>' +
        '</div>' +
      '</form>', 'page-form');

    var f = {
      name: fieldUi('name'),
      email: fieldUi('email'),
      keyword: fieldUi('keyword', { idle: 'calm', focus: 'happy' })
    };
    var tried = false, busy = false;
    function validate() {
      var errs = {
        name: textError(f.name.value(), LIMIT.name, MSG.NAME_TOO_LONG),
        email: emailError(f.email.value()),
        keyword: textError(f.keyword.value(), LIMIT.keyword, MSG.KEYWORD_TOO_LONG)
      };
      Object.keys(errs).forEach(function (k) { f[k].error(errs[k]); });
      return !errs.name && !errs.email && !errs.keyword;
    }
    Object.keys(f).forEach(function (k) { listen(f[k].input, 'input', function () { if (tried) validate(); }); });

    listen($('#form'), 'submit', function (e) {
      e.preventDefault();
      if (busy) return;
      tried = true;
      if (!validate()) { $('.inp.err').focus(); return; }
      busy = true;
      var btn = $('#submit');
      setBusy(btn, true);
      api.registerParticipant({ name: f.name.value(), email: f.email.value(), keyword: f.keyword.value() })
        .then(function (data) {
          state.registered = data;
          state.prefill = '';
          state.event.participantCount = Number(state.event.participantCount || 0) + 1;
          go('joined');
        }, function (err) {
          busy = false;
          setBusy(btn, false);
          if (handleStale(err)) return;
          if (err.code === 'DUPLICATE') {
            f.email.error(MSG.DUPLICATE, ' <a href="#/lookup" id="dup-link">查看／修改報名 →</a>');
            var link = $('#dup-link');
            if (link) link.addEventListener('click', function () { state.prefill = f.email.value(); });
            f.email.input.focus();
          } else if (err.code === 'INVALID_EMAIL' || (err.code === 'REQUIRED' && !f.email.value())) {
            f.email.error(MSG[err.code]);
          } else if (err.code === 'NAME_TOO_LONG') {
            f.name.error(MSG.NAME_TOO_LONG);
          } else if (err.code === 'KEYWORD_TOO_LONG') {
            f.keyword.error(MSG.KEYWORD_TOO_LONG);
          } else {
            toast(MSG.ERROR, 'error');
          }
        });
    });
  }

  /* ---------------------------------------------------------------- */
  /* P03 · Registered                                                  */
  /* ---------------------------------------------------------------- */

  function confetti(W, H, items) {
    return items.map(function (c, i) {
      return '<span class="abs pop confetti confetti-' + c[2] + '" style="' + at(c[0], c[1], null, W, H) +
        ';animation-delay:' + (0.1 + i * 0.05).toFixed(2) + 's"></span>';
    }).join('');
  }

  function viewJoined() {
    var d = state.registered;
    var W = 390, H = 236;
    mount('報名成功', topMain(LOOKUP_PILL) +
      '<div class="stage" style="aspect-ratio:' + W + '/' + H + '" aria-hidden="true">' +
        confetti(W, H, [[34, 30, 'pink'], [96, 16, 'tri-green'], [158, 50, 'green'], [196, 12, 'squiggle'], [258, 56, 'purple'],
          [300, 22, 'sq-yellow'], [350, 74, 'orange'], [64, 84, 'yellow'], [118, 70, 'plus'], [326, 120, 'tri-pink']]) +
        bud({ who: 'momo', mood: 'happy', arms: 'up' }, 'abs jump', at(40, 124, 112, W, H)) +
        bud({ who: 'zing', mood: 'happy', arms: 'up' }, 'abs jump-hi', at(142, 132, 104, W, H) + ';animation-delay:.08s') +
        bud({ who: 'bloom', mood: 'happy', arms: 'up' }, 'abs jump', at(238, 128, 108, W, H) + ';animation-delay:.16s') +
        '<span class="abs ground" style="top:' + pct(228, H) + '"></span>' +
      '</div>' +
      '<div class="center" role="status">' +
        '<h1 class="h1 h1-xl">報名成功！</h1>' +
        '<p class="sub">' + MSG.SUCCESS + '</p>' +
      '</div>' +
      '<div class="ticket">' +
        '<p class="ticket-label">SECRET GIFT · 交換禮物</p>' +
        '<p class="caption mt10">參加編號</p>' +
        '<p class="ticket-no">' + esc(d.participantNo) + '</p>' +
        '<div class="ticket-cut" aria-hidden="true"></div>' +
        '<dl class="dl">' +
          '<div><dt>姓名</dt><dd>' + esc(d.name) + '</dd></div>' +
          '<div><dt>Email</dt><dd>' + esc(d.email) + '</dd></div>' +
          '<div><dt>我的形容詞</dt><dd><span class="tag">' + esc(d.keyword) + '</span></dd></div>' +
          '<div><dt>活動狀態</dt><dd class="with-dot"><i class="dot yellow"></i>等待秘密配對</dd></div>' +
        '</dl>' +
      '</div>' +
      '<p class="note">報名成功！等大家都準備好後，就會開放查看你的秘密任務，記得再回來看看！</p>' +
      '<div class="actions"><a class="btn" href="#/">返回首頁</a></div>', 'page-joined');
  }

  /* ---------------------------------------------------------------- */
  /* P04 · Look up a registration                                      */
  /* ---------------------------------------------------------------- */

  function emailCard(o) {
    return '<form class="peek-card" id="form" novalidate>' +
      '<div class="peek peek-card-buddy peek-' + o.who + '" id="pk-email" aria-hidden="true">' +
        bud({ who: o.who, mood: o.mood, legs: false, lookX: -0.6, lookY: 0.8 }) + '</div>' +
      '<div class="card">' +
        '<label class="label" for="f-email">' + o.label + '</label>' +
        '<div class="input-wrap"><input class="inp" id="f-email" type="email" inputmode="email" autocomplete="email" placeholder="example@gmail.com" value="' +
          esc(state.prefill) + '" aria-describedby="m-email"></div>' +
        '<p class="help" id="m-email" data-help="' + esc(o.help) + '">' + esc(o.help) + '</p>' +
      '</div>' +
      '<div class="actions">' +
        '<button type="submit" class="btn" id="submit">' + o.button + '</button>' +
        '<a class="text-link" href="#/">返回首頁</a>' +
      '</div>' +
    '</form>';
  }

  function bottomPeekers(left, right) {
    return '<div class="peekers" aria-hidden="true">' +
      bud({ who: left, mood: 'open', legs: false, lookX: 0.3, lookY: -1 }, 'bob peeker-left') +
      bud({ who: right, mood: 'open', legs: false, lookX: -0.4, lookY: -1 }, 'bob peeker-right') +
    '</div>';
  }

  function emailForm(opts) {
    var f = fieldUi('email', opts.moods);
    var tried = false, busy = false;
    listen(f.input, 'input', function () { if (tried) f.error(emailError(f.value())); });
    listen($('#form'), 'submit', function (e) {
      e.preventDefault();
      if (busy) return;
      tried = true;
      var err = emailError(f.value());
      f.error(err);
      if (err) { f.input.focus(); return; }
      busy = true;
      var btn = $('#submit');
      setBusy(btn, true);
      opts.request(f.value()).then(function (data) {
        state.prefill = f.value();
        opts.done(data, f.value());
      }, function (e2) {
        busy = false;
        setBusy(btn, false);
        if (handleStale(e2)) return;
        if (e2.code === 'NOT_FOUND' || e2.code === 'INVALID_EMAIL' || e2.code === 'REQUIRED') {
          f.error(MSG[e2.code]);
          f.input.focus();
        } else {
          toast(MSG.ERROR, 'error');
        }
      });
    });
  }

  function viewLookup() {
    mount('查詢報名', topBack('#/', '返回首頁') +
      '<div class="intro">' +
        '<p class="eyebrow">查看／修改報名</p>' +
        '<h1 class="h1 h1-m">想看看<br>你填了什麼嗎？</h1>' +
        '<p class="lead narrow">輸入報名時使用的 Email，就能找到你的報名資料。</p>' +
      '</div>' +
      emailCard({ who: 'bloom', mood: 'calm', label: '你的 Email', help: '不需要密碼，也不用收驗證信。', button: '查詢我的報名' }) +
      bottomPeekers('momo', 'boxi'), 'page-email');
    emailForm({
      moods: { idle: 'calm', focus: 'open' },
      request: function (email) { return api.getRegistration(email); },
      done: function (data, email) {
        state.reg = { participantNo: data.participantNo, name: data.name, email: data.email || email, keyword: data.keyword };
        if (data.canEdit === false) { refreshEvent(); viewClosed(); return; }
        go('edit');
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* P05 · View / edit a registration                                  */
  /* ---------------------------------------------------------------- */

  function viewEdit() {
    var reg = state.reg;
    mount('查看／修改報名', topBack('#/lookup', '取消並返回上一頁') +
      '<div class="intro">' +
        '<span class="status"><i class="dot green"></i>報名中 · ' + fmtShort(state.event.registrationDeadline) + '前可以修改</span>' +
        '<h1 class="h1 h1-s mt12">你的報名資料</h1>' +
        '<p class="lead">名字和形容詞都可以改，報名截止後就會鎖起來囉。</p>' +
      '</div>' +
      '<form class="card edit-card" id="form" novalidate>' +
        '<dl class="dl">' +
          '<div><dt>參加編號</dt><dd class="with-icon num">' + esc(reg.participantNo) + '<span class="lock" role="img" aria-label="無法修改">' + ICON.lock + '</span></dd></div>' +
          '<div><dt>Email</dt><dd class="with-icon">' + esc(reg.email) + '<span class="lock" role="img" aria-label="無法修改">' + ICON.lock + '</span></dd></div>' +
        '</dl>' +
        '<p class="caption small">有鎖頭的欄位無法修改。</p>' +
        '<div class="card-cut" aria-hidden="true"></div>' +
        '<div class="edit-fields">' +
          field({ id: 'name', label: '你的名字', placeholder: '大家平常怎麼叫你？', maxlength: LIMIT.name, peek: 'momo', value: reg.name }) +
          field({ id: 'keyword', label: '你想收到什麼樣的禮物？', placeholder: '例如：毛毛的', maxlength: LIMIT.keyword, peek: 'bloom', mood: 'calm',
            value: reg.keyword, help: '請填寫一個形容詞，不要直接指定商品喔！' }) +
        '</div>' +
      '</form>' +
      '<div class="actions actions-stack">' +
        '<button type="button" class="btn" id="save">儲存修改</button>' +
        '<p class="caption center-text" id="save-hint" hidden></p>' +
        '<a class="btn btn-ghost" href="#/lookup">取消</a>' +
      '</div>', 'page-edit');

    var f = { name: fieldUi('name'), keyword: fieldUi('keyword', { idle: 'calm', focus: 'happy' }) };
    var btn = $('#save'), hint = $('#save-hint');
    var busy = false;
    function errors() {
      return {
        name: textError(f.name.value(), LIMIT.name, MSG.NAME_TOO_LONG),
        keyword: textError(f.keyword.value(), LIMIT.keyword, MSG.KEYWORD_TOO_LONG)
      };
    }
    function sync() {
      var e = errors();
      f.name.error(e.name);
      f.keyword.error(e.keyword);
      var changed = f.name.value() !== state.reg.name || f.keyword.value() !== state.reg.keyword;
      var blocked = !changed || !!e.name || !!e.keyword;
      if (busy) return;
      btn.disabled = blocked;
      btn.classList.toggle('is-disabled', blocked);
      hint.hidden = !blocked;
      hint.textContent = (e.name || e.keyword) ? '請先把欄位填完整' : '還沒有修改任何內容';
    }
    listen(f.name.input, 'input', sync);
    listen(f.keyword.input, 'input', sync);
    listen($('#form'), 'submit', function (e) { e.preventDefault(); if (!btn.disabled) btn.click(); });
    listen(btn, 'click', function () {
      if (busy || btn.disabled) return;
      busy = true;
      hint.hidden = true;
      setBusy(btn, true);
      api.updateRegistration({ email: state.reg.email, name: f.name.value(), keyword: f.keyword.value() }).then(function (data) {
        state.reg.name = data.name;
        state.reg.keyword = data.keyword;
        busy = false;
        setBusy(btn, false);
        sync();
        toast(MSG.UPDATED);
      }, function (err) {
        busy = false;
        setBusy(btn, false);
        if (handleStale(err)) return;
        if (err.code === 'NOT_FOUND') { toast(MSG.NOT_FOUND, 'error'); go('lookup'); return; }
        if (err.code === 'NAME_TOO_LONG') f.name.error(MSG.NAME_TOO_LONG);
        else if (err.code === 'KEYWORD_TOO_LONG') f.keyword.error(MSG.KEYWORD_TOO_LONG);
        else toast(MSG.ERROR, 'error');
        sync();
      });
    });
    sync();
  }

  /* ---------------------------------------------------------------- */
  /* P06 · Registration closed / waiting for the draw                  */
  /* ---------------------------------------------------------------- */

  function holder(who, mood, left, boxTop, boxH, color, ribbon, delay, look) {
    var W = 390, H = 210;
    var o = { who: who, mood: mood, arms: 'hold' };
    if (look) { o.lookX = look[0]; o.lookY = look[1]; }
    return '<div class="abs sway holder" style="' + at(left, 89, 116, W, H) + ';animation-delay:' + delay + 's">' +
      bud(o) +
      '<div class="held-box" style="top:' + pct(boxTop, 112) + ';height:' + pct(boxH, 112) + ';background:' + color + ';--ribbon:' + ribbon + '"></div>' +
    '</div>';
  }

  function viewWaiting() {
    var ev = state.event, si = statusInfo(ev.status);
    var W = 390, H = 210;
    mount('等待抽籤', topMain() +
      '<div class="intro">' +
        '<span class="status"><i class="dot yellow"></i>報名截止 · 等待抽籤</span>' +
        '<p class="event-name">' + esc(ev.eventName) + '</p>' +
        '<h1 class="h1 h1-38">願望收集完成！</h1>' +
        '<p class="lead">報名已經截止！等大家都確認好後，就會開放查看秘密任務，敬請期待' + ICON.gift + '</p>' +
      '</div>' +
      '<div class="stage" style="aspect-ratio:' + W + '/' + H + ';margin-top:14px" aria-hidden="true">' +
        '<div class="abs float bubble-wrap" style="top:' + pct(6, H) + '"><span class="bubble bubble-down">秘密配對準備中⋯</span></div>' +
        holder('pine', 'sly', 17, 75, 28, '#FFB900', '#FA63A7', 0) +
        holder('momo', 'open', 137, 69, 30, '#009C63', '#FFB900', 0.4, [0.1, 1]) +
        holder('bloom', 'calm', 257, 69, 30, '#FF6A00', '#009C63', 0.8) +
        '<span class="abs ground" style="top:' + pct(198, H) + '"></span>' +
      '</div>' +
      '<dl class="dl dl-box">' +
        '<div><dt>活動日期</dt><dd>' + fmtLong(ev.eventDate) + '</dd></div>' +
        '<div><dt>禮物預算</dt><dd>' + budget(ev.budgetMin, ev.budgetMax) + '</dd></div>' +
        '<div><dt>活動狀態</dt><dd class="with-dot"><i class="dot ' + si.dot + '"></i>' + si.label + '</dd></div>' +
      '</dl>' +
      '<div class="actions"><button type="button" class="btn btn-ghost" id="home">返回首頁</button></div>', 'page-waiting');
    listen($('#home'), 'click', function () {
      var btn = $('#home');
      setBusy(btn, true);
      refreshEvent().then(function (changed) {
        if (!changed && document.body.contains(btn)) { setBusy(btn, false); toast(MSG.PENDING); }
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* P07 · Home (missions published)                                   */
  /* ---------------------------------------------------------------- */

  function viewMissionHome() {
    var ev = state.event, si = statusInfo(ev.status);
    var W = 390, H = 262;
    mount('秘密任務', topMain() +
      '<div class="intro">' +
        '<span class="status"><i class="dot ' + si.dot + '"></i>' + si.label + '</span>' +
        '<p class="event-name">' + esc(ev.eventName) + '</p>' +
        '<h1 class="h1 h1-xl">你的秘密<br>任務來了！</h1>' +
        '<p class="lead">大家的願望已經完成配對，快來看看今年你要準備什麼樣的禮物吧！</p>' +
      '</div>' +
      '<div class="stage" style="aspect-ratio:' + W + '/' + H + ';margin-top:18px">' +
        '<p class="abs bubble bubble-right" style="' + at(24, 6, 148, W, H) + '">現在可以查看你的交換禮物任務！</p>' +
        bud({ who: 'pine', mood: 'sly', legs: false }, 'abs rise', at(115, 20, 160, W, H) + ';z-index:1') +
        '<div class="abs envelope wiggle" aria-hidden="true" style="' + at(110, 124, 170, W, H) + ';height:' + pct(104, H) + '">' +
          '<svg class="envelope-flap" viewBox="0 0 166 100" preserveAspectRatio="none"><path d="M2 2 L83 56 L164 2" fill="none" stroke="#171717" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>' +
          '<span class="seal">密</span><span class="hand hand-l"></span><span class="hand hand-r"></span>' +
        '</div>' +
        bud({ who: 'momo', mood: 'happy', arms: 'up' }, 'abs', at(16, 177, 90, W, H) + ';z-index:2') +
        bud({ who: 'zing', mood: 'wow', arms: 'up', lookX: -0.8, lookY: -0.3 }, 'abs hop', at(290, 177, 90, W, H) + ';z-index:2') +
        '<span class="abs ground" style="top:' + pct(260, H) + '"></span>' +
      '</div>' +
      infoGrid(ev, '活動狀態', si.label) +
      '<div class="actions"><a class="btn" href="#/mission">查看我的秘密任務' + ICON.arrow + '</a></div>', 'page-mission-home');
  }

  /* ---------------------------------------------------------------- */
  /* P08 · Mission login                                               */
  /* ---------------------------------------------------------------- */

  function viewMissionLogin() {
    mount('查看秘密任務', topBack('#/', '返回首頁') +
      '<div class="intro">' +
        '<p class="eyebrow">STEP 02 · 查看秘密任務</p>' +
        '<h1 class="h1 h1-s">準備好揭曉你的<br>秘密任務了嗎？</h1>' +
        '<p class="lead narrow">輸入報名時使用的 Email，就可以查看你抽中的形容詞！</p>' +
      '</div>' +
      emailCard({ who: 'pine', mood: 'sly', label: '報名時的 Email', help: '不需要密碼或驗證碼，查到就直接打開任務。', button: '查看秘密任務' }) +
      bottomPeekers('zing', 'boxi'), 'page-email');
    emailForm({
      moods: { idle: 'sly', focus: 'open' },
      request: function (email) { return api.getMyAssignment(email); },
      done: function (data) {
        state.assignment = data;
        go('task');
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* P09 · Mission result                                              */
  /* ---------------------------------------------------------------- */

  function viewTask() {
    var a = state.assignment;
    var W = 390, H = 430;
    var adj = esc(a.assignedKeyword);
    var len = String(a.assignedKeyword || '').length;
    var adjSize = len <= 4 ? 46 : len <= 6 ? 36 : len <= 10 ? 28 : 22;
    mount('你的秘密任務', topBack('#/', '返回首頁') +
      '<div class="intro intro-task" aria-live="polite">' +
        '<p class="eyebrow">嗨，' + esc(a.name) + ' · ' + esc(a.participantNo) + '</p>' +
        '<div class="when-closed"><h1 class="h1 h1-xs">你的任務已經準備好了</h1><p class="lead mt8">點一下禮物盒，揭開你抽中的形容詞。</p></div>' +
        '<div class="when-open"><h2 class="h1 h1-xs">你抽中的形容詞是……</h2></div>' +
      '</div>' +
      '<div class="stage reveal" id="reveal" style="aspect-ratio:' + W + '/' + H + '">' +
        '<svg class="abs rays" viewBox="0 0 200 110" aria-hidden="true" style="' + at(95, 122, 200, W, H) + '"><path d="M34 74 L16 66 M54 44 L42 30 M146 44 L158 30 M166 74 L184 66" fill="none" stroke="#171717" stroke-width="4" stroke-linecap="round"/></svg>' +
        '<span class="abs conf conf-1" aria-hidden="true" style="' + at(60, 84, null, W, H) + '"></span>' +
        '<span class="abs conf conf-2" aria-hidden="true" style="' + at(312, 96, null, W, H) + '"></span>' +
        '<span class="abs conf conf-3" aria-hidden="true" style="' + at(74, 196, null, W, H) + '"></span>' +
        '<span class="abs conf conf-4" aria-hidden="true" style="' + at(300, 190, null, W, H) + '"></span>' +
        '<span class="abs adj" style="top:' + pct(98, H) + ';font-size:' + adjSize + 'px">' + adj + '</span>' +
        '<div class="abs hint when-closed" style="top:' + pct(110, H) + '" aria-hidden="true"><span>點一下打開' + ICON.down + '</span></div>' +
        '<button type="button" class="abs giftbtn" id="gift" aria-label="打開禮物盒，揭開我的任務" style="' + at(88, 164, 214, W, H) + ';height:' + pct(254, H) + '"></button>' +
        '<div class="abs box" aria-hidden="true" style="' + at(100, 230, 190, W, H) + ';height:' + pct(188, H) + '"></div>' +
        '<div class="abs lid" aria-hidden="true" style="' + at(88, 192, 214, W, H) + ';height:' + pct(46, H) + '">' +
          '<svg class="bow" viewBox="0 0 84 36"><ellipse cx="23" cy="19" rx="21" ry="12" transform="rotate(20 23 19)" fill="#009C63"/><ellipse cx="61" cy="19" rx="21" ry="12" transform="rotate(-20 61 19)" fill="#009C63"/><circle cx="42" cy="28" r="10" fill="#009C63"/></svg>' +
        '</div>' +
        bud({ who: 'momo', mood: 'open', arms: 'down', lookX: 0.9, lookY: -0.1 }, 'abs', at(-18, 298, 130, W, H) + ';z-index:2') +
        bud({ who: 'zing', mood: 'open', arms: 'down', lookX: -0.9, lookY: -0.1 }, 'abs', at(290, 316, 110, W, H) + ';z-index:2') +
        '<span class="abs ground" style="top:' + pct(417, H) + ';z-index:4"></span>' +
      '</div>' +
      '<div class="task-text">' +
        '<div class="when-closed"><button type="button" class="btn" id="reveal-btn">揭開我的任務</button>' +
          '<p class="caption center-text mt8">送禮對象會保密到 ' + fmtMD(a.eventDate) + ' 當天。</p></div>' +
        '<div class="when-open"><p class="task-main">請準備一份符合這個形容詞、<br>預算 ' + budget(a.budgetMin, a.budgetMax) + ' 的禮物！</p>' +
          '<p class="task-sub">至於這份禮物要送給誰，就等 ' + fmtMD(a.eventDate) + ' 當天揭曉吧！</p></div>' +
      '</div>' +
      '<dl class="dl dl-box dl-white">' +
        '<div><dt>姓名</dt><dd>' + esc(a.name) + '</dd></div>' +
        '<div><dt>參加編號</dt><dd class="num">' + esc(a.participantNo) + '</dd></div>' +
        '<div><dt>抽中的形容詞</dt><dd><span class="tag when-open">' + adj + '</span><span class="tag tag-pending when-closed">等你揭開</span></dd></div>' +
        '<div><dt>禮物預算</dt><dd>' + budget(a.budgetMin, a.budgetMax) + '</dd></div>' +
        '<div><dt>活動日期</dt><dd>' + fmtLong(a.eventDate) + '</dd></div>' +
        '<div><dt>送禮對象</dt><dd class="with-icon">保密中<span class="lock">' + ICON.lock + '</span></dd></div>' +
      '</dl>' +
      '<div class="actions actions-stack when-open">' +
        '<button type="button" class="btn" id="copy">' + ICON.copy + '複製關鍵詞</button>' +
        '<a class="btn btn-ghost" href="#/">返回首頁</a>' +
      '</div>', 'page-task');

    var page = $('main');
    var buddies = $$('#reveal .buddy');
    function open() {
      if (page.classList.contains('is-open')) return;
      page.classList.add('is-open');
      $('#gift').setAttribute('aria-label', '形容詞已揭曉：' + a.assignedKeyword);
      setBuddy(buddies[0], { mood: 'wow', arms: 'up', lookX: 0.6, lookY: -0.9 });
      setBuddy(buddies[1], { mood: 'happy', arms: 'up', lookY: -0.6 });
      buddies[1].classList.add('jump-once');
      later(function () { var h = $('.when-open h2', page); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } }, 400);
    }
    listen($('#gift'), 'click', open);
    listen($('#reveal-btn'), 'click', open);
    listen($('#copy'), 'click', function () {
      var text = a.assignedKeyword;
      var ok = function () { toast('已複製「' + text + '」'); };
      var fail = function () {
        if (legacyCopy(text)) ok();
        else toast('無法自動複製，請長按「' + text + '」複製', 'error');
      };
      try {
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fail);
        else fail();
      } catch (e) { fail(); }
    });
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var done = false;
    try { done = document.execCommand('copy'); } catch (e) { done = false; }
    ta.remove();
    return done;
  }

  /* ---------------------------------------------------------------- */
  /* Shared state screens                                              */
  /* ---------------------------------------------------------------- */

  function stateScreen(title, who, mood, text) {
    cleanup();
    mount(title, topBack('#/', '返回首頁') +
      '<div class="state-block">' + bud({ who: who, mood: mood, legs: false }, 'state-buddy') +
      '<h1 class="state-title">' + text + '</h1>' +
      '<a class="btn btn-ghost" href="#/">返回首頁</a></div>', 'page-state');
  }
  function viewClosed() { stateScreen('報名已截止', 'boxi', 'calm', MSG.CLOSED); }
  function viewPending() { stateScreen('秘密任務準備中', 'bloom', 'calm', MSG.PENDING); }

  /* ---------------------------------------------------------------- */

  window.addEventListener('hashchange', function () {
    render();
    if (route() === '' && state.event) refreshEvent();
  });
  if (!location.hash) history.replaceState(null, '', '#/');
  boot();
})();

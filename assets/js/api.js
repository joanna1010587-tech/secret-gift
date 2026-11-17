/* Thin client for the Google Apps Script web app. */
(function (global) {
  'use strict';

  var TIMEOUT_MS = 25000;

  function ApiError(code, message) {
    this.name = 'ApiError';
    this.code = code;
    this.message = message || '目前無法取得資料，請再試一次';
  }
  ApiError.prototype = Object.create(Error.prototype);

  function endpoint() {
    var cfg = global.SG_CONFIG || {};
    return String(cfg.API_URL || '').trim();
  }

  /**
   * POST with a text/plain body: a "simple" CORS request, so the browser sends no preflight
   * (Apps Script web apps cannot answer OPTIONS). The script reads e.postData.contents as JSON.
   */
  function call(action, payload) {
    var url = endpoint();
    if (!url) return Promise.reject(new ApiError('NOT_CONFIGURED', '網站還沒連上 Google Sheets（config.js 的 API_URL 尚未設定）'));
    var body = JSON.stringify(Object.assign({ action: action }, payload || {}));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new ApiError('NETWORK');
      return res.json().catch(function () { throw new ApiError('SERVER_ERROR'); });
    }).then(function (json) {
      if (!json || json.success !== true) {
        var err = (json && json.error) || {};
        throw new ApiError(err.code || 'SERVER_ERROR', err.message);
      }
      return json.data;
    }, function (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('NETWORK');
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  global.SGApi = {
    ApiError: ApiError,
    getEventInfo: function () { return call('getEventInfo'); },
    registerParticipant: function (d) { return call('registerParticipant', { name: d.name, email: d.email, keyword: d.keyword }); },
    getRegistration: function (email) { return call('getRegistration', { email: email }); },
    updateRegistration: function (d) { return call('updateRegistration', { email: d.email, name: d.name, keyword: d.keyword }); },
    getMyAssignment: function (email) { return call('getMyAssignment', { email: email }); }
  };
})(window);

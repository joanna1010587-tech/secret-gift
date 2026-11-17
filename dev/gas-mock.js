'use strict';
/**
 * In-memory stand-ins for the Apps Script services Code.gs uses.
 * Lets the real backend code run in Node for tests and the local dev server.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

class Protection {
  constructor(sheet) { this.sheet = sheet; this.description = ''; this.warningOnly = false; }
  setDescription(d) { this.description = d; return this; }
  getDescription() { return this.description; }
  setWarningOnly(w) { this.warningOnly = w; return this; }
  remove() { this.sheet.protections = this.sheet.protections.filter((p) => p !== this); }
}

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((l) => l.length !== this.numCols)) {
      throw new Error('setValues dimension mismatch');
    }
    if (this.sheet.failWrites) throw new Error('Simulated Sheets write failure');
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) this.sheet.set(this.row + r, this.col + c, '');
    return this;
  }
  getRow() { return this.row; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setDataValidation() { return this; }
}

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.data = []; this.protections = []; this.hidden = false; this.activeRow = 1; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  set(row, col, v) {
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = v === null || v === undefined ? '' : (typeof v === 'number' ? v : String(v));
  }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if (this.data[r - 1].some((v) => v !== '')) return r;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.data.forEach((line) => line.forEach((v, i) => { if (v !== '') max = Math.max(max, i + 1); }));
    return max;
  }
  getMaxRows() { return Math.max(this.data.length, 1000); }
  getMaxColumns() { return Math.max(this.getLastColumn(), 26); }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows || 1, numCols || 1); }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  appendRow(values) { this.getRange(this.getLastRow() + 1, 1, 1, values.length).setValues([values]); return this; }
  setFrozenRows() { return this; }
  hideSheet() { this.hidden = true; return this; }
  copyTo(ss) {
    const copy = new Sheet(ss, 'Copy of ' + this.name);
    copy.data = this.data.map((l) => l.slice());
    ss.sheets.push(copy);
    return copy;
  }
  protect() { const p = new Protection(this); this.protections.push(p); return p; }
  getProtections() { return this.protections.slice(); }
  getActiveRange() { return new Range(this, this.activeRow, 1, 1, 1); }
}

class Spreadsheet {
  constructor() { this.sheets = []; this.active = null; this.tz = 'Asia/Taipei'; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getActiveSheet() { return this.active || this.sheets[0]; }
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function formatDate(date, tz, fmt) {
  // Only Asia/Taipei (UTC+8, no DST) is needed.
  const d = new Date(date.getTime() + 8 * 3600 * 1000);
  const map = {
    yyyy: d.getUTCFullYear(), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds())
  };
  return fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => map[k]);
}

/**
 * Builds a fresh sandbox running gas/Code.gs against an empty in-memory spreadsheet.
 * ui.answers: queue of answers for alert(YES_NO) / prompt; defaults to "yes".
 */
function createGas(options = {}) {
  const ss = new Spreadsheet();
  const ui = {
    alerts: [],
    answers: [],
    ButtonSet: { OK: 'OK', YES_NO: 'YES_NO', OK_CANCEL: 'OK_CANCEL' },
    Button: { YES: 'YES', NO: 'NO', OK: 'OK', CANCEL: 'CANCEL' },
    alert(title, text, buttons) {
      this.alerts.push({ title, text: text || '' });
      if (buttons === 'YES_NO') return this.answers.length ? this.answers.shift() : 'YES';
      return 'OK';
    },
    prompt(title, text) {
      const a = this.answers.length ? this.answers.shift() : { button: 'OK', text: '清除' };
      return { getSelectedButton: () => a.button, getResponseText: () => a.text };
    },
    createMenu() { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; }
  };
  const clock = { now: options.now || null };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0 && clock.now) super(clock.now.getTime());
      else super(...args);
    }
    static now() { return clock.now ? clock.now.getTime() : RealDate.now(); }
  }
  const context = {
    console,
    Date: FakeDate,
    Math,
    JSON,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getActive: () => ss,
      getUi: () => ui,
      flush: () => {},
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      newDataValidation: () => {
        const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) };
        return b;
      }
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} })
    },
    Utilities: { getUuid: () => crypto.randomUUID(), formatDate },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return this.text; } })
    },
    Session: { getActiveUser: () => ({ getEmail: () => options.operator || '' }) }
  };
  vm.createContext(context);
  const code = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
  vm.runInContext(code, context, { filename: 'Code.gs' });

  const call = (action, payload = {}) => {
    const out = context.doPost({ postData: { contents: JSON.stringify({ action, ...payload }) } });
    return JSON.parse(out.getContent());
  };

  return { ss, ui, clock, context, call };
}

module.exports = { createGas };

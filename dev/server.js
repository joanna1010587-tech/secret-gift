'use strict';
/**
 * Local preview: serves the site and runs the real gas/Code.gs against an in-memory spreadsheet.
 *   node dev/server.js            → http://localhost:8787
 * Organizer actions for local testing (localhost only):
 *   POST /__admin {"op":"status","value":"REGISTRATION_CLOSED"} | {"op":"draw"} | {"op":"publish"} | {"op":"reset"} | {"op":"clear"} | {"op":"dump"}
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-mock');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8787;
const LATENCY = Number(process.env.LATENCY_MS || 350);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

const gas = createGas({ operator: 'local-dev' });
gas.context.setupSheets();

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function admin(op, value) {
  const c = gas.context;
  const run = (fn) => { try { return { ok: true, message: fn(gas.ui) }; } catch (e) { return { ok: false, message: e.message }; } };
  switch (op) {
    case 'status': c.writeSetting_('status', value); return { ok: true, message: 'status = ' + value };
    case 'setting': c.writeSetting_(value.key, value.value); return { ok: true };
    case 'draw': return run(c.runDraw_);
    case 'publish': return run(c.publishDraw_);
    case 'reset': return run(c.resetDraw_);
    case 'clear': return run(c.clearTestData_);
    case 'dump': return { ok: true, settings: c.readSettings_(), participants: c.readTable_('Participants'), draws: c.readTable_('DrawResults'), log: c.readTable_('OperationLog') };
    default: return { ok: false, message: 'unknown op' };
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' && req.method === 'POST') {
    const body = await readBody(req);
    await new Promise((r) => setTimeout(r, LATENCY));
    const out = gas.context.doPost({ postData: { contents: body } });
    return send(res, 200, out.getContent());
  }
  if (url.pathname === '/__admin' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    return send(res, 200, JSON.stringify(admin(body.op, body.value)));
  }
  if (url.pathname === '/config.js') {
    return send(res, 200, "window.SG_CONFIG = { API_URL: '/api' };", TYPES['.js']);
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}).listen(PORT, () => console.log('Secret Gift local preview → http://localhost:' + PORT));

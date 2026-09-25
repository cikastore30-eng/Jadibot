'use strict';

// Bot.wawa / Tenka Multi-Bot bridge.
// The original Tenka index.js is the ONLY WhatsApp engine. Each bot runs
// the same SC in an isolated working directory, so relative auth/session
// paths used by the SC stay separate.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const SESSIONS = path.join(ROOT, 'sessions');
const WEB = path.join(ROOT, 'web');
const BOT_ENTRY = path.join(ROOT, 'index.js');
const MAX_SESSIONS = Math.max(1, Number(process.env.MAX_SESSIONS || 30));
const sessions = new Map();

fs.mkdirSync(SESSIONS, { recursive: true });

function cleanId(v) {
  return String(v || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}
function cleanPhone(v) {
  return String(v || '').replace(/\D/g, '').replace(/^0+/, '');
}
function sessionDir(id) { return path.join(SESSIONS, id); }
function stateFile(id) { return path.join(sessionDir(id), 'manager.json'); }
function ensureSessionDir(id) {
  const d = sessionDir(id);
  fs.mkdirSync(d, { recursive: true });
  // Plugins/commands remain one source tree; auth/database files created by
  // Tenka with relative paths are isolated because the child cwd is d.
  for (const name of ['Plugins', 'command', 'lib', 'Game']) {
    const target = path.join(d, name);
    if (!fs.existsSync(target)) {
      try { fs.symlinkSync(path.join(ROOT, name), target, 'junction'); } catch (_) {}
    }
  }
  return d;
}
function readMeta(id) {
  try { return JSON.parse(fs.readFileSync(stateFile(id), 'utf8')); } catch (_) { return {}; }
}
function writeMeta(s) {
  fs.mkdirSync(sessionDir(s.id), { recursive: true });
  fs.writeFileSync(stateFile(s.id), JSON.stringify({
    id: s.id,
    phone: s.phone || null,
    status: s.status || 'offline',
    pairingCode: s.pairingCode || null,
    owner: s.owner || null,
    updatedAt: new Date().toISOString()
  }, null, 2));
}
function hasAuth(id) {
  const d = sessionDir(id);
  // Covers the common names used by WhatsApp/Baileys-based SCs.
  return ['session', 'auth', 'auth_info_baileys', 'auth_info'].some(n => fs.existsSync(path.join(d, n)));
}
function extractPairingCode(text) {
  const patterns = [
    /(?:pairing\s*)?(?:code|kode)\s*[:=]\s*([A-Z0-9-]{6,20})/i,
    /(?:pairing\s*)?(?:code|kode)\s*[：]\s*([A-Z0-9-]{6,20})/i
  ];
  for (const re of patterns) { const m = String(text).match(re); if (m) return m[1]; }
  return null;
}
function parseOutput(s, chunk) {
  const text = String(chunk || '');
  s.logs = (s.logs + text).slice(-30000);
  const code = extractPairingCode(text) || extractPairingCode(s.logs);
  if (code) { s.pairingCode = code; s.status = 'pairing'; writeMeta(s); }
  if (/connection\s*[:=]?\s*open|connection\s*open|connected|tersambung|berhasil terhubung/i.test(text)) {
    s.status = 'online'; s.pairingCode = null; writeMeta(s);
  }
  if (/logged\s*out|logged out|bad session|session invalid/i.test(text)) {
    s.status = 'error'; writeMeta(s);
  }
}

function spawnTenka(s) {
  const cwd = ensureSessionDir(s.id);
  const child = spawn(process.execPath, [BOT_ENTRY], {
    cwd,
    env: {
      ...process.env,
      TENKA_SESSION_ID: s.id,
      TENKA_SESSION_DIR: cwd,
      TENKA_MULTI_BOT: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  s.child = child;
  s.pid = child.pid;
  child.stdout.on('data', d => parseOutput(s, d));
  child.stderr.on('data', d => parseOutput(s, d));
  child.on('error', err => { s.status = 'error'; s.error = err.message; s.child = null; writeMeta(s); });
  child.on('exit', (code, signal) => {
    s.child = null; s.pid = null;
    if (s.status !== 'online') s.status = code === 0 ? 'stopped' : 'error';
    writeMeta(s);
  });
  return child;
}

function startSession(id, phone, owner) {
  id = cleanId(id); phone = cleanPhone(phone);
  if (!id) throw new Error('Nama bot tidak valid.');
  if (sessions.size >= MAX_SESSIONS && !sessions.has(id)) throw new Error('Batas bot tercapai.');
  let s = sessions.get(id);
  if (!s) {
    const meta = readMeta(id);
    s = { id, phone: phone || meta.phone || '', owner: owner || meta.owner || '', status: 'stopped', pairingCode: null, logs: '' };
    sessions.set(id, s);
  } else {
    if (phone) s.phone = phone;
    if (owner) s.owner = owner;
  }
  if (s.child && !s.child.killed) return s;
  s.status = 'starting'; s.pairingCode = null; s.error = null; writeMeta(s);
  const child = spawnTenka(s);

  // The original Tenka SC requests a phone number from stdin for pairing.
  // Only feed it for a brand-new session. Existing auth should reconnect.
  if (s.phone && !hasAuth(id)) {
    setTimeout(() => {
      if (!s.child || s.child.killed) return;
      try { s.child.stdin.write(s.phone + '\n'); } catch (_) {}
    }, 2200);
  }
  return s;
}
function stopSession(id) {
  const s = sessions.get(id);
  if (!s?.child) { if (s) { s.status = 'stopped'; writeMeta(s); } return true; }
  s.status = 'stopping'; writeMeta(s);
  try { s.child.kill('SIGTERM'); } catch (_) {}
  setTimeout(() => { if (s.child && !s.child.killed) { try { s.child.kill('SIGKILL'); } catch (_) {} } }, 6000);
  return true;
}
function deleteSession(id) {
  const s = sessions.get(id);
  if (s?.child) { try { s.child.kill('SIGTERM'); } catch (_) {} }
  sessions.delete(id);
  fs.rmSync(sessionDir(id), { recursive: true, force: true });
}
function listSessions(owner) {
  const ids = new Set([...sessions.keys()]);
  for (const e of fs.readdirSync(SESSIONS, { withFileTypes: true })) if (e.isDirectory()) ids.add(e.name);
  return [...ids].map(id => {
    const s = sessions.get(id); const m = readMeta(id);
    return { id, name: id, phone: s?.phone || m.phone || null, status: s?.status || m.status || 'offline', pairingCode: s?.pairingCode || m.pairingCode || null, running: !!s?.child, pid: s?.pid || null, owner: s?.owner || m.owner || null };
  }).filter(x => !owner || x.owner === owner);
}
function body(req) { return new Promise((resolve, reject) => { let raw=''; req.on('data', c=>raw+=c); req.on('end',()=>{ try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(new Error('JSON tidak valid.'));} }); req.on('error',reject); }); }
function send(res, code, data) { const b=JSON.stringify(data); res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Bot-Owner','Cache-Control':'no-store'}); res.end(b); }
function serve(res, file, type) { try { res.writeHead(200, {'Content-Type':type,'Cache-Control':'no-store'}); res.end(fs.readFileSync(file)); } catch (_) { res.writeHead(404); res.end('Not found'); } }

// Automatically reconnect saved bots after the manager restarts.
function resumeSaved() {
  for (const e of fs.readdirSync(SESSIONS, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const m = readMeta(e.name);
    if (m.phone && hasAuth(e.name)) {
      try { startSession(e.name, m.phone, m.owner || ''); } catch (err) { console.error('Resume', e.name, err.message); }
    }
  }
}

const server = http.createServer(async (req,res)=>{
  if (req.method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Bot-Owner'}); return res.end(); }
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const owner = String(req.headers['x-bot-owner'] || '').slice(0, 80);
  try {
    if (u.pathname === '/api/health') return send(res,200,{ok:true,engine:'tenka',multiSession:true});
    if (u.pathname === '/api/sessions' && req.method === 'GET') return send(res,200,{sessions:listSessions(owner)});
    if (u.pathname === '/api/sessions' && req.method === 'POST') {
      const b=await body(req); const name=cleanId(b.name||b.id); const phone=cleanPhone(b.phone); if(!name||!phone) return send(res,400,{error:'Nama bot dan nomor WhatsApp wajib diisi.'});
      const existing=readMeta(name); if(existing.owner && owner && existing.owner!==owner) return send(res,403,{error:'Nama bot sudah digunakan.'});
      const s=startSession(name,phone,owner||existing.owner||'');
      return send(res,200,{ok:true,id:s.id,status:s.status,pairingCode:s.pairingCode||null});
    }
    const m=u.pathname.match(/^\/api\/sessions\/([^/]+)\/(start|stop|restart|delete|pair|logs)$/);
    if(m){
      const id=cleanId(m[1]); const action=m[2]; const meta=readMeta(id); if(owner && meta.owner && meta.owner!==owner) return send(res,403,{error:'Akses ditolak.'});
      if(action==='logs') return send(res,200,{id,logs:sessions.get(id)?.logs||''});
      if(action==='delete'){deleteSession(id);return send(res,200,{ok:true});}
      if(action==='stop') return send(res,200,{ok:stopSession(id)});
      const b=req.method==='POST'?await body(req):{}; const s=startSession(id,cleanPhone(b.phone)||meta.phone,owner||meta.owner||''); return send(res,200,{ok:true,id:s.id,status:s.status,pairingCode:s.pairingCode||null});
    }
    if(u.pathname==='/'||u.pathname==='/index.html') return serve(res,path.join(WEB,'index.html'),'text/html; charset=utf-8');
    if(u.pathname==='/app.js') return serve(res,path.join(WEB,'app.js'),'application/javascript; charset=utf-8');
    if(u.pathname==='/style.css') return serve(res,path.join(WEB,'style.css'),'text/css; charset=utf-8');
    res.writeHead(404);res.end('Not found');
  } catch(e){send(res,500,{error:e.message});}
});

server.listen(PORT,HOST,()=>{ console.log(`Bot.wawa / Tenka Multi-Bot listening on ${HOST}:${PORT}`); resumeSaved(); });

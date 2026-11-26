#!/usr/bin/env node
// Webflow Extractor — local preview server (no installs, Node.js only).
//   npm start, npx serve, or: node preview-server.mjs [port] [--open] → http://localhost:8080
// • Serves the site like a real host: page folders (even "article/my.site")
//   open their index.html, unknown pages get 404.html, no folder listings.
// • Lets the CMS (/cms) save straight into this folder when you click
//   Publish — only from this computer (bound to 127.0.0.1).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2);
// Also started as `npx serve` / `npx http-server` (package.json maps those
// names here), so understand their port flags: -l 3000, -p 3000, --listen tcp://:3000
function portArg() {
  for (let i = 0; i < ARGS.length; i++) {
    const a = ARGS[i], next = ARGS[i + 1] || '';
    if (/^(-l|--listen|-p|--port)$/.test(a)) { const m = /(\d+)\s*$/.exec(next); if (m) return m[1]; }
    const eq = /^--(?:listen|port)=.*?(\d+)$/.exec(a); if (eq) return eq[1];
    if (/^\d+$/.test(a) && !/^(-l|--listen|-p|--port)$/.test(ARGS[i - 1] || '')) return a;
  }
  return null;
}
const PORT = Number(portArg() || process.env.PORT || 8080);
const OPEN = ARGS.includes('--open');
const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  xml: 'application/xml', txt: 'text/plain', csv: 'text/csv', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', mp4: 'video/mp4',
  webm: 'video/webm', mov: 'video/quicktime', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf', lottie: 'application/zip', wasm: 'application/wasm',
};
const typeOf = f => TYPES[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream';

// Resolve a URL path to a file inside ROOT (never outside it)
function resolve(urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, ''); } catch { return null; }
  const abs = path.join(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  const cands = rel === '' || rel.endsWith('/') ? [path.join(abs, 'index.html')] : [path.join(abs, 'index.html'), abs];
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch {} }
  return null;
}

// ── CMS save API (same protocol as the hosted /api/fx-cms) ──────────────────
const staged = new Map();
const PROTECTED = /^(api|fx-server|netlify|node_modules|\.git|\.vercel)\/|^(middleware\.js|package\.json|netlify\.toml|preview-server\.mjs)$/;
function safePath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.split('/').some(x => x === '..' || x === '.') || PROTECTED.test(s)) throw new Error('Invalid path: ' + s);
  const abs = path.join(ROOT, s);
  if (!abs.startsWith(ROOT + path.sep)) throw new Error('Invalid path');
  return abs;
}
function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
// Only the CMS on this same site may save: other websites open in the browser
// can't (they'd need a JSON request, which browsers block across sites, and
// their Origin header wouldn't match).
function trusted(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return false;
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetch from older browsers / curl
  try { const o = new URL(origin); return ['localhost', '127.0.0.1', '[::1]'].includes(o.hostname) && o.host === req.headers.host; } catch { return false; }
}
async function api(req, res) {
  if (req.method === 'GET') return send(res, 200, { service: 'fx-cms', version: 2, configured: false, host: 'local', adapters: { local: true }, root: ROOT, pid: process.pid });
  if (!trusted(req)) return send(res, 403, { ok: false, error: 'Not allowed' });
  let body = '';
  for await (const chunk of req) body += chunk;
  let j; try { j = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: 'Bad request' }); }
  // `npm start` again for the same folder → the new server takes over
  if (j.action === 'shutdown' && j.root === ROOT) {
    send(res, 200, { ok: true });
    server.close();
    server.closeAllConnections?.();
    return setTimeout(() => process.exit(0), 100);
  }
  try {
    if (j.action === 'stage') {
      safePath(j.path);
      const ref = Math.random().toString(36).slice(2);
      staged.set(ref, Buffer.from(j.content, 'base64'));
      return send(res, 200, { ok: true, ref });
    }
    if (j.action === 'commit') {
      for (const e of j.entries || []) {
        const abs = safePath(e.path);
        if (e.delete) {
          try { fs.unlinkSync(abs); } catch {}
          try { const dir = path.dirname(abs); if (dir !== ROOT && !fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch {}
        } else {
          const buf = staged.get(e.ref);
          if (!buf) throw new Error('Missing file data for ' + e.path);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, buf);
          staged.delete(e.ref);
        }
      }
      return send(res, 200, { ok: true, saved: (j.entries || []).length });
    }
    return send(res, 400, { ok: false, error: 'Unknown action' });
  } catch (e) { return send(res, 500, { ok: false, error: e.message }); }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/fx-cms')) return await api(req, res);
    const file = resolve(req.url);
    if (!file) {
      const nf = path.join(ROOT, '404.html');
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return fs.existsSync(nf) ? fs.createReadStream(nf).pipe(res) : res.end('Not found');
    }
    // Folder without trailing slash → add it, like real hosts do
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (file.endsWith(`${path.sep}index.html`) && !rel.endsWith('/') && !rel.endsWith('index.html')) {
      res.writeHead(301, { location: encodeURI(rel) + '/' + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '') });
      return res.end();
    }
    // Range requests (videos ask for slices): without them every video is sent
    // whole and keeps a connection busy, which stalls everything else — Chrome
    // only opens 6 connections per site (Publish used to hang behind them).
    const size = fs.statSync(file).size;
    const head = { 'content-type': typeOf(file), 'cache-control': 'no-cache', 'accept-ranges': 'bytes' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { ...head, 'content-range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, 'content-length': size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(500); res.end('Error');
  }
});

// Port busy? Try the next one (8080 → 8081 → …) instead of crashing.
const HOST = process.env.HOST || '127.0.0.1';
let port = PORT, tries = 0, tookOver = false;
// Is our own (older) preview of THIS folder already on that port? Then replace
// it, so you always get the newest server on the same address.
async function takeOver(p) {
  try {
    const r = await fetch(`http://127.0.0.1:${p}/api/fx-cms`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    if (j?.service !== 'fx-cms' || j.root !== ROOT) return false;
    await fetch(`http://127.0.0.1:${p}/api/fx-cms`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'shutdown', root: ROOT }), signal: AbortSignal.timeout(1500),
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 400));
    return true;
  } catch { return false; }
}
server.on('error', async err => {
  if (err.code === 'EADDRINUSE' && !tookOver && port === PORT) {
    tookOver = true;
    if (await takeOver(port)) { console.log(`\n  Replacing the earlier preview of this site on port ${port}…`); server.listen(port, HOST); return; }
  }
  if (err.code === 'EADDRINUSE' && tries++ < 20) { port++; server.listen(port, HOST); return; }
  console.error(`\n  Couldn't start the preview: ${err.message}\n`);
  process.exit(1);
});
// Startup banner — the maker's mark: straw-hat jolly roger over CHAITANYA.
// Pixel map, 2 pixels per text row: W white · Y straw · R band · K black · . empty
const FLAG = [
  "............................................", "....WWW...............................WW....",
  "...WWWWW.............................WWWW...", "...WWWWW............YYYY............WWWWW...",
  ".WWWWWWW.........YYYYYYYYYY..........WWWWW..", "WWWWWWW........YYYYYYYYYYYYYY........WWWWWWW",
  "WWWWWWWW......YYYYYYYYYYYYYYYY......WWWWWWWW", "WWWWWWWWW....YYKYYYYYYYYYYYYYKY....WWWWWWWWW",
  ".WWW.WWWWW..YYKYKYKYYYYYYYYKYYYY..WWWWW.WWW.", "......WWWWW.YYYYYYYYYYYYYYYYYYYYY.WWWW......",
  ".......WWW........................WWW.......", "........WW.RRRRRRRRRRRRRRRRRRRRRRRWW........",
  "...........RRRRRRRRRRRRRRRRRRRRRRR..........", "...........RRRRRRRRRRRRRRRRRRRRRRR..........",
  "....YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY....", "....YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY...",
  "...........WWWWWWWWWWWWWWWWWWWWWWW..........", "..........WWWWWWKKKWWWWWWWKKWWWWWW..........",
  "...........WWWWKKKKKWWWWKKKKKKWWWW..........", "...........WWWKKKKKKKWWWKKKKKKWWW...........",
  "...........WWWKKKKKKKWWWKKKKKKWWW...........", "............WWWKKKKKWWWWKKKKKKWW............",
  ".............WWKKKKKWWWWWKKKKWWW............", "..............WWKKWWWWWWWWKKWWW.............",
  "...............WWWWWWKKWWWWWW...............", "................WWWWWWWWWWWW................",
  "...............WWWWWWWWWWWWWW...............", ".............W.WWWWKWWKWWKWWW.W.............",
  "............WW.WWWWKWWKWWKWWW.WW............", "...........WWW.WKKKKKKKKKKKKW.WWW...........",
  "..........WWWW.WWWWKWWKWWKWWW.WWWW..........", ".....WW..WWWWW.WWWWKWWKWWKWWW.WWWWW..WW.....",
  "....WWWWWWWWW..WWWWWWWWWWWWWW..WWWWWWWWW....", "....WWWWWWWW...WWWWWWWWWWWWWW...WWWWWWWW....",
  "....WWWWWWW....WWWWWWWWWWWWWW....WWWWWWW....", ".....WWWWWW.....WWWWWWWWWWWWW....WWWWWW.....",
  ".......WWWWW....WWWWWWWWWWWW....WWWWW.......", ".......WWWW......WWWWWWWWWW......WWWW.......",
  "........WWW.........WWWW.........WWW........", "............................................",
];
const NAME = [
  ' ██████╗██╗  ██╗ █████╗ ██╗████████╗ █████╗ ███╗   ██╗██╗   ██╗ █████╗ ',
  '██╔════╝██║  ██║██╔══██╗██║╚══██╔══╝██╔══██╗████╗  ██║╚██╗ ██╔╝██╔══██╗',
  '██║     ███████║███████║██║   ██║   ███████║██╔██╗ ██║ ╚████╔╝ ███████║',
  '██║     ██╔══██║██╔══██║██║   ██║   ██╔══██║██║╚██╗██║  ╚██╔╝  ██╔══██║',
  '╚██████╗██║  ██║██║  ██║██║   ██║   ██║  ██║██║ ╚████║   ██║   ██║  ██║',
  ' ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝',
];
const HAS_CMS = fs.existsSync(path.join(ROOT, 'cms', 'fx-site.json')) || fs.existsSync(path.join(ROOT, 'cms', 'index.html'));
function banner() {
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const RESET = color ? '\x1b[0m' : '';
  const PAL = { W: 231, Y: 221, R: 160, K: 16 };
  // Two stacked pixels per character: ▀ takes the top colour, its background the bottom one
  const flagRow = (top, bot) => [...top].map((t, x) => {
    const b = bot[x];
    if (!color) { const on = p => p !== '.' && p !== 'K'; return on(t) && on(b) ? '█' : on(t) ? '▀' : on(b) ? '▄' : ' '; }
    if (t === '.' && b === '.') return ' ';
    if (t === '.') return `\x1b[38;5;${PAL[b]}m▄${RESET}`;
    if (b === '.') return `\x1b[38;5;${PAL[t]}m▀${RESET}`;
    return `\x1b[38;5;${PAL[t]};48;5;${PAL[b]}m▀${RESET}`;
  }).join('');
  const fire = [226, 220, 214, 208, 202, 196]; // straw gold → pirate red, top to bottom
  const nameRow = (s, r) => !color ? s : !s.includes('█') ? `\x1b[38;5;${fire[r]}m${s}${RESET}` : s.replace(/█+|[^█]+/g, m => `\x1b[38;5;${m[0] === '█' ? fire[r] : 88}m${m}`) + RESET;
  const wordRows = NAME;
  const width = wordRows[0].length;
  const pad = ' '.repeat(2 + Math.max(0, Math.floor((width - FLAG[0].length) / 2)));
  const lines = [];
  for (let r = 0; r < FLAG.length; r += 2) lines.push((pad + flagRow(FLAG[r], FLAG[r + 1])).trimEnd());
  const gold = (s, bold) => (color ? `\x1b[${bold ? '1;' : ''}38;5;220m${s}\x1b[0m` : s);
  const soft = s => (color ? `\x1b[38;5;180m${s}\x1b[0m` : s);
  const blue = (s, bold) => (color ? `\x1b[${bold ? '1;' : ''}38;5;33m${s}\x1b[0m` : s); // Webflow blue
  const credit = 'Crafted & Developed by';
  lines.push('');
  lines.push(' '.repeat(2 + Math.floor((width - credit.length) / 2)) + soft(credit));
  lines.push('');
  wordRows.forEach((s, r) => lines.push('  ' + nameRow(s, r).trimEnd()));
  return '\n' + lines.join('\n') + '\n\n' +
    `  ${blue('WEBFLOW EXTRACTOR', true)}  ${soft('·')}  ${gold(HAS_CMS ? 'Your Webflow site, exported — with its own CMS to edit it.' : 'Your Webflow site, exported.')}\n`;
}

server.on('listening', () => {
  const base = `http://localhost:${port}`;
  console.log(banner());
  console.log(`  Your site:  ${base}`);
  if (HAS_CMS) console.log(`  CMS:        ${base}/cms/   (Publish saves into this folder)`);
  if (port !== PORT) console.log(`  (port ${PORT} is used by another program, so this uses ${port}.\n   If that's an older preview of this site, close its window or press Ctrl+C there.)`);
  console.log('\n  Keep this running while you work. Press Ctrl+C to stop.\n');
  // --open: open the browser at the port actually used (launchers pass it)
  if (OPEN) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} "${base}"`, () => {});
  }
});
server.listen(port, HOST);

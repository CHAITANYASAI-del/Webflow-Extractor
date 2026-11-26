// Publishing: where saved changes go.
//   folder → write straight into the site folder on this computer (Chrome/Edge)
//   zip    → download only the changed files (any browser)
//   github → commit to the site's GitHub repo; Vercel/Netlify/Cloudflare redeploy
//   blob   → Vercel Blob; middleware serves the edited files instantly
import JSZip from 'jszip';
import { ROOT } from './site.js';
import { idbGet, idbSet } from './storage.js';

const API = ROOT + 'api/fx-cms';
const TOKEN_KEY = 'fx-admin-token';

export const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = t => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {} };
export const logout = () => setToken(null);

const isLocalHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');

// What can this deployment do?
export async function detectServer() {
  try {
    const r = await fetch(API, { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    if (!j || j.service !== 'fx-cms') throw new Error('not fx');
    return { available: true, local: isLocalHost() || !!j.adapters?.local, ...j };
  } catch {
    return { available: false, local: isLocalHost(), adapters: {}, configured: false };
  }
}

// Never hang forever: each request gets a time limit and one retry
async function api(body, { timeout = 90000, retry = body.action === 'stage' } = {}) {
  let r;
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      r = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: 'Bearer ' + getToken() } : {}) },
        body: JSON.stringify(body),
        signal: ac.signal,
        cache: 'no-store',
      });
      break;
    } catch (e) {
      if (retry && attempt === 0) continue;
      const local = isLocalHost();
      throw new Error(e.name === 'AbortError'
        ? (local ? 'Publishing took too long. Check that your site is still running (npm start), then click Publish again.'
                 : 'Publishing took too long. Check your internet connection, then click Publish again.')
        : (local ? 'Couldn\'t reach your site\'s server. Check that it\'s still running (npm start), then click Publish again.'
                 : 'Couldn\'t reach your site. Check your internet connection (or turn off a blocker extension for this site), then click Publish again.'));
    } finally { clearTimeout(timer); }
  }
  let j = null;
  try { j = await r.json(); } catch {}
  if (r.status === 401) { setToken(null); throw Object.assign(new Error(j?.error || 'Please sign in again'), { auth: true }); }
  if (!r.ok || !j?.ok) throw new Error(j?.error || `Server error (${r.status})`);
  return j;
}

export async function login(password) {
  const j = await api({ action: 'login', password });
  setToken(j.token);
  return true;
}

const toB64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const asBytes = c => (typeof c === 'string' ? new TextEncoder().encode(c) : c);

async function pool(items, n, fn) {
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.allSettled(Array.from({ length: Math.min(n, items.length) }, run));
}

// Server targets: stage each file (stays under request-size limits), then commit once.
// The first failure stops everything — no stray progress updates afterwards.
async function publishServer(target, changes, onProgress, message) {
  const entries = [...changes];
  const staged = [];
  let done = 0, failed = null;
  // Hosted functions (Vercel/Netlify) accept ~4.5 MB per request; base64 adds 33%.
  // Saving to this computer has no limit.
  const MAX = target === 'local' ? Infinity : 3.3 * 1024 * 1024;
  for (const [path, content] of entries) {
    if (content === null) continue;
    const size = asBytes(content).length;
    if (size > MAX) throw new Error(`"${path.split('/').pop()}" is ${(size / 1048576).toFixed(1)} MB. Your host accepts files up to 3 MB: replace it with a smaller image and publish again.`);
  }
  // Hosted functions are slow per request but scale out: send more at once
  await pool(entries, target === 'local' ? 3 : 6, async ([path, content]) => {
    if (failed) return;
    try {
      if (content === null) staged.push({ path, delete: true });
      else {
        const j = await api({ action: 'stage', target, path, content: toB64(asBytes(content)) });
        staged.push({ path, ref: j.ref });
      }
    } catch (e) { failed = failed || e; return; }
    if (!failed) onProgress?.(++done / (entries.length + 1), path);
  });
  if (failed) throw failed;
  const j = await api({ action: 'commit', target, entries: staged, message });
  onProgress?.(1);
  return j;
}

// ── This computer (File System Access API) ───────────────────────────────────
export const canUseFolder = () => 'showDirectoryPicker' in window;

// The site folder on this computer. Picked once per exported site (remembered),
// then every Publish saves straight into it. Accepts the site folder itself or
// a folder that contains it (e.g. Downloads), and checks it's THIS site.
async function siteIdOf(dir) {
  try {
    const f = await (await (await dir.getDirectoryHandle('cms')).getFileHandle('fx-site.json')).getFile();
    return JSON.parse(await f.text()).sourceUrl || 'site';
  } catch { return null; }
}
async function findSiteFolder(dir, siteId) {
  const id = await siteIdOf(dir);
  if (id) return id === siteId ? dir : null;
  // Picked the parent (e.g. Downloads)? Look one level down.
  for await (const [, entry] of dir.entries()) {
    if (entry.kind !== 'directory') continue;
    if ((await siteIdOf(entry)) === siteId) return entry;
  }
  return null;
}
async function getFolder(forcePick, siteId = 'site') {
  const key = 'folder-handle:' + siteId;
  let handle = forcePick ? null : await idbGet(key);
  if (handle && handle.queryPermission) {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') handle = null;
  }
  if (!handle) {
    const picked = await window.showDirectoryPicker({ id: 'fx-site', mode: 'readwrite', startIn: 'downloads' });
    handle = await findSiteFolder(picked, siteId);
    if (!handle) throw new Error('That isn\'t this site\'s folder. Pick the exported folder that contains index.html and the cms folder (or the folder it\'s in).');
    await idbSet(key, handle);
  }
  return handle;
}

async function dirFor(root, parts, create) {
  let d = root;
  for (const seg of parts) d = await d.getDirectoryHandle(seg, { create });
  return d;
}

async function publishFolder(changes, onProgress, forcePick, siteId) {
  const root = await getFolder(forcePick, siteId);
  let done = 0;
  for (const [path, content] of changes) {
    const parts = path.split('/');
    const name = parts.pop();
    if (content === null) {
      try {
        const d = await dirFor(root, parts, false);
        await d.removeEntry(name);
        // Remove the now-empty page folder (e.g. work/old-slug/)
        if (name === 'index.html' && parts.length) {
          const parent = await dirFor(root, parts.slice(0, -1), false);
          try { await parent.removeEntry(parts[parts.length - 1]); } catch {}
        }
      } catch {}
    } else {
      const d = await dirFor(root, parts, true);
      const fh = await d.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(content);
      await w.close();
    }
    onProgress?.(++done / changes.size, path);
  }
  return { folder: root.name };
}

// ── Download changed files (any browser) ─────────────────────────────────────
async function publishZip(changes) {
  const zip = new JSZip();
  const removed = [];
  for (const [p, c] of changes) { if (c === null) removed.push(p); else zip.file(p, c); }
  zip.file('HOW-TO-APPLY.txt',
    'These are only the files that changed.\n\n1. Copy everything in this ZIP into your site folder, replacing existing files.\n' +
    (removed.length ? `2. Delete these files from your site folder:\n${removed.map(r => '   - ' + r).join('\n')}\n` : '') +
    '\nThen redeploy (e.g. drag the folder onto app.netlify.com/drop again).\n');
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `site-changes-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return { removed };
}

// Pick the destination automatically — users never choose:
//   live site + Vercel Blob → blob · live site + GitHub → github
//   on this computer (Chrome/Edge) → site folder · otherwise → download
export function autoTarget(server) {
  // Our local preview server saves straight into the site folder — no picker
  if (server?.available && server.adapters?.local) return 'local';
  // Blob + GitHub both connected: live instantly AND every publish is a commit
  if (server?.available && server.configured && server.adapters?.blob && server.adapters?.github) return 'hybrid';
  if (server?.available && server.configured && server.adapters?.blob) return 'blob';
  if (server?.available && server.configured && server.adapters?.github) return 'github';
  if (canUseFolder() && server?.local) return 'folder';
  return 'zip';
}
// Must run first inside the click (browsers only show the folder picker
// during a user gesture). Returns quickly once the folder was chosen before.
export function prepareFolder(siteId) { return getFolder(false, siteId); }
export async function hasFolder(siteId) { try { return !!(await idbGet('folder-handle:' + siteId)); } catch { return false; } }

export async function publish(target, changes, { onProgress, message, forcePick, siteId } = {}) {
  if (!changes.size) return { nothing: true };
  if (target === 'folder') return publishFolder(changes, onProgress, forcePick, siteId);
  if (target === 'zip') return publishZip(changes);
  return publishServer(target, changes, onProgress, message);
}

// ── Live preview: hand draft files to the service worker ─────────────────────
let swReady = null;
export function initPreviewWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!swReady) {
    swReady = navigator.serviceWorker.register(ROOT + 'fx-admin-sw.js', { scope: new URL(ROOT).pathname })
      .then(() => navigator.serviceWorker.ready)
      .catch(e => { console.warn('[admin] preview worker unavailable', e); return null; });
  }
  return swReady;
}

export async function sendDrafts(changes) {
  const reg = await initPreviewWorker();
  const sw = reg?.active;
  if (!sw) return false;
  const files = [], deleted = [];
  for (const [p, c] of changes) {
    if (c === null) deleted.push(p);
    else files.push([p, { body: typeof c === 'string' ? c : c.slice().buffer, type: contentType(p) }]);
  }
  await new Promise(res => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => res();
    sw.postMessage({ type: 'fx-drafts', files, deleted }, [ch.port2]);
    setTimeout(res, 1500);
  });
  return true;
}

export function contentType(p) {
  const ext = p.split('.').pop().toLowerCase();
  return ({
    html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
    xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', csv: 'text/csv', txt: 'text/plain',
  })[ext] || 'application/octet-stream';
}

// Webflow Extractor admin — live preview worker.
// Serves unpublished CMS edits ("drafts") ONLY inside the admin's preview
// iframe. Visitors never install this worker (only /admin registers it), and
// even in the admin's browser normal tabs always get the real files.
const drafts = new Map();   // path relative to site root → { body, type }
const deleted = new Set();
const scopePath = new URL(self.registration.scope).pathname;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  const d = e.data;
  if (!d || d.type !== 'fx-drafts') return;
  drafts.clear(); deleted.clear();
  for (const [p, v] of d.files || []) drafts.set(p, v);
  for (const p of d.deleted || []) deleted.add(p);
  if (e.ports && e.ports[0]) e.ports[0].postMessage('ok');
});

function candidates(url) {
  const u = new URL(url);
  if (u.origin !== self.location.origin) return null;
  let p = decodeURIComponent(u.pathname);
  if (!p.startsWith(scopePath)) return null;
  p = p.slice(scopePath.length);
  if (p.startsWith('cms/') || p.startsWith('api/')) return null;
  if (p === '' || p.endsWith('/')) return [p + 'index.html'];
  // Page folders can look like files ("article/projectionmapp.ing"), so try both
  return [p + '/index.html', p];
}

async function isPreviewRequest(event) {
  const req = event.request;
  if (req.mode === 'navigate') return req.destination === 'iframe';
  if (!event.clientId) return false;
  const c = await self.clients.get(event.clientId);
  return !!c && c.frameType === 'nested';
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const cands = candidates(req.url);
  if (!cands) return;
  const previewNav = req.mode === 'navigate' && req.destination === 'iframe';
  const hasDraft = cands.some(p => drafts.has(p) || deleted.has(p));
  if (!hasDraft && !previewNav) return;
  event.respondWith((async () => {
    if (hasDraft && await isPreviewRequest(event)) {
      for (const p of cands) {
        if (drafts.has(p)) {
          const d = drafts.get(p);
          return new Response(d.body, { status: 200, headers: { 'content-type': d.type, 'cache-control': 'no-store', 'x-fx-draft': '1' } });
        }
        if (deleted.has(p)) {
          const nf = await fetch(new URL('404.html', self.registration.scope)).catch(() => null);
          return new Response(nf && nf.ok ? await nf.text() : 'Not found', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
      }
    }
    // Preview pages: ask for the page's index.html directly, so page folders
    // whose names contain a dot ("article/my.site") open on any local server
    // instead of showing a folder listing.
    if (previewNav) {
      for (const p of cands) {
        if (!p.endsWith('index.html')) continue;
        try {
          const r = await fetch(new URL(p, self.registration.scope), { cache: 'no-store' });
          if (r.ok) return new Response(r.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
        } catch {}
      }
    }
    // Everything else (the owner's normal tabs): always the real, current
    // file — never an old copy from the browser cache
    return fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-store' }));
  })());
});

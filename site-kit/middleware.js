// Vercel Routing Middleware — serves CMS edits published to Vercel Blob.
// Does nothing (and costs ~nothing) unless a Blob store is connected
// (BLOB_READ_WRITE_TOKEN) and something was published from /admin.
// Runs ONLY on what the CMS can change: pages, sitemap.xml, cms/fx-site.json,
// cms/data/* and images/uploads/* (uploaded images). Fonts, scripts, styles,
// the site's own images and videos never pass through here, so they load at
// full CDN speed (no flash of unstyled text).
export const config = { matcher: ['/((?!api/|_vercel/|cms/assets/|css/|js/|fonts/|videos/|documents/|data/|images/(?!uploads/)|styles\\.css|fx-admin-sw\\.js|robots\\.txt|favicon).*)'] };

// Freshness without per-request cost: at most one metadata lookup (Blob "head",
// always fresh) every 20s per instance, and only when someone opens a page.
// The pointer's content type names the newest manifest copy, whose own URL is
// brand new — so the CDN can never hand back a stale one.
let cached = { checked: 0, key: null, manifest: null };
let missBackoff = 30_000, nextTry = 0;

async function getManifest(token, isPage, fresh) {
  const age = Date.now() - cached.checked;
  // The CMS asks for fresh data (x-fx-fresh) so it never edits an old copy
  if (cached.checked && (fresh ? age < 2_000 : (age < 20_000 || (!isPage && age < 60_000)))) return cached.manifest;
  if (Date.now() < nextTry) return cached.manifest;
  try {
    const { head } = await import('@vercel/blob');
    const h = await head('fx/manifest.json', { token });
    const key = (/fxv=(\d+)/.exec(h.contentType || '') || [])[1] || h.uploadedAt;
    if (key !== cached.key) {
      const url = /^\d+$/.test(key) ? new URL(`/fx/m/${key}.json`, h.url) : h.url;
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) cached.manifest = await r.json();
      cached.key = r.ok ? key : null;
    }
    cached.checked = Date.now();
    missBackoff = 30_000;
  } catch {
    // Nothing published yet: look again later, backing off up to 30 min,
    // so a site that never publishes costs (almost) no Blob operations
    nextTry = Date.now() + missBackoff;
    missBackoff = Math.min(missBackoff * 2, 30 * 60_000);
  }
  return cached.manifest;
}

const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', csv: 'text/csv', txt: 'text/plain',
};

export default async function middleware(request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token || (request.method !== 'GET' && request.method !== 'HEAD')) return;
  const isPage = (request.headers.get('sec-fetch-dest') || 'document') === 'document' || /\.html?$|\/$/.test(new URL(request.url).pathname);
  const m = await getManifest(token, isPage, request.headers.get('x-fx-fresh') === '1');
  if (!m || (!Object.keys(m.overrides || {}).length && !(m.deleted || []).length)) return;
  // Instant + GitHub: Blob copies only bridge the rebuild. Work out which
  // publishes the running deployment does NOT contain yet; only their files
  // come from Blob. A deployment we don't know (e.g. after an edit pushed
  // straight to GitHub) is newer than every publish → serve it as is.
  let pending = null;
  if (m.hybrid) {
    const log = m.log || [], sha = process.env.VERCEL_GIT_COMMIT_SHA, dep = process.env.VERCEL_DEPLOYMENT_ID;
    let from = log.length;
    const i = sha ? log.findIndex(e => e.commit === sha) : -1;
    if (i >= 0) from = i + 1;
    else { const j = dep ? log.findIndex(e => e.dep === dep) : -1; if (j >= 0) from = j; }
    pending = new Set(log.slice(from).flatMap(e => e.paths));
    if (!pending.size) return;
  }
  const url = new URL(request.url);
  let p = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  // Page folders can look like files ("article/projectionmapp.ing"), so try both
  const cands = p === '' || p.endsWith('/') ? [p + 'index.html'] : [p + '/index.html', p];

  for (const c of cands) {
    if (pending && !pending.has(c)) continue;
    const blobUrl = m.overrides && m.overrides[c];
    if (blobUrl) {
      const r = await fetch(blobUrl);
      if (r.ok) {
        return new Response(request.method === 'HEAD' ? null : r.body, {
          status: 200,
          headers: { 'content-type': TYPES[c.split('.').pop().toLowerCase()] || 'application/octet-stream', 'cache-control': 'public, max-age=0, must-revalidate' },
        });
      }
    }
    if ((m.deleted || []).includes(c)) {
      const nf = await fetch(new URL('/404.html', url)).catch(() => null);
      return new Response(nf && nf.ok ? nf.body : 'Not found', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  }
}

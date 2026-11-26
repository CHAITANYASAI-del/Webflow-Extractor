// Webflow Extractor — CMS admin server (shared by Vercel and Netlify functions).
//
// Environment variables (set in your host's dashboard):
//   FX_ADMIN_PASSWORD   required — password for /admin
//   FX_ADMIN_SECRET     optional — extra secret for signing sessions
//   GitHub publishing (works with Vercel, Netlify, Cloudflare Pages):
//     GITHUB_TOKEN      fine-grained token with "Contents: Read and write" on the repo
//     GITHUB_REPO       owner/name
//     GITHUB_BRANCH     default: main
//     GITHUB_DIR        folder of the site inside the repo (default: repo root)
//   Vercel Blob publishing (instant, Vercel only):
//     BLOB_READ_WRITE_TOKEN  added automatically when you connect a Blob store

const enc = new TextEncoder();
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const SESSION_HOURS = 12;

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
async function sha(s) { return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const secretOf = env => (env.FX_ADMIN_SECRET || '') + '|fx|' + env.FX_ADMIN_PASSWORD;

async function makeToken(env) {
  const exp = Date.now() + SESSION_HOURS * 3600e3;
  return `${exp}.${await hmac(secretOf(env), String(exp))}`;
}
async function checkToken(req, env) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(secretOf(env), exp));
}

const cleanPath = p => {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.split('/').some(seg => seg === '..' || seg === '.')) throw new Error('Invalid path');
  if (/^(api|fx-server|netlify|node_modules)\//.test(s) || /^(middleware\.js|package\.json|netlify\.toml|vercel\.json)$/.test(s)) throw new Error('Protected path');
  return s;
};

// ── GitHub ───────────────────────────────────────────────────────────────────
async function gh(env, path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'user-agent': 'webflow-extractor-admin',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub: ${j.message || r.status}`);
  return j;
}
const ghDir = env => (env.GITHUB_DIR || '').replace(/^\/+|\/+$/g, '');
const ghPath = (env, p) => (ghDir(env) ? `${ghDir(env)}/${p}` : p);

async function githubStage(env, content) {
  const j = await gh(env, '/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
  return j.sha;
}
async function githubCommit(env, entries, message) {
  const branch = env.GITHUB_BRANCH || 'main';
  const ref = await gh(env, `/git/ref/heads/${encodeURIComponent(branch)}`);
  const parent = await gh(env, `/git/commits/${ref.object.sha}`);
  const tree = await gh(env, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: parent.tree.sha,
      tree: entries.map(e => ({ path: ghPath(env, cleanPath(e.path)), mode: '100644', type: 'blob', sha: e.delete ? null : e.ref })),
    }),
  });
  const commit = await gh(env, '/git/commits', {
    method: 'POST', body: JSON.stringify({ message: message || 'Update CMS content (Webflow Extractor admin)', tree: tree.sha, parents: [ref.object.sha] }),
  });
  await gh(env, `/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  return { commit: commit.sha, url: `https://github.com/${env.GITHUB_REPO}/commit/${commit.sha}` };
}

// ── Vercel Blob ──────────────────────────────────────────────────────────────
// fx/manifest.json is what the live site reads (CDN-cached, can lag a few
// minutes after an overwrite). Every publish ALSO writes a uniquely named copy
// (fx/m/<newest-first-key>.json) and builds on the newest one of those — so a
// publish never starts from a stale copy and never undoes an earlier one.
const MANIFEST = 'fx/manifest.json';
const HISTORY = 'fx/m/';
const KEEP_FOR = 60 * 60e3; // replaced files stay 1 hour (stale CDN copies may still point at them)
const newestFirst = () => String(9e15 - Date.now()).padStart(16, '0');
async function blobLib() {
  try { return await import('@vercel/blob'); }
  catch { throw new Error('Vercel Blob library missing — keep package.json in your site and redeploy.'); }
}
// The pointer's content can be stale on the CDN, but its metadata (head) is
// always fresh: its content type carries the key of the newest manifest copy.
// list() order isn't guaranteed: sort ourselves (smaller key = newer)
async function listHistory(lib, token) {
  const out = [];
  let cursor;
  do {
    const r = await lib.list({ prefix: HISTORY, limit: 1000, cursor, token });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => (a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0));
}
const keyOf = h => (/fxv=(\d+)/.exec(h?.contentType || '') || [])[1];
async function readBlobManifest(lib, token) {
  try {
    const h = await lib.head(MANIFEST, { token });
    const key = keyOf(h);
    if (key) {
      const r = await fetch(new URL(`/${HISTORY}${key}.json`, h.url), { cache: 'no-store' });
      if (r.ok) return { manifest: await r.json() };
    }
  } catch {}
  try {
    const newest = (await listHistory(lib, token))[0];
    if (newest) { const r = await fetch(newest.url, { cache: 'no-store' }); if (r.ok) return { manifest: await r.json() }; }
  } catch {}
  // Oldest format: only the shared copy exists
  try {
    const h = await lib.head(MANIFEST, { token });
    const r = await fetch(h.url, { cache: 'no-store' });
    if (r.ok) return { manifest: await r.json() };
  } catch {}
  return { manifest: { overrides: {}, deleted: [], garbage: [], updatedAt: null } };
}
async function blobStage(env, path, content, contentType) {
  const lib = await blobLib();
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const r = await lib.put(`fx/files/${stamp}/${path}`, fromB64(content), {
    access: 'public', token: env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: false, contentType,
  });
  return r.url;
}
async function blobCommit(env, entries, extra = {}) {
  const lib = await blobLib();
  const token = env.BLOB_READ_WRITE_TOKEN;
  const { manifest: m } = await readBlobManifest(lib, token);
  m.overrides = m.overrides || {};
  const now = Date.now();
  const garbage = (m.garbage || []);
  const deleted = new Set(m.deleted || []);
  for (const e of entries) {
    const p = cleanPath(e.path);
    if (m.overrides[p] && m.overrides[p] !== e.ref) garbage.push({ url: m.overrides[p], at: now });
    if (e.delete) { delete m.overrides[p]; deleted.add(p); }
    else { m.overrides[p] = e.ref; deleted.delete(p); }
  }
  // Delete files replaced more than an hour ago (nothing can still point at them)
  const expired = garbage.filter(g => now - g.at > KEEP_FOR).map(g => g.url);
  m.garbage = garbage.filter(g => now - g.at <= KEEP_FOR);
  m.deleted = [...deleted];
  m.updatedAt = new Date(now).toISOString();
  // Instant + GitHub: remember the commit, so the live site can stop using
  // these Blob copies once a deployment of that commit is running
  if (extra.commit) {
    // Which commit this publish made, and which deployment was live then —
    // lets the live site tell exactly which Blob copies a deploy already has
    m.hybrid = true;
    m.log = [...(m.log || []), { commit: extra.commit, dep: env.VERCEL_DEPLOYMENT_ID || '', at: now, paths: entries.map(e => cleanPath(e.path)) }].slice(-30);
  } else { delete m.hybrid; delete m.log; }
  const body = JSON.stringify(m);
  const key = newestFirst();
  await lib.put(`${HISTORY}${key}.json`, body, { access: 'public', token, addRandomSuffix: false, contentType: 'application/json' });
  await lib.put(MANIFEST, body, { access: 'public', token, addRandomSuffix: false, allowOverwrite: true, contentType: `application/json; fxv=${key}`, cacheControlMaxAge: 60 });
  if (expired.length) { try { await lib.del(expired, { token }); } catch {} }
  // Keep the 5 newest history copies (never the one just written)
  try {
    const all = await listHistory(lib, token);
    const old = all.slice(5).filter(b => !b.pathname.endsWith(`${key}.json`));
    if (old.length) await lib.del(old.map(b => b.url), { token });
  } catch {}
  return { files: Object.keys(m.overrides).length, updatedAt: m.updatedAt };
}

const CT = p => ({
  html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', csv: 'text/csv', txt: 'text/plain',
})[p.split('.').pop().toLowerCase()] || 'application/octet-stream';

// ── Entry ────────────────────────────────────────────────────────────────────
export async function handle(req, env = {}) {
  const adapters = {
    github: !!(env.GITHUB_TOKEN && env.GITHUB_REPO),
    blob: !!env.BLOB_READ_WRITE_TOKEN,
  };
  if (req.method === 'GET') {
    return json({
      service: 'fx-cms', version: 1, configured: !!env.FX_ADMIN_PASSWORD, adapters,
      host: env.VERCEL ? 'vercel' : env.NETLIFY ? 'netlify' : 'other',
      github: adapters.github ? { repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || 'main' } : null,
    });
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!env.FX_ADMIN_PASSWORD) return json({ ok: false, error: 'Admin is not set up yet: add an FX_ADMIN_PASSWORD environment variable and redeploy.' }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad request' }, 400); }

  try {
    if (body.action === 'login') {
      const ok = safeEqual(await sha(String(body.password || '')), await sha(env.FX_ADMIN_PASSWORD));
      if (!ok) { await new Promise(r => setTimeout(r, 600)); return json({ ok: false, error: 'Wrong password' }, 401); }
      return json({ ok: true, token: await makeToken(env) });
    }
    if (!(await checkToken(req, env))) return json({ ok: false, error: 'Please sign in again' }, 401);

    const target = body.target;
    if (target === 'github' && !adapters.github) throw new Error('GitHub publishing isn\'t set up: add GITHUB_TOKEN and GITHUB_REPO.');
    if (target === 'blob' && !adapters.blob) throw new Error('Vercel Blob isn\'t connected to this project.');
    if (target === 'hybrid' && !(adapters.blob && adapters.github)) throw new Error('Instant publishing needs both Vercel Blob and GitHub connected.');

    if (body.action === 'stage') {
      const path = cleanPath(body.path);
      if (typeof body.content !== 'string') throw new Error('Missing content');
      let ref;
      if (target === 'hybrid') {
        // Instant + GitHub: same file to both, in parallel
        const [g, b] = await Promise.all([githubStage(env, body.content), blobStage(env, path, body.content, CT(path))]);
        ref = JSON.stringify({ g, b });
      } else ref = target === 'github' ? await githubStage(env, body.content) : await blobStage(env, path, body.content, CT(path));
      return json({ ok: true, ref });
    }
    // Back to the deployed site: forget every edit published to Vercel Blob
    // (files are cleaned up an hour later, like replaced files)
    if (body.action === 'reset') {
      if (target !== 'blob') throw new Error('Reset only applies to Vercel Blob publishing.');
      const lib = await blobLib();
      const { manifest: m } = await readBlobManifest(lib, env.BLOB_READ_WRITE_TOKEN);
      const now = Date.now();
      const garbage = [...(m.garbage || []), ...Object.values(m.overrides || {}).map(url => ({ url, at: now }))];
      const fresh = { overrides: {}, deleted: [], garbage, updatedAt: new Date(now).toISOString() };
      const key = newestFirst(), bodyJson = JSON.stringify(fresh), token = env.BLOB_READ_WRITE_TOKEN;
      await lib.put(`${HISTORY}${key}.json`, bodyJson, { access: 'public', token, addRandomSuffix: false, contentType: 'application/json' });
      await lib.put(MANIFEST, bodyJson, { access: 'public', token, addRandomSuffix: false, allowOverwrite: true, contentType: `application/json; fxv=${key}`, cacheControlMaxAge: 60 });
      return json({ ok: true, reset: true, updatedAt: fresh.updatedAt });
    }
    if (body.action === 'commit') {
      if (!Array.isArray(body.entries) || !body.entries.length) throw new Error('Nothing to publish');
      let result;
      if (target === 'hybrid') {
        const pick = k => body.entries.map(e => (e.delete ? e : { path: e.path, ref: JSON.parse(e.ref)[k] }));
        const gh = await githubCommit(env, pick('g'), body.message);
        const bl = await blobCommit(env, pick('b'), { commit: gh.commit });
        result = { ...gh, ...bl, hybrid: true };
      } else result = target === 'github' ? await githubCommit(env, body.entries, body.message) : await blobCommit(env, body.entries);
      return json({ ok: true, ...result });
    }
    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
}

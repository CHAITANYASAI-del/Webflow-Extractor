import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DOMParser } = require('linkedom');
const DIR = path.resolve(process.argv[2]);
globalThis.location = { href: 'http://site.test/cms/' };
globalThis.DOMParser = DOMParser;
globalThis.CSS = { escape: s => String(s).replace(/["\\]/g, '\\$&') };
globalThis.fetch = async (u) => { const p = decodeURIComponent(new URL(u).pathname).replace(/^\//, ''); const f = path.join(DIR, p);
  if (!fs.existsSync(f)) return { ok: false, status: 404 }; const b = fs.readFileSync(f); return { ok: true, status: 200, text: async () => b.toString('utf8'), arrayBuffer: async () => b }; };
const S = await import(new URL('../admin-src/src/core/site.js', import.meta.url).href);
const apply = ch => { for (const [p, v] of ch) { const f = path.join(DIR, p); if (v === null) { fs.rmSync(f, { force: true }); try { fs.rmdirSync(path.dirname(f)); } catch {} } else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v); } } };
let st = await S.loadSite();
const post = st.collections.find(c => c.name === 'Post'), cat = st.collections.find(c => c.name === 'Category');
const travel = cat.items.find(i => i.data.f1.v === 'Travel').data.id.v;
// 1 new post in Travel, at the top
const n = S.createItem(post, 'Brand New Travel Story'); n.data.f3 = { t: 'string', v: 'New summary' }; n.data.f1 = { t: 'string', v: travel };
post.items.unshift(n);
// 2 delete one
const del = post.items.find(i => i.key === 'understanding-cms'); del.status = 'deleted';
// 3 slug change
const mv = post.items.find(i => i.key === 'seo-strategies-for-2024'); mv.data.slug = { t: 'string', v: 'seo-in-2026' }; mv.status = 'edited';
// 4 rename a category
const life = cat.items.find(i => i.data.f1.v === 'Lifestyle'); life.data.f1 = { t: 'string', v: 'Life & Style' }; life.status = 'edited';
const t0 = Date.now();
const ch = await S.buildChanges(st, new Map(), {});
console.log('changes', ch.size, 'in', Date.now() - t0, 'ms; deleted:', [...ch].filter(([, v]) => v === null).map(([p]) => p).join(', '));
apply(ch);

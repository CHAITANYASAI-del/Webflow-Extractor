// End-to-end CMS QA on an extracted export folder: edits through the editor's
// real data layer (admin-src/src/core/site.js), written to disk, then checked.
import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { DOMParser } = require('linkedom');
const DIR = path.resolve(process.argv[2]);
globalThis.location = { href: 'http://site.test/cms/' };
globalThis.DOMParser = DOMParser;
globalThis.CSS = { escape: s => String(s).replace(/["\\]/g, '\\$&') };
globalThis.fetch = async u => {
  const p = decodeURIComponent(new URL(u).pathname).replace(/^\//, ''); const f = path.join(DIR, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return { ok: false, status: 404 };
  const b = fs.readFileSync(f); return { ok: true, status: 200, text: async () => b.toString('utf8'), arrayBuffer: async () => b };
};
const S = await import(new URL('../admin-src/src/core/site.js', import.meta.url).href);
const fails = []; const ok = []; const check = (cond, msg) => (cond ? ok : fails).push(msg);
const apply = ch => { for (const [p, v] of ch) { const f = path.join(DIR, p); if (v === null) { fs.rmSync(f, { force: true }); try { fs.rmdirSync(path.dirname(f)); } catch {} } else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v); } } };
const doc = p => new DOMParser().parseFromString(fs.readFileSync(path.join(DIR, S.pageFile(p)), 'utf8'), 'text/html');
const allPages = () => { const out = []; (function w(d, rel) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!rel && /^(css|js|images|fonts|videos|data|documents|cms|api|fx-server|netlify|media|other)$/.test(f)) continue; w(p, rel ? rel + '/' + f : f); } else if (f === 'index.html') out.push(rel); } })(DIR, ''); return out; };

const st = await S.loadSite();
const title = (c, it) => S.itemTitle(c, it);
const pageCols = st.collections.filter(c => c.pagePrefix && c.items.length >= 3 && c.titleFieldId);
// the main collection: prefer one with tags (multi-reference), then the biggest
const C = process.env.QA_COL ? pageCols.find(c => c.name === process.env.QA_COL)
  : pageCols.sort((a, b) => (b.fields.some(f => f.kind === 'multiref') - a.fields.some(f => f.kind === 'multiref')) || (b.items.length - a.items.length))[0];
const log = [];
const expect = {};
if (C) {
  const live = () => C.items.filter(i => i.status !== 'deleted');
  // 1. rename + slug change on item 0
  const a = C.items[0];
  expect.renamed = { old: title(C, a), neu: ('QA Renamed ' + title(C, a).slice(0, 20)).trim(), oldPage: a.page };
  expect.renamed.titleHad = doc(a.page).querySelector('title').textContent.includes(expect.renamed.old);
  expect.createdTitle = doc(a.page).querySelector('title').textContent.includes(expect.renamed.old);
  a.data[C.titleFieldId] = { t: 'string', v: expect.renamed.neu };
  a.data.slug = { t: 'string', v: S.slugify(expect.renamed.neu) };
  expect.renamed.newPage = `${C.pagePrefix}/${a.data.slug.v}`;
  // tags changed (multi-reference): keep only the first referenced item
  const mf = C.fields.find(f => f.kind === 'multiref');
  if (mf) {
    const R = st.collections.find(c => c.id === mf.ref);
    const pick = R.items.slice(0, 2).map(i => ({ t: 'string', v: i.data.id.v }));
    a.data[mf.id] = { t: 'array', v: pick };
    expect.tags = { names: R.items.slice(0, 2).map(i => title(R, i)), page: expect.renamed.newPage, field: mf.id };
  }
  a.status = 'edited';
  // 2. new item, copying references from item 1
  const n = S.createItem(C, 'QA Brand New Item');
  for (const f of C.fields) if ((f.kind === 'ref' || f.kind === 'multiref') && C.items[1].data[f.id]) n.data[f.id] = structuredClone(C.items[1].data[f.id]);
  C.items.unshift(n);
  expect.created = { page: `${C.pagePrefix}/${n.data.slug.v}`, name: 'QA Brand New Item', id: n.data.id.v };
  // 3. delete the last item
  const del = C.items[C.items.length - 1];
  del.status = 'deleted';
  expect.deleted = { id: del.data.id.v, page: del.page, name: title(C, del) };
  log.push(`${C.name}: rename "${expect.renamed.old}" + slug, ${mf ? 'tags, ' : ''}new item, delete "${expect.deleted.name}"`);
  // 4. rename an item that C references (a category / tag / author)
  const rf = C.fields.find(f => f.kind === 'ref');
  if (rf) {
    const R = st.collections.find(c => c.id === rf.ref);
    const used = R.items.find(r => C.items.some(i => i !== a && i.status !== 'deleted' && i.data[rf.id]?.v === r.data.id.v));
    if (used && R.titleFieldId) {
      expect.refRename = { col: R.name, old: title(R, used), neu: 'QA ' + title(R, used), refField: rf.id, id: used.data.id.v };
      used.data[R.titleFieldId] = { t: 'string', v: expect.refRename.neu };
      used.status = 'edited';
      log.push(`${R.name}: rename "${expect.refRename.old}"`);
    }
  }
}
// 5. list-only collection (testimonials, FAQ, team cards)
const L = st.collections.find(c => c.listOnly && c.items.length >= 2 && c.titleFieldId);
if (L) {
  const e = L.items[0];
  expect.listEdit = { old: title(L, e), neu: 'QA List ' + title(L, e).slice(0, 15), id: e.data.id.v };
  e.data[L.titleFieldId] = { t: 'string', v: expect.listEdit.neu }; e.status = 'edited';
  const ln = S.createItem(L, 'QA New Card');
  L.items.unshift(ln);
  expect.listNew = { id: ln.data.id.v };
  const ld = L.items[L.items.length - 1]; ld.status = 'deleted';
  expect.listDel = { id: ld.data.id.v };
  log.push(`${L.name}: edit "${expect.listEdit.old}", add card, delete card`);
}

const t0 = Date.now();
const ch = await S.buildChanges(st, new Map(), {});
const ms = Date.now() - t0;
apply(ch);
console.log(`  edits: ${log.join(' · ')}\n  build: ${ch.size} files in ${ms} ms`);

// ── Checks ───────────────────────────────────────────────────────────────
const pages = allPages();
const docs = new Map(pages.map(p => [p, doc(p)]));
const m2 = JSON.parse(fs.readFileSync(path.join(DIR, 'cms/fx-site.json'), 'utf8'));
check(m2.pages.every(p => p === '404' || pages.includes(p)), 'manifest pages all exist');
check(pages.every(p => m2.pages.includes(p)), 'every page is in the manifest');
if (C) {
  const R = expect.renamed;
  check(pages.includes(R.newPage) && !pages.includes(R.oldPage), 'renamed item moved to its new address');
  const nd = docs.get(R.newPage);
  if (R.titleHad) check(nd && nd.querySelector('title').textContent.includes(R.neu), 'renamed item: <title> updated');
  const own = nd && [...nd.querySelectorAll(`[data-wfx-f="${C.titleFieldId}"]`)].filter(el => !el.closest('[data-wfx-i]'));
  check(own && own.length && own.every(el => el.textContent.trim() === R.neu), 'renamed item: heading updated');
  const oldLinks = pages.filter(p => [...docs.get(p).querySelectorAll('a[href]')].some(a => { try { return new URL(a.getAttribute('href'), 'http://x/' + (p ? p + '/' : '')).pathname.replace(/^\/|\/$/g, '') === R.oldPage; } catch { return false; } }));
  check(!oldLinks.length, `no links to the old address (${oldLinks.slice(0, 2).join(', ')})`);
  const cardsA = pages.flatMap(p => [...docs.get(p).querySelectorAll(`[data-wfx-i="${C.id}/${C.items[1].data.id.v}"], [data-wfx-i="${C.id}/${st.collections.find(c => c.id === C.id).items.find(i => i.data.slug?.v === S.slugify(R.neu))?.data.id.v}"]`)]);
  const stale = pages.filter(p => [...docs.get(p).querySelectorAll(`[data-wfx-f="${C.titleFieldId}"]`)].some(el => el.textContent.trim() === R.old));
  check(!stale.length, `old name shown nowhere (${stale.slice(0, 3).join(', ')})`);
  check(pages.includes(expect.created.page), 'new item has a page');
  const cd = docs.get(expect.created.page);
  if (expect.createdTitle) check(cd && cd.querySelector('title').textContent.includes(expect.created.name), 'new item: <title>');
  check(cd && cd.documentElement.getAttribute('data-wf-item-slug') === S.slugify(expect.created.name), 'new item: data-wf-item-slug');
  const inLists = pages.filter(p => docs.get(p).querySelector(`[data-wfx-i="${C.id}/${expect.created.id}"]`));
  check(inLists.length > 0, `new item appears in lists (${inLists.length} pages)`);
  check(!pages.includes(expect.deleted.page), 'deleted item page removed');
  const ghost = pages.filter(p => docs.get(p).querySelector(`[data-wfx-i="${C.id}/${expect.deleted.id}"]`));
  check(!ghost.length, `deleted item gone from every list (${ghost.slice(0, 3).join(', ')})`);
  if (expect.tags) {
    const el = nd && nd.querySelector(`[data-wfx-f="${expect.tags.field}"]`);
    const shown = el ? [...el.querySelectorAll('.w-dyn-item')].map(x => x.textContent.trim()) : null;
    check(shown && shown.length === expect.tags.names.length && expect.tags.names.every(nm => shown.some(s => s.includes(nm))), `tags on the page = chosen tags (${shown && shown.join(' / ')})`);
  }
  if (expect.refRename) {
    const E = expect.refRename;
    const staleRef = pages.filter(p => [...docs.get(p).querySelectorAll(`[data-wfx-f="${E.refField}"]`)].some(el => el.textContent.trim() === E.old));
    check(!staleRef.length, `renamed ${E.col} shown nowhere with its old name (${staleRef.slice(0, 3).join(', ')})`);
  }
  // pagination: every page but the last is full
  for (const g of m2.collections.find(c => c.id === C.id).paginated || []) {
    const counts = g.pages.filter(p => pages.includes(p)).map(p => {
      const cs = [...docs.get(p).querySelectorAll(`[data-wfx-i^="${C.id}/"]`)];
      const by = new Map(); cs.forEach(c => by.set(c.parentElement, (by.get(c.parentElement) || 0) + 1));
      return Math.max(0, ...by.values());
    });
    check(counts.slice(0, -1).every(x => x === g.size), `pagination ${g.pages[0] || '/'}: ${counts.join('+')} (page size ${g.size})`);
  }
}
if (L) {
  const staleL = pages.filter(p => [...docs.get(p).querySelectorAll(`[data-wfx-i="${L.id}/${expect.listEdit.id}"] [data-wfx-f="${L.titleFieldId}"]`)].some(el => el.textContent.trim() !== expect.listEdit.neu));
  check(!staleL.length && pages.some(p => docs.get(p).querySelector(`[data-wfx-i="${L.id}/${expect.listEdit.id}"]`)), `${L.name}: edited card shows the new text`);
  check(pages.some(p => docs.get(p).querySelector(`[data-wfx-i="${L.id}/${expect.listNew.id}"]`)), `${L.name}: new card added`);
  check(!pages.some(p => docs.get(p).querySelector(`[data-wfx-i="${L.id}/${expect.listDel.id}"]`)), `${L.name}: deleted card removed`);
}
// all references still resolve
let lc = ''; try { lc = execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "linkcheck.cjs"), DIR]).toString(); } catch (e) { lc = e.stdout.toString(); }
check(/broken 0\b/.test(lc) || !/✗/.test(lc.replace(/✗ href \/sample-result.*\n?/g, '')), 'link check after edits: ' + lc.split('\n')[0] + (/✗/.test(lc) ? ' → ' + lc.split('\n').slice(1, 4).join(' | ') : ''));
// reload what was published: the editor must read it back
const st2 = await S.loadSite();
check(st2.collections.every(c => c.items.every(i => i.data.id?.v)), 'published CMS loads again');
for (const m of ok) console.log('  ✓', m);
for (const m of fails) console.log('  ✗', m);
console.log(`  ${ok.length} passed, ${fails.length} failed`);
process.exitCode = fails.length ? 1 : 0;

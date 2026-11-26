// Site model for a Webflow export: loads the CMS (cms/fx-site.json), applies
// edits, and builds the exact set of file changes so the static site shows them.
//
// Webflow publishes CMS content as finished HTML. At export, Webflow Extractor
// marked every element that shows a CMS field:
//   data-wfx-f="<field>"            the element showing that field
//   data-wfx-i="<collection>/<id>"  a collection-list item (.w-dyn-item)
// Publishing rewrites exactly those elements:
//   • edited item  → its page (+ its paginated pages) and every list card of it
//   • new item     → a copy of a sibling's page, filled in; added to the lists
//   • deleted item → its page removed, its list cards removed
//   • slug change  → page moved, links to it updated
//   • reordered    → list cards follow the new order

import { richTextToHtml, richTextToPlain } from './richtext.js';

export const ROOT = new URL('../', location.href).href;           // site root (the CMS lives in /cms/)
export const pageFile = p => (p === '' ? 'index.html' : p === '404' ? '404.html' : `${p}/index.html`);

const SYSTEM_KEYS = new Set(['id']);

const textCache = new Map();
export function clearCache() { textCache.clear(); }

// Files just published to GitHub/Vercel that the live site may not serve yet.
// Reads prefer them, so the preview and the next publish build on what was
// published — never on the older live copy.
let published = new Map();
export function setPublishedOverlay(files) { published = new Map(files || []); textCache.clear(); }
export const publishedOverlay = () => published;
const fromOverlay = path => {
  if (!published.has(path)) return undefined;
  const v = published.get(path);
  if (v === null) throw new Error(`${path}: HTTP 404`);
  return v;
};

export async function readText(path, { cache = false } = {}) {
  const o = fromOverlay(path);
  if (o !== undefined) return typeof o === 'string' ? o : new TextDecoder().decode(o);
  if (cache && textCache.has(path)) return textCache.get(path);
  const r = await fetch(ROOT + path, { cache: 'no-store', headers: { 'x-fx-fresh': '1' } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  const t = await r.text();
  if (cache) textCache.set(path, t);
  return t;
}
export async function readBytes(path) {
  const o = fromOverlay(path);
  if (o !== undefined) return typeof o === 'string' ? new TextEncoder().encode(o) : o;
  const r = await fetch(ROOT + path, { cache: 'no-store', headers: { 'x-fx-fresh': '1' } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ── Loading ──────────────────────────────────────────────────────────────────
export async function loadSite() {
  const manifest = JSON.parse(await readText('cms/fx-site.json'));
  const collections = manifest.collections.map(c => ({
    ...c,
    items: (c.items || []).map(({ data }) => ({
      key: data.id?.v || Math.random().toString(36).slice(2),
      data,
      orig: structuredClone(data),
      status: 'clean',
      page: c.itemPages?.[data.id?.v] || null,
    })),
  }));
  // Main content first: collections with their own pages and the most fields
  // (Blog, Works), then smaller ones (Tags, Categories), lists without pages last
  const weight = c => (c.pagePrefix ? 1000 : 0) + c.fields.filter(f => f.kind).length * 50 + Math.min(c.items.length, 49);
  collections.sort((a, b) => weight(b) - weight(a));
  return { manifest, collections };
}

// ── Field helpers ────────────────────────────────────────────────────────────
export function fieldsOf(col) {
  return col.fields.filter(f => !SYSTEM_KEYS.has(f.id));
}
export function itemTitle(col, item) {
  const d = item.data;
  const tf = col.titleFieldId && d[col.titleFieldId];
  if (tf && tf.v) return String(tf.v);
  const sf = col.slugFieldId && d[col.slugFieldId];
  if (sf && sf.v) return String(sf.v);
  for (const f of col.fields) { const v = d[f.id]; if (v && v.t === 'string' && v.v && f.kind === 'text') return v.v; }
  return 'Untitled';
}
export function itemSlug(col, item) {
  const v = col.slugFieldId && item.data[col.slugFieldId];
  return v && v.v ? String(v.v) : '';
}
const imgSrcOf = v => (v && v.t === 'image' && v.v ? (typeof v.v === 'string' ? v.v : v.v.src) : null);
export function itemImageSrc(col, item) {
  for (const f of col.fields) { const s = imgSrcOf(item.data[f.id]); if (s) return s; }
  return null;
}
export function itemImage(col, item, imageMap) {
  const s = itemImageSrc(col, item);
  return s ? resolveImage(s, imageMap) : null;
}
export function resolveImage(src, imageMap) {
  if (!src) return null;
  const base = String(src).split('?')[0];
  if (imageMap && imageMap[base]) return ROOT + imageMap[base];
  if (/^(?:https?:|data:|blob:)/.test(src)) return src;
  return ROOT + String(src).replace(/^\.?\//, '');
}

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}
export function uniqueSlug(col, base, exceptKey) {
  const taken = new Set(col.items.filter(i => i.key !== exceptKey && i.status !== 'deleted').map(i => itemSlug(col, i)));
  let s = base || 'item', n = 2;
  while (taken.has(s)) s = `${base}-${n++}`;
  return s;
}
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function newId() {
  let s = 'new-';
  const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += ID_CHARS[b % ID_CHARS.length];
  return s;
}

export function defaultValue(field) {
  switch (field.type) {
    case 'String': return { t: 'string', v: '' };
    case 'RichText': return { t: 'richtext', v: '' };
    default: return { t: 'null', v: null };
  }
}

// ── Item operations (pure: return new item objects) ──────────────────────────
export function createItem(col, title) {
  const data = { id: { t: 'string', v: newId() } };
  for (const f of col.fields) if (f.id !== 'id') data[f.id] = defaultValue(f);
  if (col.titleFieldId) data[col.titleFieldId] = { t: 'string', v: title || `New ${col.singular || 'item'}` };
  if (col.slugFieldId) data[col.slugFieldId] = { t: 'string', v: uniqueSlug(col, slugify(title || `new-${col.singular || 'item'}`)) };
  // Start from a sibling's picture and links so the new page isn't half empty
  const sib = col.items.find(i => i.status !== 'deleted');
  if (sib) for (const f of col.fields) if ((f.type === 'Image') && !data[f.id]?.v && sib.data[f.id]?.v) data[f.id] = structuredClone(sib.data[f.id]);
  return { key: data.id.v, data, orig: null, status: 'new', page: null };
}

export function duplicateItem(col, item) {
  const data = structuredClone(item.data);
  data.id = { t: 'string', v: newId() };
  if (col.titleFieldId && data[col.titleFieldId]) data[col.titleFieldId] = { t: 'string', v: `${data[col.titleFieldId].v} (copy)` };
  if (col.slugFieldId) data[col.slugFieldId] = { t: 'string', v: uniqueSlug(col, `${itemSlug(col, item)}-copy`) };
  return { key: data.id.v, data, orig: null, status: 'new', page: null };
}

export function isDirty(col) { return col.items.some(i => i.status !== 'clean'); }

// ── Page helpers ─────────────────────────────────────────────────────────────
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
// Path from a page folder to a site file: ("post/x", "images/a.jpg") → "../../images/a.jpg"
function rel(pageDir, target) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(target)) return target;
  const depth = pageDir ? pageDir.split('/').length : 0;
  return '../'.repeat(depth) + String(target).replace(/^\/+/, '');
}
const relPage = (pageDir, key) => rel(pageDir, key ? key + '/' : '') || './';
function resolveIn(pageDir, ref) {
  if (!ref || /^(?:[a-z]+:|\/\/|#|data:)/i.test(ref)) return null;
  try {
    const u = new URL(ref, 'http://x/' + (pageDir ? pageDir + '/' : ''));
    return decodeURIComponent(u.pathname).replace(/^\/+/, '').replace(/(?:^|\/)index\.html$/i, '').replace(/\/+$/, '');
  } catch { return null; }
}
const hasCls = (el, c) => el.classList && el.classList.contains(c);
const setEmpty = (el, empty) => { if (el.classList) el.classList.toggle('w-dyn-bind-empty', !!empty); };

function serialize(doc) { return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML; }
const stemOf = p => String(p || '').split(/[?#]/)[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/-p-\d+(?:x\d+)?(?:q\d+)?$/i, '').toLowerCase();

// Relative paths inside an element copied from a page at another depth
// ("../../images/a.jpg" on post/x → "../images/a.jpg" on blog)
function rebaseUrl(ref, fromDir, toDir) {
  const r = String(ref || '').trim();
  if (!r || /^(?:[a-z]+:|\/\/|#|data:)/i.test(r)) return ref;
  try {
    const u = new URL(r, 'http://x/' + (fromDir ? fromDir + '/' : ''));
    return ('../'.repeat(toDir ? toDir.split('/').length : 0) + u.pathname.replace(/^\/+/, '') + u.search + u.hash) || './';
  } catch { return ref; }
}
function rebase(el, fromDir, toDir) {
  if (fromDir === toDir) return el;
  for (const n of [el, ...el.querySelectorAll('*')]) {
    for (const a of ['href', 'src', 'poster', 'data-src']) { const v = n.getAttribute(a); if (v) n.setAttribute(a, rebaseUrl(v, fromDir, toDir)); }
    const ss = n.getAttribute('srcset');
    if (ss) n.setAttribute('srcset', ss.split(',').map(x => { const [u, ...r] = x.trim().split(/\s+/); return [rebaseUrl(u, fromDir, toDir), ...r].join(' '); }).join(', '));
    const st = n.getAttribute('style');
    if (st && /url\(/i.test(st)) n.setAttribute('style', st.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url(${q}${rebaseUrl(u, fromDir, toDir)}${q})`));
  }
  return el;
}
// A list card for `it`, copied from an existing card (tpl, on page tplDir)
function makeCard(doc, tpl, tplDir, tplPage, col, it, pageDir, state) {
  const li = doc.importNode(tpl, true);
  rebase(li, tplDir, pageDir);
  li.setAttribute('data-wfx-i', `${col.id}/${it.data.id.v}`);
  for (const f of col.fields) {
    if (!f.kind) continue;
    for (const el of marks(li, f.id, true)) applyField(el, f, it.data[f.id], { pageDir, state });
  }
  // links to the copied card's page → this item's page
  if (col.pagePrefix && tplPage) {
    const want = relPage(pageDir, `${col.pagePrefix}/${itemSlug(col, it)}`);
    for (const a of [li, ...li.querySelectorAll('a[href]')]) {
      if (a.tagName !== 'A' || a.closest('[data-wfx-i]') !== li) continue;
      if (resolveIn(pageDir, a.getAttribute('href')) === tplPage) a.setAttribute('href', want);
    }
  }
  return li;
}
const pageOfCardItem = (col, item, id) => item?.page || (col.pagePrefix ? `${col.pagePrefix}/${id}` : null);

// Write one field value into one marked element
function applyField(el, field, value, ctx) {
  const v = value && value.v != null ? value : null;
  const { pageDir, state } = ctx;
  switch (field.kind) {
    case 'richtext':
      el.innerHTML = v ? richTextToHtml(v.v) : '';
      setEmpty(el, !v || !v.v);
      break;
    case 'image': {
      if (el.tagName === 'IMG') {
        const src = imgSrcOf(v);
        if (src) {
          el.setAttribute('src', rel(pageDir, src));
          el.removeAttribute('srcset'); el.removeAttribute('sizes');
          if (typeof v.v === 'object' && v.v.alt != null) el.setAttribute('alt', v.v.alt);
          setEmpty(el, false);
        } else { el.setAttribute('src', ''); el.removeAttribute('srcset'); setEmpty(el, true); }
      } else {
        const src = imgSrcOf(v);
        const style = el.getAttribute('style') || '';
        if (src) el.setAttribute('style', style.replace(/background-image\s*:\s*url\([^)]*\)/i, `background-image:url("${rel(pageDir, src)}")`));
      }
      break;
    }
    case 'bg': {
      const src = imgSrcOf(v);
      const style = el.getAttribute('style') || '';
      if (src) el.setAttribute('style', style.replace(/background-image\s*:\s*url\([^)]*\)/i, `background-image:url("${rel(pageDir, src)}")`));
      break;
    }
    case 'link':
      if (v) el.setAttribute('href', String(v.v)); else el.setAttribute('href', '#');
      break;
    case 'ref': {
      const rc = state.collections.find(c => c.id === field.ref);
      const ri = v && rc && rc.items.find(i => i.data.id?.v === v.v && i.status !== 'deleted');
      el.textContent = ri ? itemTitle(rc, ri) : '';
      setEmpty(el, !ri);
      // The name usually sits inside a link to that item's page
      const a = el.closest && el.closest('a[href]');
      if (a && rc && rc.pagePrefix) {
        const linked = pageDir === '404' ? String(a.getAttribute('href') || '').replace(/^\/+|\/+$/g, '') : resolveIn(pageDir, a.getAttribute('href'));
        if (linked && linked.startsWith(rc.pagePrefix + '/')) a.setAttribute('href', ri ? relPage(pageDir, `${rc.pagePrefix}/${itemSlug(rc, ri)}`) : '#');
      }
      break;
    }
    case 'multiref': {
      // A post's Tags: rebuild the nested list from one of its cards
      const rc = state.collections.find(c => c.id === field.ref);
      if (!rc) break;
      const doc = el.ownerDocument;
      const ids = v && v.t === 'array' ? v.v.map(x => x.v) : [];
      let box = el.querySelector('.w-dyn-items');
      const old = box ? [...box.children].filter(c => c.classList.contains('w-dyn-item')) : [];
      // copy a card that knows its fields (marked), else the one saved at export
      let tpl = old.find(c => c.getAttribute('data-wfx-i') && c.querySelector('[data-wfx-f]')), tplDir = pageDir;
      if (!tpl && field.cardHtml) {
        const t = doc.createElement('div');
        t.innerHTML = field.cardHtml;
        tpl = t.firstElementChild; tplDir = field.cardDir || pageDir;
      }
      if (!tpl) break;
      const tplId = (tpl.getAttribute('data-wfx-i') || '').split('/').slice(1).join('/');
      const tplPage = pageOfCardItem(rc, rc.items.find(i => i.data.id?.v === tplId), tplId);
      if (!box) {
        box = doc.createElement('div');
        box.setAttribute('role', 'list');
        box.setAttribute('class', field.boxClass || 'w-dyn-items');
        el.insertBefore(box, el.querySelector('.w-dyn-empty'));
      }
      old.forEach(c => c.remove());
      for (const id of ids) {
        const ri = rc.items.find(i => i.data.id?.v === id && i.status !== 'deleted');
        if (ri) box.appendChild(makeCard(doc, tpl, tplDir, tplPage, rc, ri, pageDir, state));
      }
      const empty = el.querySelector('.w-dyn-empty');
      if (empty) empty.style.display = box.children.length ? 'none' : '';
      break;
    }
    default: {
      const s = v ? String(v.v) : '';
      el.textContent = s;
      setEmpty(el, !s);
    }
  }
}
// Marked elements that belong to this scope (not to a nested list item)
function marks(scope, fieldId, inList) {
  const all = [...scope.querySelectorAll(`[data-wfx-f="${CSS.escape(fieldId)}"]`)];
  return all.filter(el => {
    const li = el.closest('[data-wfx-i]');
    return inList ? li === scope : !li;
  });
}
// <title> and meta tags show item values too (Webflow SEO settings)
function patchHead(doc, swaps) {
  for (const { from, to } of swaps) {
    if (!from || from === to || norm(from).length < 3) continue;
    const t = doc.querySelector('title');
    if (t && t.textContent.includes(from)) t.textContent = t.textContent.split(from).join(to);
    doc.querySelectorAll('head meta[content]').forEach(m => {
      const c = m.getAttribute('content');
      if (c && c.includes(from)) m.setAttribute('content', c.split(from).join(to));
    });
  }
}
const textSwaps = (col, before, after) => col.fields
  .filter(f => f.kind === 'text' && before && after && before[f.id]?.t === 'string' && after[f.id]?.t === 'string' && before[f.id].v !== after[f.id].v)
  .map(f => ({ from: before[f.id].v, to: after[f.id].v }));

// Deleting an item clears every reference to it (as Webflow does): a post
// whose author was deleted shows no author instead of a link to a missing page
function withDeletedRefsCleared(state) {
  const gone = new Set();
  state.collections.forEach(c => c.items.forEach(i => { if (i.status === 'deleted') gone.add(`${c.id}/${i.data.id?.v}`); }));
  if (!gone.size) return state;
  return {
    ...state,
    collections: state.collections.map(c => {
      const refs = c.fields.filter(f => f.ref && (f.kind === 'ref' || f.kind === 'multiref'));
      if (!refs.length) return c;
      let changedCol = false;
      const items = c.items.map(it => {
        if (it.status === 'deleted') return it;
        let data = null;
        for (const f of refs) {
          const v = it.data[f.id];
          if (f.kind === 'ref' && v?.v && gone.has(`${f.ref}/${v.v}`)) { data = data || structuredClone(it.data); data[f.id] = { t: 'null', v: null }; }
          if (f.kind === 'multiref' && v?.t === 'array' && v.v.some(x => gone.has(`${f.ref}/${x.v}`))) {
            data = data || structuredClone(it.data);
            data[f.id] = { t: 'array', v: v.v.filter(x => !gone.has(`${f.ref}/${x.v}`)) };
          }
        }
        if (!data) return it;
        changedCol = true;
        return { ...it, data, status: it.status === 'clean' ? 'edited' : it.status };
      });
      return changedCol ? { ...c, items } : c;
    }),
  };
}

// ── Build: compute every file change for the current edits ───────────────────
// Returns Map(path → string | Uint8Array | null)  (null = delete)
export async function buildChanges(state, uploads = new Map(), opts = {}) {
  state = withDeletedRefsCleared(state);
  const { manifest } = state;
  const changes = new Map();
  const dirty = state.collections.filter(isDirty);
  if (!dirty.length && !uploads.size) return changes;
  const read = p => readText(p, { cache: !!opts.cache });
  const parser = new DOMParser();

  // Parsed pages, written back at the end
  const docs = new Map();     // page → Document
  const touched = new Set();
  const getDoc = async p => {
    if (!docs.has(p)) docs.set(p, parser.parseFromString(await read(pageFile(p)), 'text/html'));
    return docs.get(p);
  };
  const touch = p => touched.add(p);

  let pages = [...manifest.pages];
  const newManifest = structuredClone(manifest);
  const moved = new Map();    // old page → new page
  const removed = new Set();  // pages of deleted items

  const created = [];         // pages made in this build (new items)
  const exists = p => pages.includes(p);
  // Pages that show cards of a collection (lists, found at export) — following
  // moved pages, plus the pages created now (copies of pages with lists)
  const listPagesOf = c => [...new Set([...(c.listPages || manifest.pages).map(p => moved.get(p) || p), ...created])].filter(exists);

  // An item's own page (+ its paginated copies): apply fields
  const liveBase = String(manifest.liveUrl || '').replace(/\/+$/, '');
  const applyOnPages = async (col, it, fieldIds, pageList, headSwaps, before) => {
    for (const p of pageList) {
      if (!exists(p)) continue;
      let d; try { d = await getDoc(p); } catch { continue; }
      for (const f of col.fields) {
        if (!fieldIds.includes(f.id) || !f.kind) continue;
        for (const el of marks(d, f.id, false)) applyField(el, f, it.data[f.id], { pageDir: p, state });
        // The social preview showed the old image → show the new one (needs the live address)
        const oldSrc = imgSrcOf(before?.[f.id]), newSrc = imgSrcOf(it.data[f.id]);
        if (liveBase && oldSrc && newSrc && oldSrc !== newSrc) {
          d.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]').forEach(m => {
            if (stemOf(m.getAttribute('content')) === stemOf(oldSrc)) m.setAttribute('content', /^https?:/.test(newSrc) ? newSrc : `${liveBase}/${newSrc}`);
          });
        }
      }
      if (headSwaps && headSwaps.length) patchHead(d, headSwaps);
      touch(p);
    }
  };
  // Every card of an item in every list
  const applyOnLists = async (col, it, fieldIds) => {
    const sel = `[data-wfx-i="${CSS.escape(col.id + '/' + it.data.id.v)}"]`;
    for (const p of listPagesOf(col)) {
      let d; try { d = await getDoc(p); } catch { continue; }
      const cards = d.querySelectorAll(sel);
      if (!cards.length) continue;
      cards.forEach(li => {
        for (const f of col.fields) {
          if (!fieldIds.includes(f.id) || !f.kind) continue;
          for (const el of marks(li, f.id, true)) applyField(el, f, it.data[f.id], { pageDir: p, state });
        }
      });
      touch(p);
    }
  };
  const pagesOfItem = (mcol, it) => {
    const id = it.data.id.v;
    return [mcol.itemPages[id], ...(mcol.extraPages[id] || [])].filter(Boolean);
  };

  // ── Pass 1: pages appear, move and disappear ──────────────────────────────
  const plans = [];
  for (const col of dirty) {
    const mcol = newManifest.collections.find(c => c.id === col.id);
    mcol.itemPages = { ...(mcol.itemPages || {}) };
    mcol.extraPages = { ...(mcol.extraPages || {}) };
    const prefix = col.pagePrefix;
    const template = col.items.find(i => i.page && i.status !== 'new' && i.status !== 'deleted' && exists(i.page));
    const templateDoc = template ? await getDoc(template.page) : null;
    const templateHtml = templateDoc ? serialize(templateDoc) : null; // before any edits
    plans.push({ col, mcol, template });

    for (const it of col.items) {
      const id = it.data.id?.v;
      const oldPage = it.page;
      const extras = mcol.extraPages[id] || [];
      if (it.status === 'deleted') {
        for (const p of [oldPage, ...extras].filter(Boolean)) { changes.set(pageFile(p), null); pages = pages.filter(x => x !== p); docs.delete(p); touched.delete(p); removed.add(p); }
        delete mcol.itemPages[id]; delete mcol.extraPages[id];
        continue;
      }
      if (it.status === 'clean' || !prefix) continue;
      const slug = itemSlug(col, it);
      const want = `${prefix}/${slug}`;
      if (it.status === 'new') {
        if (!templateHtml) continue;
        const d = parser.parseFromString(templateHtml, 'text/html');
        d.documentElement.setAttribute('data-wf-item-slug', slug);
        docs.set(want, d);
        if (!exists(want)) pages.push(want);
        created.push(want);
        mcol.itemPages[id] = want;
        continue;
      }
      if (oldPage && oldPage !== want) {
        // Slug changed: the page (and its paginated copies) move
        const movedExtras = [];
        for (const p of [oldPage, ...extras]) {
          const target = want + p.slice(oldPage.length);
          const d = await getDoc(p);
          d.documentElement.setAttribute('data-wf-item-slug', slug);
          docs.set(target, d); docs.delete(p); touched.delete(p);
          changes.set(pageFile(p), null);
          pages = pages.filter(x => x !== p);
          if (!exists(target)) pages.push(target);
          moved.set(p, target);
          if (p !== oldPage) movedExtras.push(target);
        }
        mcol.itemPages[id] = want;
        if (extras.length) mcol.extraPages[id] = movedExtras;
      }
    }
  }

  // ── Pass 2: fields on item pages and in lists ─────────────────────────────
  for (const { col, mcol, template } of plans) {
    const fieldIds = col.fields.map(f => f.id);
    const prefix = col.pagePrefix;
    const live = col.items.filter(i => i.status !== 'deleted');

    for (const it of live) {
      if (it.status === 'clean') continue;
      const id = it.data.id.v;
      if (it.status === 'new') {
        if (prefix && template) await applyOnPages(col, it, fieldIds, pagesOfItem(mcol, it), textSwaps(col, template.orig || template.data, it.data));
        continue;
      }
      const changed = fieldIds.filter(k => !same(it.data[k], it.orig?.[k]));
      const wasMoved = it.page && mcol.itemPages[id] !== it.page;
      await applyOnPages(col, it, wasMoved ? fieldIds : changed, pagesOfItem(mcol, it), textSwaps(col, it.orig, it.data), it.orig);
      if (changed.length) await applyOnLists(col, it, changed);

      // Renamed item that others reference (a Category's name shown on posts)
      if (col.titleFieldId && changed.includes(col.titleFieldId)) {
        for (const oc of state.collections) {
          const refFields = oc.fields.filter(f => f.ref === col.id).map(f => f.id);
          if (!refFields.length) continue;
          const omc = newManifest.collections.find(c => c.id === oc.id);
          for (const oi of oc.items) {
            const uses = val => val?.v === id || (val?.t === 'array' && val.v.some(x => x.v === id));
            if (oi.status === 'deleted' || !refFields.some(k => uses(oi.data[k]))) continue;
            await applyOnPages(oc, oi, refFields, [omc.itemPages[oi.data.id.v], ...((omc.extraPages || {})[oi.data.id.v] || [])].filter(Boolean));
            await applyOnLists(oc, oi, refFields);
          }
        }
      }
    }

    // Lists: remove deleted cards, add new ones, follow the new order
    const order = new Map(live.map((it, i) => [it.data.id.v, i]));
    const byId = new Map(col.items.map(it => [it.data.id.v, it]));
    const fresh = live.filter(i => i.status === 'new');
    const isCard = el => (el.getAttribute('data-wfx-i') || '').startsWith(col.id + '/');
    const idOf = el => el.getAttribute('data-wfx-i').slice(col.id.length + 1);
    // A filtered list (every card has Category = Travel) only takes items that match
    const filtersOf = ids => col.fields.filter(f => f.kind === 'ref').map(f => {
      const vals = new Set(ids.map(id => JSON.stringify(byId.get(id)?.data[f.id] ?? null)));
      return ids.length > 1 && vals.size === 1 ? { id: f.id, val: [...vals][0] } : null;
    }).filter(Boolean);

    // Paginated lists (blog, blog/page-2, …) are one list split in pages:
    // collect all cards, add/remove/reorder, then refill each page
    const pagBoxes = new Set();
    for (const g of col.paginated || []) {
      const boxes = [];
      for (const p of g.pages.map(x => moved.get(x) || x).filter(exists)) {
        let d; try { d = await getDoc(p); } catch { continue; }
        const counts = new Map();
        d.querySelectorAll(`[data-wfx-i^="${CSS.escape(col.id + '/')}"]`).forEach(c => counts.set(c.parentElement, (counts.get(c.parentElement) || 0) + 1));
        const box = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (box) { boxes.push({ p, d, box }); pagBoxes.add(box); }
      }
      if (!boxes.length) continue;
      const before = boxes.map(b => [...b.box.children].filter(isCard).map(idOf).join());
      let cards = boxes.flatMap(b => [...b.box.children].filter(isCard).map(el => ({ el, dir: b.p })));
      const kept = cards.filter(c => byId.get(idOf(c.el))?.status !== 'deleted');
      if (!kept.length) continue;
      const shown = new Set(kept.map(c => idOf(c.el)));
      const filters = filtersOf([...shown]);
      const matches = it => filters.every(f => JSON.stringify(it.data[f.id] ?? null) === f.val);
      const tpl = kept[0];
      const tplPage = pageOfCardItem(col, byId.get(idOf(tpl.el)), idOf(tpl.el));
      for (const it of fresh) {
        if (shown.has(it.data.id.v) || !matches(it)) continue;
        kept.push({ el: makeCard(tpl.el.ownerDocument, tpl.el, tpl.dir, tplPage, col, it, tpl.dir, state), dir: tpl.dir });
      }
      kept.sort((a, b) => (order.get(idOf(a.el)) ?? 0) - (order.get(idOf(b.el)) ?? 0));
      cards.forEach(c => c.el.remove());
      kept.forEach((c, i) => {
        const b = boxes[Math.min(Math.floor(i / g.size), boxes.length - 1)];
        let el = c.el;
        if (el.ownerDocument !== b.d || c.dir !== b.p) { el = b.d.importNode(el, true); rebase(el, c.dir, b.p); }
        b.box.appendChild(el);
      });
      boxes.forEach((b, i) => { if ([...b.box.children].filter(isCard).map(idOf).join() !== before[i]) touch(b.p); });
    }

    // Webflow "offset" lists: several one-item lists side by side (slider
    // slides, featured slots) show items 1, 2, 3… of the collection in order
    const origOrder = col.items.filter(i => i.status !== 'new').map(i => i.data.id.v);
    for (const p of listPagesOf(col)) {
      let d; try { d = await getDoc(p); } catch { continue; }
      const containers = new Set([...d.querySelectorAll(`[data-wfx-i^="${CSS.escape(col.id + '/')}"]`)].map(li => li.parentElement).filter(Boolean));
      let any = false;
      const singles = [...containers].filter(b => !pagBoxes.has(b) && b.children.length === 1 && !(b.parentElement && b.parentElement.closest('[data-wfx-f]')));
      if (singles.length >= 2) {
        const offset = origOrder.indexOf(idOf(singles[0].children[0]));
        const tplEl = singles[0].children[0];
        const tplPage = pageOfCardItem(col, byId.get(idOf(tplEl)), idOf(tplEl));
        if (offset >= 0) singles.forEach((b, k) => {
          const want = live[offset + k];
          const cur = b.children[0];
          containers.delete(b);
          if (!want) { cur.remove(); any = true; return; }
          if (idOf(cur) === want.data.id.v && want.status === 'clean') return;
          if (idOf(cur) === want.data.id.v) return; // its fields were written above
          b.replaceChild(makeCard(d, tplEl, p, tplPage, col, want, p, state), cur);
          any = true;
        });
      }
      for (const box of containers) {
        if (pagBoxes.has(box)) continue;
        const cards = () => [...box.children].filter(isCard);
        // A post's own Tags list follows that post's field, never the Tags collection
        if (box.parentElement && box.parentElement.closest('[data-wfx-f]')) {
          for (const li of cards()) if (byId.get(idOf(li))?.status === 'deleted') { li.remove(); any = true; }
          continue;
        }
        // deleted
        for (const li of cards()) { const it = byId.get(idOf(li)); if (it && it.status === 'deleted') { li.remove(); any = true; } }
        let present = cards();
        if (!present.length) continue;
        const shown = new Set(present.map(idOf));
        // new: a full list gets every new item; a shorter list (latest 3) gets
        // the ones that fall inside what it shows, and keeps its length
        const filters = filtersOf(present.map(idOf));
        const matches = it => filters.every(f => JSON.stringify(it.data[f.id] ?? null) === f.val);
        // positions within what this list can show (the filtered order)
        const pool = live.filter(matches);
        const rank = new Map(pool.map((it, i) => [it.data.id.v, i]));
        const complete = pool.filter(i => i.status !== 'new').every(i => shown.has(i.data.id.v));
        const idxs = present.map(li => rank.get(idOf(li)) ?? -1);
        const firstIdx = Math.min(...idxs), lastIdx = Math.max(...idxs);
        for (const it of fresh) {
          if (shown.has(it.data.id.v) || !matches(it)) continue;
          const idx = rank.get(it.data.id.v);
          // A partial list (latest 3, page 2 of a paginated list) shows a window of
          // the order: add the item only where it lands inside that window
          if (!complete && (idx > lastIdx || idx < firstIdx - 1)) continue;
          const tpl = present[0];
          const li = makeCard(d, tpl, p, pageOfCardItem(col, byId.get(idOf(tpl)), idOf(tpl)), col, it, p, state);
          box.appendChild(li);
          shown.add(it.data.id.v);
          if (!complete) { const drop = cards().sort((a, b) => (order.get(idOf(b)) ?? 0) - (order.get(idOf(a)) ?? 0))[0]; if (drop && drop !== li) { shown.delete(idOf(drop)); drop.remove(); } }
          any = true;
        }
        // order: the cards take the collection's order, in the slots they had
        present = cards();
        const sorted = [...present].sort((a, b) => (order.get(idOf(a)) ?? 0) - (order.get(idOf(b)) ?? 0));
        if (sorted.some((el, i) => el !== present[i])) {
          const anchors = present.map(el => { const m = d.createComment('slot'); el.replaceWith(m); return m; });
          anchors.forEach((m, i) => m.replaceWith(sorted[i]));
          any = true;
        }
      }
      if (any) touch(p);
    }

    mcol.items = live.map(i => ({ data: i.data }));
  }

  // Links to moved pages (slug changes) on every page we have open + lists
  // Links to moved pages follow them; links to deleted pages are disarmed
  if (moved.size || removed.size) {
    const scan = new Set([...docs.keys(), ...pages, '404']);
    for (const p of scan) {
      if (p !== '404' && !pages.includes(p)) continue;
      let d; try { d = await getDoc(p); } catch { continue; }
      let any = false;
      d.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        const hash = href.includes('#') ? '#' + href.split('#')[1] : '';
        const k = resolveIn(p === '404' ? '' : p, href);
        if (k != null && removed.has(k) && !moved.has(k)) { a.setAttribute('href', '#'); any = true; return; }
        if (k == null || !moved.has(k)) return;
        // 404.html is served at any address, so its links are root-absolute
        a.setAttribute('href', (p === '404' ? `/${moved.get(k)}/` : relPage(p, moved.get(k))) + hash);
        any = true;
      });
      if (any) touch(p);
    }
  }

  for (const p of touched) if (docs.has(p) && (pages.includes(p) || p === '404')) changes.set(pageFile(p), serialize(docs.get(p)));

  // Uploaded files — only the ones still used
  if (uploads.size) {
    const used = JSON.stringify(state.collections.map(c => c.items.filter(i => i.status !== 'deleted').map(i => i.data)));
    for (const [path, bytes] of uploads) if (used.includes(path)) changes.set(path, bytes);
  }

  // Sitemap: pages added / removed / moved
  if (dirty.length && (pages.length !== manifest.pages.length || moved.size)) {
    try {
      const sm = await read('sitemap.xml');
      const base = (sm.match(/<loc>(https?:\/\/[^<]*?)\/(?:[^<]*)<\/loc>/) || [])[1];
      if (base) {
        const head = sm.slice(0, sm.indexOf('<urlset'));
        const urls = ['', ...pages.filter(p => p && p !== '404')].map(p => `  <url><loc>${base}/${p ? encodeURI(p) + '/' : ''}</loc></url>`).join('\n');
        changes.set('sitemap.xml', `${head}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
      }
    } catch {}
  }

  newManifest.pages = pages;
  newManifest.updatedAt = new Date().toISOString();
  changes.set('cms/fx-site.json', JSON.stringify(newManifest));

  if (opts.extraFiles) for (const [p, c] of opts.extraFiles(state, newManifest)) changes.set(p, c);
  for (const [p, c] of [...changes]) {
    if (typeof c !== 'string' || !/^(cms\/data\/|sitemap\.xml$)/.test(p)) continue;
    try { if ((await read(p)) === c) changes.delete(p); } catch {}
  }
  return changes;
}

// Someone published from another tab or device since this session loaded.
// Take their latest content and re-apply only THIS session's own edits.
export function rebaseEdits(latest, current) {
  const urlChanged = current.manifest.liveUrl !== (current.manifest._liveUrlSaved ?? current.manifest.liveUrl);
  return {
    ...latest,
    manifest: { ...latest.manifest, liveUrl: urlChanged ? current.manifest.liveUrl : latest.manifest.liveUrl, _liveUrlSaved: latest.manifest.liveUrl },
    collections: latest.collections.map(lc => {
      const cc = current.collections.find(c => c.id === lc.id);
      if (!cc) return lc;
      const mine = new Map(cc.items.map(i => [i.key, i]));
      const items = lc.items.map(li => {
        const ci = mine.get(li.key);
        if (!ci || ci.status === 'clean') return li;
        if (ci.status === 'deleted') return { ...li, status: 'deleted' };
        const data = structuredClone(li.data);
        for (const k of Object.keys(ci.data)) if (!same(ci.data[k], ci.orig?.[k])) data[k] = ci.data[k];
        return { ...li, data, status: same(data, li.orig) ? 'clean' : 'edited' };
      });
      const known = new Set(lc.items.map(i => i.key));
      for (const ci of cc.items) if (ci.status === 'new' && !known.has(ci.key)) items.push(ci);
      return { ...lc, items };
    }),
  };
}

// After a successful publish, the edited state becomes the new baseline.
export function commitState(state, changes) {
  const manifestText = changes.get('cms/fx-site.json');
  const manifest = manifestText ? JSON.parse(manifestText) : state.manifest;
  const collections = state.collections.map(c => {
    const mc = manifest.collections.find(x => x.id === c.id) || c;
    return {
      ...c,
      itemPages: mc.itemPages,
      extraPages: mc.extraPages,
      items: c.items.filter(i => i.status !== 'deleted').map(i => ({
        ...i, orig: structuredClone(i.data), status: 'clean', page: mc.itemPages?.[i.data.id?.v] || null,
      })),
    };
  });
  return { manifest, collections };
}

export { richTextToHtml, richTextToPlain };

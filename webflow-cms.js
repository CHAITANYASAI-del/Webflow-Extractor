// webflow-cms.js — finds the Webflow CMS inside an export and makes it editable.
//
// Webflow publishes CMS content as finished HTML, but leaves clues:
//   • every item page carries <html data-wf-collection="…" data-wf-item-slug="…">
//   • every collection list item is a .w-dyn-item (inside .w-dyn-items)
//   • empty bound fields get the class .w-dyn-bind-empty
// Item pages of one collection share a template, so the parts that differ
// between them are the CMS fields (the same goes for the cards of one list).
// Those elements get a data-wfx-f="<field>" marker, list cards get
// data-wfx-i="<collection>/<item>", and the values go to cms/fx-site.json.
// The editor at /cms reads that file and, on publish, rewrites exactly the
// marked elements.
(function (root) {
  'use strict';

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'TEMPLATE', 'IFRAME', 'FORM', 'SELECT', 'TEXTAREA', 'INPUT', 'VIDEO', 'svg']);
  const MAX_COMPARE = 25;   // pages / cards compared per collection to find the fields
  // Classes Webflow toggles per item or at runtime — not part of the template
  const SIG_SKIP = /^(?:w-condition-invisible|w-dyn-bind-empty|w--current|w--open|w--tab-active|w-dyn-hide)$/;

  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const cls = el => (el && el.getAttribute && el.getAttribute('class')) || '';
  const hasCls = (el, c) => (' ' + cls(el) + ' ').includes(' ' + c + ' ');
  const kids = el => Array.from((el && el.children) || []);
  const tag = el => String((el && el.tagName) || '').toUpperCase();
  const sig = el => tag(el) + '.' + cls(el).split(/\s+/).filter(c => c && !SIG_SKIP.test(c)).join('.');
  const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

  // Children keyed by "TAG.classes#n": a block that exists on only some pages
  // (conditional visibility, a gallery with more images) doesn't shift the rest
  function keyedKids(el) {
    const counts = Object.create(null), m = new Map();
    for (const k of kids(el)) { const s = sig(k); counts[s] = (counts[s] || 0) + 1; m.set(s + '#' + counts[s], k); }
    return m;
  }
  const atPath = (start, path) => {
    let el = start;
    for (const k of path) { el = el && keyedKids(el).get(k); if (!el) return null; }
    return el;
  };
  function pathTo(start, el) {
    const path = [];
    for (let cur = el; cur && cur !== start; cur = cur.parentElement) {
      const p = cur.parentElement;
      if (!p) return null;
      for (const [k, v] of keyedKids(p)) if (v === cur) { path.unshift(k); break; }
    }
    return path;
  }

  // "../../images/a.jpg" on page "post/x" → "images/a.jpg"
  function resolvePath(pageDir, ref) {
    if (!ref || /^(?:[a-z]+:|\/\/|#|data:)/i.test(ref)) return null;
    try {
      const u = new URL(ref, 'http://x/' + (pageDir ? pageDir + '/' : ''));
      return decodeURIComponent(u.pathname).replace(/^\/+/, '');
    } catch { return null; }
  }
  // page link → page key ("post/x/" → "post/x")
  function linkKey(pageDir, href) {
    const p = resolvePath(pageDir, href);
    if (p === null) return null;
    return p.replace(/(?:^|\/)index\.html$/i, '').replace(/\/+$/, '');
  }
  // Webflow image variants share a stem: hero.jpg, hero-p-500.jpg, hero-p-1080.jpg
  const stem = p => String(p || '').split(/[?#]/)[0].split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/-p-\d+(?:x\d+)?(?:q\d+)?$/i, '').toLowerCase();
  const bgOf = el => {
    const m = /background-image\s*:\s*url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec((el.getAttribute && el.getAttribute('style')) || '');
    return m ? m[2] : null;
  };
  const isLeafText = el => !kids(el).length || kids(el).every(k => tag(k) === 'BR');
  const skipEl = el => SKIP_TAGS.has(tag(el)) || hasCls(el, 'w-embed') || hasCls(el, 'w-webflow-badge') || hasCls(el, 'w-json');

  // A short static label right before a field ("Location", "Client:")
  function neighborLabel(nodes) {
    // the label element itself, or a small wrapper around it (label-wrap > div)
    const textOf = el => {
      if (!el || SKIP_TAGS.has(tag(el)) || el.querySelector('img,svg,video,iframe,.w-dyn-list') || el.querySelectorAll('*').length > 4) return null;
      const t = norm(el.textContent).replace(/[:：]\s*$/, '');
      return t.length >= 2 && t.length <= 32 && /\p{L}/u.test(t) ? t : null;
    };
    const label = n => {
      for (let cur = n, depth = 0; cur && depth < 3; cur = cur.parentElement, depth++) {
        let prev = cur.previousElementSibling;
        while (prev && (hasCls(prev, 'w-embed') || SKIP_TAGS.has(tag(prev)))) prev = prev.previousElementSibling; // icons
        if (prev) return textOf(prev);
      }
      return null;
    };
    const ls = nodes.map(label);
    return ls[0] && ls.every(l => l === ls[0]) && !nodes.some(n => norm(n.textContent) === ls[0]) ? ls[0] : null;
  }

  // ── Field detection ───────────────────────────────────────────────────────
  // Walk the item pages (or list cards) side by side; what differs is a field.
  function findFields(starts, { lists = false } = {}) {
    const found = [];   // { path, kind, hint }
    const walk = (nodes, path) => {
      const ref = nodes[0];
      if (nodes.some(n => !n || tag(n) !== tag(ref)) || skipEl(ref)) return;
      if (hasCls(ref, 'w-dyn-list')) { if (lists) found.push({ path, kind: 'list' }); return; }
      const bindEmpty = nodes.some(n => hasCls(n, 'w-dyn-bind-empty'));
      const hint = () => neighborLabel(nodes);
      if (hasCls(ref, 'w-richtext')) {
        if (bindEmpty || new Set(nodes.map(n => norm(n.innerHTML))).size > 1) found.push({ path, kind: 'richtext', hint: hint() });
        return;
      }
      if (tag(ref) === 'IMG') {
        if (bindEmpty || new Set(nodes.map(n => stem(n.getAttribute('src')))).size > 1) found.push({ path, kind: 'image', hint: hint() });
        return;
      }
      if (nodes.some(bgOf) && new Set(nodes.map(n => stem(bgOf(n)))).size > 1) found.push({ path, kind: 'bg', hint: hint() });
      if (tag(ref) === 'A') {
        const hrefs = nodes.map(n => n.getAttribute('href') || '');
        if (new Set(hrefs).size > 1 && hrefs.every(h => !h || /^(?:https?:|mailto:|tel:)/i.test(h) || h === '#')) found.push({ path, kind: 'link', hint: hint() });
      }
      if (isLeafText(ref)) {
        if (nodes.every(isLeafText) && (bindEmpty || new Set(nodes.map(n => norm(n.textContent))).size > 1)) found.push({ path, kind: 'text', hint: hint() });
        return;
      }
      const maps = nodes.map(keyedKids);
      for (const k of maps[0].keys()) if (maps.every(m => m.has(k))) walk(maps.map(m => m.get(k)), path.concat(k));
    };
    walk(starts, []);
    return found;
  }

  // Only one example to look at (a collection with one item, a list with one
  // card): take what is clearly content.
  function guessFields(start, { title, desc, ogImage, card } = {}) {
    const found = [];
    const add = (el, kind) => { const path = pathTo(start, el); if (path && !found.some(f => f.path.join() === path.join())) found.push({ path, kind, hint: neighborLabel([el]) }); };
    const all = Array.from(start.querySelectorAll('*')).filter(el => !el.closest('.w-dyn-list') || card);
    const visible = all.filter(el => !skipEl(el) && !(el.parentElement && el.parentElement.closest('script,style,svg,noscript,.w-embed')));
    for (const el of visible) {
      if (hasCls(el, 'w-dyn-bind-empty')) add(el, tag(el) === 'IMG' ? 'image' : hasCls(el, 'w-richtext') ? 'richtext' : 'text');
      else if (hasCls(el, 'w-richtext')) add(el, 'richtext');
      else if (card && tag(el) === 'IMG') add(el, 'image');
      else if (card && isLeafText(el) && norm(el.textContent) && !el.closest('.w-richtext')) add(el, 'text');
      else if (!card && tag(el) === 'H1' && isLeafText(el)) add(el, 'text');
      else if (!card && desc && isLeafText(el) && norm(el.textContent) === desc) add(el, 'text');
      else if (!card && ogImage && tag(el) === 'IMG' && stem(el.getAttribute('src')) === stem(ogImage)) add(el, 'image');
    }
    return found.slice(0, 16);
  }

  function readValue(el, kind, pageDir) {
    if (!el) return { t: 'null', v: null };
    const empty = hasCls(el, 'w-dyn-bind-empty');
    switch (kind) {
      case 'richtext': return { t: 'richtext', v: empty ? '' : el.innerHTML.trim() };
      case 'image': {
        const src = el.getAttribute('src');
        const p = empty || !src ? null : (resolvePath(pageDir, src) || src);
        return p ? { t: 'image', v: { src: p, alt: el.getAttribute('alt') || '' } } : { t: 'null', v: null };
      }
      case 'bg': {
        const u = bgOf(el);
        const p = u ? (resolvePath(pageDir, u) || u) : null;
        return p ? { t: 'image', v: { src: p, alt: '' } } : { t: 'null', v: null };
      }
      case 'link': {
        const h = el.getAttribute('href') || '';
        return h && h !== '#' ? { t: 'link', v: h } : { t: 'null', v: null };
      }
      default: return { t: 'string', v: empty ? '' : norm(el.textContent) };
    }
  }

  const TYPE = { text: 'String', richtext: 'RichText', image: 'Image', bg: 'Image', link: 'Link' };
  const humanize = s => String(s).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const singular = s => s.replace(/ies$/i, 'y').replace(/([^s])s$/i, '$1');
  const plural = s => /s$/i.test(s) ? s : /[^aeiou]y$/i.test(s) ? s.slice(0, -1) + 'ies' : s + 's';
  const DATE_RE = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,? )?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}$|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|^\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4}$|^\d{4}-\d{2}-\d{2}$/i;

  function labelFor(el, spot, values, heads) {
    const { kind, hint } = spot;
    if (kind === 'text') {
      if (tag(el) === 'H1' || (heads && values.some((v, i) => v && heads[i] && heads[i].title && heads[i].title.includes(v) && v.length > 3))) return 'Name';
      if (heads && values.some((v, i) => v && heads[i] && heads[i].desc && heads[i].desc === v)) return 'Summary';
      if (values.filter(Boolean).length && values.every(v => !v || DATE_RE.test(v))) return hint && !/^\d/.test(hint) ? cap(hint) : 'Date';
    }
    if (hint) return cap(hint);
    if (kind === 'richtext') return 'Content';
    if (kind === 'link') return 'Link';
    const own = cls(el).split(/\s+/).filter(c => c && !/^(?:w-|is-|for-|text-|heading|paragraph|div-block|_)/i.test(c));
    if (own.length) return humanize(own[0]);
    return kind === 'image' || kind === 'bg' ? 'Image' : 'Text';
  }

  // Spots + values → fields with unique titles, duplicates merged
  function buildFields(spots, samples, rows, heads, idBase) {
    const used = new Set();
    const fields = spots.map((s, i) => {
      const values = samples.map(st => { const v = readValue(atPath(st, s.path), s.kind, ''); return typeof v.v === 'string' ? v.v : ''; });
      const title = labelFor(atPath(samples[0], s.path), s, values, heads);
      let t = title, n = 2;
      while (used.has(t.toLowerCase())) t = `${title} ${n++}`;
      used.add(t.toLowerCase());
      return { id: `${idBase}${i + 1}`, title: t, type: TYPE[s.kind], kind: s.kind, path: s.path };
    });
    // The same value shown twice (heading + breadcrumb) is one field
    const alias = {};
    fields.forEach((f, i) => {
      for (let j = 0; j < i; j++) {
        const o = fields[j];
        if (alias[o.id] || o.kind !== f.kind) continue;
        if (rows.every(r => JSON.stringify(r.vals[o.id]) === JSON.stringify(r.vals[f.id]))) { alias[f.id] = o.id; break; }
      }
    });
    const kept = fields.filter(f => !alias[f.id]);
    // A field shown twice may be labelled in only one of the spots ("Work type")
    const generic = t => /^(?:text|content|image|link)(?: \d+)?$/i.test(t);
    kept.forEach(f => {
      if (!generic(f.title)) return;
      const better = fields.find(o => alias[o.id] === f.id && !generic(o.title) && !/ \d+$/.test(o.title));
      if (better) f.title = better.title;
    });
    const seenT = new Set();
    kept.forEach(f => { let t = f.title, n = 2; while (seenT.has(t.toLowerCase())) t = `${f.title.replace(/ \d+$/, '')} ${n++}`; f.title = t; seenT.add(t.toLowerCase()); });
    if (kept.some(f => f.title === 'Name 2') && !kept.some(f => f.title === 'Name')) kept.find(f => f.title === 'Name 2').title = 'Name';
    return { fields, kept, alias };
  }
  const readRows = (fields, list) => list.map(x => {
    const vals = {}, els = {};
    for (const f of fields) {
      const el = atPath(x.start, f.path);
      if (!el) { vals[f.id] = { t: 'null', v: null }; continue; }
      vals[f.id] = readValue(el, f.kind, x.dir);
      els[f.id] = el;
    }
    return { ...x, vals, els };
  });

  // ── Main entry ───────────────────────────────────────────────────────────
  // pages: [{ key, html }]  (final, rewritten HTML)
  // returns null (no CMS) or { pages: Map(key → html), manifest, stats }
  function annotate(pages, opts) {
    const DP = (opts && opts.DOMParser) || root.DOMParser;
    if (!DP) return null;
    const parser = new DP();
    const docs = new Map();
    const htmlOf = new Map(pages.map(p => [p.key, p.html]));
    const docOf = key => {
      if (!docs.has(key)) docs.set(key, htmlOf.has(key) ? parser.parseFromString(htmlOf.get(key), 'text/html') : null);
      return docs.get(key);
    };
    const pageKeys = pages.map(p => p.key);
    const attrOfHtml = (html, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec((/<html\b[^>]*>/i.exec(html) || [''])[0]) || [])[1];

    // Other-language copies (Webflow Localization: /fr/…) keep their own text:
    // never mark or rewrite them with the main language's values
    const mainLang = (attrOfHtml(htmlOf.get('') || '', 'lang') || '').toLowerCase();
    const foreign = new Set(pageKeys.filter(k => mainLang && (attrOfHtml(htmlOf.get(k), 'lang') || mainLang).toLowerCase() !== mainLang));

    // 1. Item pages, grouped by collection (prefix/slug); their paginated
    //    copies (prefix/slug/page-2) belong to the same item
    const groups = new Map();
    const withCol = pages.filter(p => !foreign.has(p.key)).map(p => ({ key: p.key, col: attrOfHtml(p.html, 'data-wf-collection'), slug: attrOfHtml(p.html, 'data-wf-item-slug') })).filter(p => p.col && p.slug);
    for (const p of withCol) {
      const segs = p.key.split('/');
      if (segs.length !== 2 || segs[1] !== p.slug) continue;
      if (!groups.has(p.col)) groups.set(p.col, { prefix: segs[0], items: new Map(), extras: new Map() });
      const g = groups.get(p.col);
      if (g.prefix === segs[0]) g.items.set(p.slug, p.key);
    }
    for (const p of withCol) {
      const g = groups.get(p.col);
      if (g && new RegExp(`^${g.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${p.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/page-\\d+$`).test(p.key)) {
        if (!g.extras.has(p.slug)) g.extras.set(p.slug, []);
        g.extras.get(p.slug).push(p.key);
      }
    }

    const headOf = d => ({
      title: norm((d.querySelector('title') || {}).textContent || ''),
      desc: norm(((d.querySelector('meta[name="description"]') || { getAttribute: () => '' }).getAttribute('content')) || ''),
      og: ((d.querySelector('meta[property="og:image"]') || { getAttribute: () => '' }).getAttribute('content')) || '',
    });

    const collections = [];
    const pendingLists = [];   // nested lists on item pages → maybe multi-reference fields
    for (const [colId, g] of groups) {
      const slugs = [...g.items.keys()];
      const sample = slugs.slice(0, MAX_COMPARE).map(s => docOf(g.items.get(s)).body);
      const heads = sample.map(b => headOf(b.ownerDocument));
      let spots = sample.length > 1 ? findFields(sample, { lists: true })
        : guessFields(sample[0], { desc: heads[0].desc, ogImage: heads[0].og });
      const listSpots = spots.filter(s => s.kind === 'list');
      spots = spots.filter(s => s.kind !== 'list');
      if (!spots.length) continue;

      const pre = spots.map((s, i) => ({ id: `f${i + 1}`, kind: s.kind, path: s.path }));
      const rows = readRows(pre, slugs.map(slug => ({ slug, key: g.items.get(slug), dir: g.items.get(slug), start: docOf(g.items.get(slug)).body })));
      const { fields, kept, alias } = buildFields(spots, sample, rows, heads, 'f');
      const titleField = kept.find(f => f.title === 'Name') || kept.find(f => f.kind === 'text');

      const items = [];
      const itemPages = {}, extraPages = {};
      for (const r of rows) {
        const data = { id: { t: 'string', v: r.slug }, slug: { t: 'string', v: r.slug } };
        kept.forEach(f => { data[f.id] = r.vals[f.id]; });
        for (const f of fields) {
          const el = r.els[f.id];
          if (!el) continue;
          const id = alias[f.id] || f.id;
          el.setAttribute('data-wfx-f', id);
          for (const ek of g.extras.get(r.slug) || []) {
            const ee = atPath(docOf(ek).body, f.path);
            if (ee && tag(ee) === tag(el)) ee.setAttribute('data-wfx-f', id);
          }
        }
        items.push({ data });
        itemPages[r.slug] = r.key;
        if (g.extras.has(r.slug)) extraPages[r.slug] = g.extras.get(r.slug);
      }
      const name = humanize(g.prefix);
      const col = {
        id: colId, name, singular: singular(name), pagePrefix: g.prefix,
        templatePage: g.items.get(slugs[0]),
        titleFieldId: titleField ? titleField.id : null, slugFieldId: 'slug',
        fields: [{ id: 'slug', title: 'Slug', type: 'String' }, ...kept.map(f => ({ id: f.id, title: f.title, type: f.type, kind: f.kind }))],
        itemPages, extraPages, listPages: [], items,
      };
      collections.push(col);
      listSpots.forEach(s => pendingLists.push({ col, path: s.path }));
    }

    // Text that is always the name of an item in another collection is a
    // reference ("Category: Travel") — edited by picking that item.
    const detectRefs = (cols, among) => {
      for (const c of cols) {
        for (const f of c.fields) {
          if (f.kind !== 'text' || f.id === c.titleFieldId) continue;
          const vals = c.items.map(i => i.data[f.id]).filter(v => v && v.v);
          if (vals.length < 1) continue;
          for (const o of among) {
            if (o === c || !o.titleFieldId) continue;
            const byName = new Map(o.items.map(i => [i.data[o.titleFieldId] && i.data[o.titleFieldId].v, i.data.id.v]));
            if (!vals.every(v => byName.has(v.v))) continue;
            f.type = 'CollectionReference'; f.kind = 'ref'; f.ref = o.id;
            if (/absolute|text|^name|link|title/i.test(f.title)) f.title = o.singular;
            c.items.forEach(i => { const v = i.data[f.id]; i.data[f.id] = v && v.v ? { t: 'string', v: byName.get(v.v) } : { t: 'null', v: null }; });
            break;
          }
        }
      }
    };
    detectRefs(collections, collections);

    const byPage = new Map();
    collections.forEach(c => Object.entries(c.itemPages).forEach(([id, pg]) => byPage.set(pg, { c, id })));
    const cardsOf = list => Array.from(list.querySelectorAll('.w-dyn-item')).filter(li => li.parentElement && li.parentElement.closest('.w-dyn-list') === list);
    // Item names → items (cards that show a name but don't link: href="#")
    const byName = new Map();
    collections.forEach(c => c.titleFieldId && c.items.forEach(i => {
      const t = i.data[c.titleFieldId] && i.data[c.titleFieldId].v;
      if (t) { if (!byName.has(t)) byName.set(t, []); byName.get(t).push({ c, id: i.data.id.v }); }
    }));
    const namedItem = (li, wantCol) => {
      const texts = Array.from(li.querySelectorAll('*')).concat([li]).filter(el => el.closest('.w-dyn-item') === li && isLeafText(el)).map(el => norm(el.textContent)).filter(Boolean);
      for (const t of texts) {
        const hits = (byName.get(t) || []).filter(h => !wantCol || h.c === wantCol);
        if (hits.length === 1) return hits[0];
      }
      return null;
    };
    const linkedItem = (li, pageDir, wantCol) => {
      const links = Array.from(li.querySelectorAll('a[href]')).filter(a => a.closest('.w-dyn-item') === li).concat(tag(li) === 'A' ? [li] : []);
      for (const a of links) {
        const hit = byPage.get(linkKey(pageDir, a.getAttribute('href')));
        if (hit && (!wantCol || hit.c === wantCol)) return hit;
      }
      return namedItem(li, wantCol);
    };

    // 2. Nested lists on item pages that list items of ANOTHER collection and
    //    differ per item = multi-reference fields (a post's Tags)
    const cands = [];
    for (const { col, path } of pendingLists) {
      const per = col.items.map(it => {
        const pg = col.itemPages[it.data.id.v];
        const el = atPath(docOf(pg).body, path);
        if (!el) return null;
        const hits = cardsOf(el).map(li => linkedItem(li, pg));
        return { it, el, pg, hits };
      });
      const valid = per.filter(Boolean);
      // The collection most cards belong to; then match ambiguous names
      // ("Travel" is a tag and a category) inside that collection only
      const tally = new Map();
      valid.flatMap(p => p.hits).filter(Boolean).forEach(h => tally.set(h.c, (tally.get(h.c) || 0) + 1));
      if (!tally.size) continue;
      const target = [...tally].sort((a, b) => b[1] - a[1])[0][0];
      valid.forEach(p => { p.hits = cardsOf(p.el).map(li => linkedItem(li, p.pg, target)); });
      const allHits = valid.flatMap(p => p.hits);
      if (!allHits.length || allHits.some(h => !h)) continue;
      if (target === col || allHits.some(h => h.c !== target)) continue;
      const sets = valid.map(p => p.hits.map(h => h.id).sort().join('|'));
      // Same list on every page: a field only if it is a subset (a post's 5
      // tags), not every item of that collection (an "all tags" sidebar)
      if (new Set(sets).size < 2 && (!valid[0].hits.length || new Set(valid[0].hits.map(h => h.id)).size >= target.items.length)) continue;
      // size of a card: a reference list shows tiny cards (a tag name), a
      // list of items pointing back shows full cards (image, title, excerpt)
      const cards = valid.flatMap(p => cardsOf(p.el));
      const cardSize = cards.reduce((k, c) => k + c.querySelectorAll('*').length, 0) / Math.max(1, cards.length);
      cands.push({ col, path, per, valid, target, sets, cardSize });
    }
    // A Category page listing its posts is the posts' field seen backwards:
    // keep the side that holds the reference (fewer cards per page)
    const keep = cands.filter(a => {
      if (a.target.fields.some(f => f.ref === a.col.id && f.kind === 'ref')) return false;
      const back = cands.filter(b => b.col === a.target && b.target === a.col);
      if (!back.length) return a.cardSize <= 6;   // full item cards = a "related" list, not a field
      return a.cardSize < Math.min(...back.map(b => b.cardSize));
    });
    for (const cand of keep) {
      const { col, path, per, valid, target, sets } = cand;
      // the same list shown twice on the page is one field
      // one multi-reference per target: the same list shown again (header + sidebar) is that field
      const twin = col.fields.find(f => f.kind === 'multiref' && f.ref === target.id);
      if (twin && twin._sets !== sets.join('/')) continue;
      col._m = (col._m || 0) + 1;
      const id = twin ? twin.id : `m${col._m}`;
      if (twin) { per.forEach(p => p && p.el.setAttribute('data-wfx-f', id)); continue; }
      const first = valid.find(p => p.hits.length);
      const firstCard = cardsOf(first.el)[0];
      col.fields.push({ id, title: target.name, type: 'MultiCollectionReference', kind: 'multiref', ref: target.id,
        _card: firstCard, cardDir: first.pg, boxClass: cls(firstCard.parentElement), _sets: sets.join('/') });
      for (const p of per) {
        if (!p) { continue; }
        p.it.data[id] = { t: 'array', v: p.hits.map(h => ({ t: 'string', v: h.id })) };
        p.el.setAttribute('data-wfx-f', id);
        for (const ek of col.extraPages[p.it.data.id.v] || []) { const ee = atPath(docOf(ek).body, path); if (ee) ee.setAttribute('data-wfx-f', id); }
      }
      col.items.forEach(it => { if (!it.data[id]) it.data[id] = { t: 'array', v: [] }; });
    }

    // 3. Collection lists on every page: which item is each .w-dyn-item?
    function refName(f, id) {
      const o = collections.find(x => x.id === f.ref);
      const it = o && o.items.find(i => i.data.id.v === id);
      const v = it && o.titleFieldId && it.data[o.titleFieldId];
      return v && v.v ? v : null;
    }
    function markCard(li, col, id, pageDir, dry) {
      const item = col.items.find(i => i.data.id.v === id);
      let score = 0;
      const els = Array.from(li.querySelectorAll('*')).filter(el => el.closest('.w-dyn-item') === li);
      for (const f of col.fields) {
        if (!f.kind) continue;
        let val = item.data[f.id];
        if (!val || val.v == null || val.v === '') continue;
        if (f.kind === 'multiref') {
          const want = val.v.map(x => x.v).sort().join('|');
          for (const l of Array.from(li.querySelectorAll('.w-dyn-list')).filter(l => l.parentElement && l.parentElement.closest('.w-dyn-item') === li)) {
            const hits = cardsOf(l).map(c => linkedItem(c, pageDir));
            if (!hits.length || hits.some(h => !h || h.c.id !== f.ref)) continue;
            if (hits.map(h => h.id).sort().join('|') !== want) continue;
            score++;
            if (!dry && !l.getAttribute('data-wfx-f')) l.setAttribute('data-wfx-f', f.id);
          }
          continue;
        }
        if (f.kind === 'ref') val = refName(f, val.v);
        if (!val) continue;
        for (const el of els) {
          let ok = false;
          if ((f.kind === 'text' || f.kind === 'ref') && isLeafText(el)) ok = norm(el.textContent) === val.v;
          else if (f.kind === 'image' && tag(el) === 'IMG') ok = stem(el.getAttribute('src')) === stem(val.v.src);
          else if ((f.kind === 'image' || f.kind === 'bg') && bgOf(el)) ok = stem(bgOf(el)) === stem(val.v.src);
          else if (f.kind === 'richtext' && hasCls(el, 'w-richtext')) ok = norm(el.innerHTML) === norm(val.v);
          if (!ok) continue;
          score++;
          if (!dry && !el.getAttribute('data-wfx-f')) el.setAttribute('data-wfx-f', f.id);
        }
      }
      return score;
    }
    let listed = 0;
    const listKeys = pageKeys.filter(k => !foreign.has(k));
    for (const key of listKeys) {
      const d = docOf(key);
      if (!d) continue;
      for (const li of Array.from(d.querySelectorAll('.w-dyn-item'))) {
        // The item this card shows: the linked item page whose values appear in it most
        let best = null, bestScore = -1;
        const links = Array.from(li.querySelectorAll('a[href]')).filter(a => a.closest('.w-dyn-item') === li).concat(tag(li) === 'A' ? [li] : []);
        const seen = new Set();
        for (const a of links) {
          const hit = byPage.get(linkKey(key, a.getAttribute('href')));
          if (!hit || seen.has(hit.c.id + '/' + hit.id)) continue;
          seen.add(hit.c.id + '/' + hit.id);
          const score = markCard(li, hit.c, hit.id, key, true);
          if (score > bestScore) { best = hit; bestScore = score; }
        }
        if (!best && !links.some(a => byPage.has(linkKey(key, a.getAttribute('href'))))) {
          best = namedItem(li);
          // "Mobile" is a tag and a work category: decide by the cards next to it
          if (!best) {
            const sibs = kids(li.parentElement).filter(x => x !== li && hasCls(x, 'w-dyn-item'));
            const tally = new Map();
            sibs.forEach(x => { const h = linkedItem(x, key); if (h) tally.set(h.c, (tally.get(h.c) || 0) + 1); });
            const main = [...tally].sort((a, b) => b[1] - a[1])[0];
            if (main) best = namedItem(li, main[0]);
          }
        }
        if (!best) continue;
        li.setAttribute('data-wfx-i', `${best.c.id}/${best.id}`);
        if (!best.c.listPages.includes(key)) best.c.listPages.push(key);
        markCard(li, best.c, best.id, key, false);
        listed++;
      }
    }

    // 4. Lists whose cards have no page of their own (testimonials, team,
    //    logos…): the cards of one list design are one collection
    const listOnly = [];
    const groupsL = new Map();
    for (const key of listKeys) {
      const d = docOf(key);
      for (const box of Array.from(d.querySelectorAll('.w-dyn-items'))) {
        if (box.parentElement && box.parentElement.closest('.w-dyn-item')) continue;  // nested
        const cards = kids(box).filter(li => hasCls(li, 'w-dyn-item'));
        if (!cards.length || cards.some(li => li.getAttribute('data-wfx-i'))) continue;
        const k = sig(box) + '>' + sig(cards[0]) + '>' + kids(cards[0]).map(sig).join(',');
        if (!groupsL.has(k)) groupsL.set(k, { boxes: [], cards: [] });
        const gl = groupsL.get(k);
        gl.boxes.push({ key, box });
        cards.forEach(li => gl.cards.push({ key, li }));
      }
    }
    let n = 0;
    const usedNames = new Set(collections.map(c => c.name.toLowerCase()));
    for (const [, gl] of groupsL) {
      const sampleCards = gl.cards.slice(0, MAX_COMPARE).map(c => c.li);
      let spots = sampleCards.length > 1 ? findFields(sampleCards) : guessFields(sampleCards[0], { card: true });
      spots = spots.filter(s => s.kind !== 'list');
      if (!spots.some(s => s.kind === 'text' || s.kind === 'richtext')) continue;
      if (sampleCards.length < 2 && spots.length < 2) continue;   // one card, one text: not enough to tell
      const colId = `list-${++n}`;
      const pre = spots.map((s, i) => ({ id: `c${i + 1}`, kind: s.kind, path: s.path }));
      const rows = readRows(pre, gl.cards.map(c => ({ key: c.key, dir: c.key, li: c.li, start: c.li })));
      const { fields, kept, alias } = buildFields(spots, sampleCards, rows, null, 'c');
      const textFields = kept.filter(f => f.kind === 'text');
      const titleField = textFields.find(f => /name|title|heading/i.test(f.title)) ||
        textFields.find(f => /^H[1-6]$/.test(tag(atPath(sampleCards[0], f.path)))) || textFields[0] || null;
      if (titleField && /^(?:text|name)$/i.test(titleField.title)) titleField.title = 'Name';
      // The same card on several pages is one item
      const items = [], byId = new Map();
      for (const r of rows) {
        const data = {};
        kept.forEach(f => { data[f.id] = r.vals[f.id]; });
        const sigv = JSON.stringify(data);
        let base = slugify(titleField && data[titleField.id] && data[titleField.id].v) || 'item';
        let id = base, k = 2;
        while (byId.has(id) && byId.get(id).sig !== sigv) id = `${base}-${k++}`;
        if (!byId.has(id)) { byId.set(id, { sig: sigv }); items.push({ data: { id: { t: 'string', v: id }, ...data } }); }
        r.li.setAttribute('data-wfx-i', `${colId}/${id}`);
        for (const f of fields) {
          const el = r.els[f.id];
          if (el) el.setAttribute('data-wfx-f', alias[f.id] || f.id);
        }
      }
      // Name from the list's own class: "testimonials-grid w-dyn-items" → "Testimonials"
      const box = gl.boxes[0].box;
      const wrap = box.parentElement && hasCls(box.parentElement, 'w-dyn-list') ? box.parentElement : box;
      const firstField = kept[0] && atPath(gl.cards[0].li, kept[0].path);
      const cleanCls = c => c.replace(/[-_](?:grid|list|wrapper|wrap|collection|items?|cms|row|slider|container|layout|card|name|title|heading|text|img|image|photo|avatar)$/i, '').replace(/[-_]v?\d+$/i, '').replace(/[-_](?:grid|list|wrapper|wrap|card|item)$/i, '');
      const cn = [cls(box), cls(wrap), cls(gl.cards[0].li), cls(kids(gl.cards[0].li)[0]), cls(firstField)].join(' ').split(/\s+/)
        .map(c => c && !/^(?:w-|collection-|is-|_|text-|heading|display|div-block)/i.test(c) ? cleanCls(c) : '')
        .find(c => c && c.length > 2 && !/^(?:list|lists|items?|grid|wrapper|wrap|row|col|cms|card|block|container|content|inner)$/i.test(c));
      let name = cn ? humanize(cn) : 'List';
      name = plural(name);
      let nm = name, j = 2;
      while (usedNames.has(nm.toLowerCase())) nm = `${name} ${j++}`;
      usedNames.add(nm.toLowerCase());
      const col = {
        id: colId, name: nm, singular: singular(nm), pagePrefix: null, listOnly: true,
        titleFieldId: titleField ? titleField.id : null, slugFieldId: null,
        fields: kept.map(f => ({ id: f.id, title: f.title, type: f.type, kind: f.kind })),
        itemPages: {}, extraPages: {}, listPages: [...new Set(gl.boxes.map(b => b.key))], items,
      };
      listOnly.push(col);
      listed += gl.cards.length;
    }
    detectRefs(listOnly, collections.concat(listOnly));
    collections.push(...listOnly);
    collections.forEach(c => { delete c._m; c.fields.forEach(f => { delete f._sets; }); });
    // card templates for multi-reference lists, taken after the cards were marked
    collections.forEach(c => c.fields.forEach(f => { if (f._card) { f.cardHtml = f._card.outerHTML; delete f._card; } }));
    if (!collections.length) return null;

    // 5. Item order = Webflow's own sort order, read from the longest list of
    //    each collection (pagination pages continue it: articles/x/page-2)
    for (const c of collections) {
      let best = [];
      for (const key of c.listPages) {
        const d = docOf(key);
        const boxes = new Set(Array.from(d.querySelectorAll(`[data-wfx-i^="${c.id}/"]`)).map(li => li.parentNode));
        for (const box of boxes) {
          const ids = kids(box).map(li => li.getAttribute('data-wfx-i') || '').filter(v => v.startsWith(c.id + '/')).map(v => v.slice(c.id.length + 1));
          if (ids.length <= best.length && !pageKeys.includes((key ? key + '/' : '') + 'page-2')) continue;
          let all = [...new Set(ids)], pn = 2;
          const base = key.replace(/(?:^|\/)page-\d+$/, '');
          for (;;) {
            const nk = (base ? base + '/' : '') + 'page-' + pn;
            const nd = pageKeys.includes(nk) && docOf(nk);
            if (!nd) break;
            const more = Array.from(nd.querySelectorAll(`[data-wfx-i^="${c.id}/"]`)).map(li => li.getAttribute('data-wfx-i').slice(c.id.length + 1));
            if (!more.length) break;
            all = all.concat(more.filter(x => !all.includes(x)));
            pn++;
          }
          if (all.length > best.length) best = all;
        }
      }
      if (best.length > 1) {
        const pos = new Map(best.map((id, i) => [id, i]));
        c.items.sort((a, b) => (pos.has(a.data.id.v) ? pos.get(a.data.id.v) : 1e6) - (pos.has(b.data.id.v) ? pos.get(b.data.id.v) : 1e6));
      }
    }

    // 6. Paginated lists: remember page size + pages so the editor can reflow
    //    them when items are added or removed
    for (const c of collections) {
      c.paginated = [];
      for (const key of c.listPages) {
        if (/(?:^|\/)page-\d+$/.test(key) || !pageKeys.includes((key ? key + '/' : '') + 'page-2')) continue;
        const pagesIn = [key];
        for (let pn = 2; pageKeys.includes((key ? key + '/' : '') + 'page-' + pn); pn++) pagesIn.push((key ? key + '/' : '') + 'page-' + pn);
        const firstBox = docOf(key).querySelector(`[data-wfx-i^="${c.id}/"]`);
        if (!firstBox) continue;
        const size = kids(firstBox.parentNode).filter(li => (li.getAttribute('data-wfx-i') || '').startsWith(c.id + '/')).length;
        if (size) c.paginated.push({ pages: pagesIn, size });
      }
    }

    // 7. Serialize the pages we touched
    const out = new Map();
    for (const [key, d] of docs) {
      if (!d) continue;
      if (!d.querySelector('[data-wfx-f],[data-wfx-i]')) continue;
      out.set(key, serialize(d));
    }
    const manifest = {
      generator: 'Webflow Extractor', format: 'webflow-static', version: 2,
      siteName: opts && opts.siteName || '', sourceUrl: opts && opts.sourceUrl || '',
      exportedAt: new Date().toISOString(), liveUrl: '', imageMap: {},
      pages: pageKeys,
      collections,
    };
    return { pages: out, manifest, stats: { collections: collections.length, items: collections.reduce((k, c) => k + c.items.length, 0), listed } };
  }

  function serialize(doc) {
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }

  // CSV / JSON copies of the content (for spreadsheets, other CMSs)
  function dataFiles(manifest) {
    const files = [];
    const titleOf = (cid, id) => {
      const o = manifest.collections.find(c => c.id === cid);
      const it = o && o.items.find(i => i.data.id.v === id);
      return it && o.titleFieldId && it.data[o.titleFieldId] ? String(it.data[o.titleFieldId].v || id) : id;
    };
    const plain = (f, v) => {
      if (!v || v.v == null) return '';
      if (v.t === 'image') return v.v.src || '';
      if (f.kind === 'ref') return titleOf(f.ref, v.v);
      if (v.t === 'array') return v.v.map(x => f.ref ? titleOf(f.ref, x.v) : x.v).join('; ');
      return String(v.v);
    };
    const csvCell = s => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    for (const c of manifest.collections) {
      const fields = c.fields;
      const rows = c.items.map(it => Object.fromEntries(fields.map(f => [f.title, plain(f, it.data[f.id])])));
      const file = slugify(c.name) || c.id;
      files.push([`cms/data/${file}.json`, JSON.stringify(rows, null, 2)]);
      files.push([`cms/data/${file}.csv`, [fields.map(f => csvCell(f.title)).join(','), ...rows.map(r => fields.map(f => csvCell(r[f.title])).join(','))].join('\n') + '\n']);
    }
    return files;
  }

  const api = { annotate, dataFiles, findFields, resolvePath, linkKey, stem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WFXCMS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { useToast } from '@astryxdesign/core/Toast';
import { VStack } from '@astryxdesign/core/Stack';
import {
  loadSite, buildChanges, commitState, createItem, duplicateItem, itemSlug, itemTitle, itemImageSrc, isDirty, clearCache, rebaseEdits, setPublishedOverlay, publishedOverlay, ROOT, slugify, resolveImage, readText, pageFile,
} from './core/site.js';
import { richTextToPlain } from './core/richtext.js';
import logoUrl from './logo.png';
import { detectServer, getToken, logout, publish, sendDrafts, initPreviewWorker, autoTarget, prepareFolder, hasFolder, contentType } from './core/publish.js';
import { toCSV, toJSON } from './core/exporters.js';
import { idbGet, idbSet, idbDel } from './core/storage.js';
import { NavTabs, ContentTree } from './components/Sidebar.jsx';
import { ItemEditor } from './components/ItemEditor.jsx';
import { Preview } from './components/Preview.jsx';
import { Integrations } from './components/Integrations.jsx';
import { Settings } from './components/Settings.jsx';
import { Login } from './components/Login.jsx';
import { Setup } from './components/Setup.jsx';
import { IconExternal, IconChevronDown, IconSettings, IconTrash, IconLogout, IconCheck, IconSun, IconMoon } from './icons.jsx';
import { IconButton } from '@astryxdesign/core/IconButton';
import { AppMenu } from './components/AppMenu.jsx';
import { ConfirmDialog } from './components/ConfirmDialog.jsx';
import { useThemeMode } from './themeMode.js';
import { ChangesBar } from './components/ChangesBar.jsx';
import { Resizer, usePanelWidth } from './components/Resizer.jsx';

// What to look for in the preview to show where an item / field appears
function fieldTarget(col, item, field, uploadsMap) {
  const v = item.data[field.id];
  if (!v || v.v == null || v.v === '') return null;
  if (v.t === 'string' || v.t === 'enum') return { text: String(v.v), label: field.title };
  if (v.t === 'richtext') { const t = richTextToPlain(v.v).slice(0, 80); return t ? { text: t, label: field.title } : null; }
  if (v.t === 'image') { const src = typeof v.v === 'string' ? v.v : v.v.src; return src ? { img: src, label: field.title } : null; }
  if (v.t === 'number' || v.t === 'date') return null;
  return null;
}

// Pages where an item without its own page appears (e.g. a Category):
// 1) items in other collections that reference it, 2) any page containing its text
function usagesOf(st, c, it) {
  const id = it.data.id?.v, out = [];
  for (const oc of st.collections) {
    const refFields = oc.fields.filter(f => f.ref === c.id);
    if (!refFields.length) continue;
    for (const oi of oc.items) {
      if (!oi.page || oi.status === 'deleted') continue;
      const uses = refFields.some(f => { const v = oi.data[f.id]; return v && (v.v === id || (v.t === 'array' && v.v.some(x => x.v === id))); });
      if (uses) out.push({ page: oi.page, label: itemTitle(oc, oi) });
    }
  }
  return out;
}
// Search only text a visitor sees (not scripts/embedded data/meta tags)
async function pageWithText(pages, text) {
  const want = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (want.length < 2) return null;
  const esc = want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`>[^<]*${esc}[^<]*<`);
  for (const p of pages) {
    try {
      const html = (await readText(pageFile(p), { cache: true }))
        .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<head[\s\S]*?<\/head>/i, '');
      if (re.test(html)) return p;
    } catch {}
  }
  return null;
}

// "László Gaál // Portfolio" → "László Gaál" (page titles often append a section)
const cleanSiteName = t => (String(t || 'Site').split(/\s+(?:\/\/|\||–|—|-|·|:)\s+/)[0] || 'Site').trim();

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const draftKey = m => `drafts:${m.sourceUrl || 'site'}`;
const pubKey = m => `published:${m.sourceUrl || 'site'}`;
const baseOf = m => m.updatedAt || m.exportedAt || '';

export default function App() {
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const [sysDark, setSysDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const isDark = themeMode === 'dark' || (themeMode === 'system' && sysDark);
  const toast = useToast();
  const [boot, setBoot] = useState({ phase: 'loading' });
  const [server, setServer] = useState(null);
  const [state, setState] = useState(null);
  const [uploads, setUploads] = useState(() => new Map());
  const [overlayVer, setOverlayVer] = useState(0); // bumps when published files change
  const [view, setView] = useState('content');
  const [sel, setSel] = useState(null);
  const [previewPath, setPreviewPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [deployNote, setDeployNote] = useState('');
  const [previewNote, setPreviewNote] = useState(null);
  const [usage, setUsage] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [pubStatus, setPubStatus] = useState(null);
  const previewApi = useRef(null);
  const [leftW, setLeftW] = usePanelWidth('fx-left-width', 264, 208, 420);
  const [rightW, setRightW] = usePanelWidth('fx-right-width', 320, 280, 560);
  const notify = useCallback((body, type = 'info') => { try { toast({ body, type }); } catch { console.log(body); } }, [toast]);

  // ── Boot: server capabilities → login → load CMS → restore drafts ─────────
  const start = useCallback(async () => {
    setBoot({ phase: 'loading' });
    const srv = await detectServer();
    setServer(srv);
    if (srv.available && srv.configured && !getToken()) { setBoot({ phase: 'login' }); return; }
    // Live site that can't save yet (no password, or a files-only host): show
    // how to turn editing on, instead of an editor that silently can't publish
    let skip = false;
    try { skip = sessionStorage.getItem('fx-setup-skip') === '1'; } catch {}
    if (!srv.local && !(srv.available && srv.configured) && !skip) { setBoot({ phase: 'setup' }); return; }
    try {
      let s = await loadSite();
      const pub = await idbGet(pubKey(s.manifest));
      // Only bridge the short gap until the live site serves the publish (Blob:
      // seconds, GitHub deploy: a minute or two) — never hide newer live content
      const bridge = srv.adapters?.blob ? 2 * 60e3 : 6 * 60e3;
      const liveIsNewer = !!(pub && baseOf(s.manifest) && pub.updatedAt && baseOf(s.manifest) > pub.updatedAt);
      if (pub && pub.updatedAt !== baseOf(s.manifest) && !liveIsNewer && Date.now() - pub.at < bridge && (pub.state?.manifest?.exportedAt || '') === (s.manifest.exportedAt || '')) {
        // The live site hasn't caught up with the last publish yet (GitHub deploy,
        // Vercel Blob cache) — work from what was published, not the old files
        s = pub.state;
        setPublishedOverlay(pub.files);
        setOverlayVer(v => v + 1);
        setDeployNote('Your last publish is still going live on your site. The preview already shows it.');
      } else {
        setPublishedOverlay(null);
        if (pub) idbDel(pubKey(s.manifest));
      }
      const saved = await idbGet(draftKey(s.manifest));
      let restored = false;
      if (saved && saved.base === baseOf(s.manifest)) {
        s = {
          manifest: { ...s.manifest, liveUrl: saved.liveUrl ?? s.manifest.liveUrl },
          collections: s.collections.map(c => {
            const sc = saved.collections.find(x => x.id === c.id);
            return sc ? { ...c, items: sc.items } : c;
          }),
        };
        if (saved.uploads?.length) setUploads(new Map(saved.uploads));
        restored = s.collections.some(isDirty);
      }
      setState(s);
      const first = s.collections[0]?.items[0];
      if (first) {
        setSel({ colId: s.collections[0].id, key: first.key });
        if (first.page) setPreviewPath(first.page);
      }
      setBoot({ phase: 'ready' });
      initPreviewWorker();
      if (restored) notify('Restored your unpublished changes from last time.');
    } catch (e) {
      setBoot({ phase: 'error', error: e.message });
    }
  }, [notify]);
  useEffect(() => { start(); }, [start]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const col = state?.collections.find(c => c.id === sel?.colId);
  const item = col?.items.find(i => i.key === sel?.key);
  const dirtyItems = useMemo(() => (state ? state.collections.flatMap(c => c.items.filter(i => i.status !== 'clean')) : []), [state]);
  const liveUrlChanged = state && state.manifest.liveUrl !== state.manifest._liveUrlSaved;
  const hasChanges = dirtyItems.length > 0 || uploads.size > 0;
  // What the user changed: items. An uploaded image is part of its item's change.
  const changeCount = dirtyItems.length || uploads.size;
  // Forget uploads no item uses anymore (replaced again, reverted, discarded)
  useEffect(() => {
    if (!state || !uploads.size) return;
    const used = JSON.stringify(state.collections.map(c => c.items.map(i => i.data)));
    const keep = [...uploads].filter(([p]) => used.includes(p));
    if (keep.length !== uploads.size) setUploads(new Map(keep));
  }, [state, uploads]);

  // ── Persist drafts locally (survive refresh / closing the tab) ────────────
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => {
      idbSet(draftKey(state.manifest), {
        base: baseOf(state.manifest), liveUrl: state.manifest.liveUrl,
        collections: state.collections.map(c => ({ id: c.id, items: c.items })),
        uploads: [...uploads],
      }).then(() => setSavedAt(Date.now()));
    }, 400);
    return () => clearTimeout(t);
  }, [state, uploads]);

  // ── Live preview: rebuild drafts and reload the iframe ───────────────────
  const lastDraftSig = useRef('');
  const draftGen = useRef(0);
  useEffect(() => {
    if (!state) return;
    const sig = JSON.stringify(dirtyItems.map(i => [i.key, i.status, i.data])) + [...uploads.keys()].join();
    if (sig === lastDraftSig.current) return;
    const t = setTimeout(async () => {
      lastDraftSig.current = sig;
      // Several edits in a row start several rebuilds; an older, slower one
      // must never finish last and put back an outdated preview
      const gen = ++draftGen.current;
      setBusy(true);
      try {
        const changes = hasChanges ? await buildChanges(state, uploads, { cache: true }) : new Map();
        if (gen !== draftGen.current) return;
        changes.delete('cms/fx-site.json');
        await sendDrafts(new Map([...publishedOverlay(), ...changes]));
        // If the selected item's address changed (slug edit), follow it to the
        // new address instead of reloading the old one (which no longer exists)
        const api = previewApi.current;
        const c = state.collections.find(x => x.id === selRef.current?.colId);
        const it = c?.items.find(i => i.key === selRef.current?.key);
        const want = it && c.pagePrefix && it.status !== 'deleted' && (it.page || it.status === 'new') ? `${c.pagePrefix}/${itemSlug(c, it)}` : null;
        if (api && want && api.current() !== want && (api.current() === it.page || it.status === 'new' && api.current().startsWith(c.pagePrefix + '/'))) {
          api.open(want, { text: itemTitle(c, it) }); setPreviewPath(want);
        } else setReloadKey(k => k + 1);
      } catch (e) { console.warn('[admin] preview build failed', e); }
      finally { if (gen === draftGen.current) setBusy(false); }
    }, 900);
    return () => clearTimeout(t);
  }, [state, uploads, dirtyItems, hasChanges]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateItem = useCallback((colId, key, fn) => {
    setState(s => ({
      ...s,
      collections: s.collections.map(c => (c.id !== colId ? c : { ...c, items: c.items.map(i => (i.key !== key ? i : fn(i, c))) })),
    }));
  }, []);
  const stateRef = useRef(null);
  stateRef.current = state;
  const selRef = useRef(null);
  selRef.current = sel;
  const statusAfterEdit = (i, data) => (i.status === 'new' ? 'new' : same(data, i.orig) ? 'clean' : 'edited');

  const actions = useMemo(() => ({
    setField: (colId, key, fieldId, v) => {
      // Real-time: change the visible page immediately; the rebuilt page is
      // swapped in smoothly once ready.
      const c = stateRef.current?.collections.find(x => x.id === colId);
      const old = c?.items.find(i => i.key === key)?.data[fieldId];
      if (old && v) {
        if (old.t === 'string' && v.t === 'string') previewApi.current?.patch({ oldText: old.v, newText: v.v });
        if (old.t === 'image' && v.t === 'image') {
          const oldSrc = typeof old.v === 'string' ? old.v : old.v?.src;
          const newSrc = typeof v.v === 'string' ? v.v : v.v?.src;
          const blob = ctxRef.current?.previewUrl(newSrc);
          // The page shows the exported copy (renamed), so match on that file
          const shown = ctxRef.current?.previewUrl(oldSrc) || resolveImage(oldSrc, stateRef.current?.manifest.imageMap);
          if (blob) previewApi.current?.patch({ oldImg: shown || oldSrc, newImg: blob, mark: `${key}/${fieldId}` });
        }
      }
      updateItem(colId, key, i => {
        const data = { ...i.data, [fieldId]: v };
        return { ...i, data, status: i.status === 'deleted' ? 'deleted' : statusAfterEdit(i, data) };
      });
    },
    revert: (colId, key) => updateItem(colId, key, i => ({ ...i, data: structuredClone(i.orig), status: 'clean' })),
    remove: (colId, key) => setState(s => ({
      ...s,
      collections: s.collections.map(c => (c.id !== colId ? c : {
        ...c, items: c.items.flatMap(i => (i.key !== key ? [i] : i.status === 'new' ? [] : [{ ...i, status: 'deleted' }])),
      })),
    })),
    restore: (colId, key) => updateItem(colId, key, i => ({ ...i, status: same(i.data, i.orig) ? 'clean' : 'edited' })),
    duplicate: (colId, key) => {
      let created;
      setState(s => ({
        ...s,
        collections: s.collections.map(c => {
          if (c.id !== colId) return c;
          const idx = c.items.findIndex(i => i.key === key);
          created = duplicateItem(c, c.items[idx]);
          const items = [...c.items];
          items.splice(idx + 1, 0, created);
          return { ...c, items };
        }),
      }));
      setTimeout(() => created && setSel({ colId, key: created.key }), 0);
    },
    move: (colId, key, dir) => setState(s => ({
      ...s,
      collections: s.collections.map(c => {
        if (c.id !== colId) return c;
        const items = [...c.items];
        const i = items.findIndex(x => x.key === key), j = i + dir;
        if (j < 0 || j >= items.length) return c;
        [items[i], items[j]] = [items[j], items[i]];
        // Order changed: mark both as edited so the new order is published
        const mark = x => (x.status === 'clean' ? { ...x, status: 'edited' } : x);
        items[i] = mark(items[i]); items[j] = mark(items[j]);
        return { ...c, items };
      }),
    })),
    showPage: page => { setView('content'); setPreviewPath(page); },
    focusField: (colId, key, fieldId) => {
      const c = stateRef.current?.collections.find(x => x.id === colId);
      const it = c?.items.find(i => i.key === key);
      const f = c?.fields.find(x => x.id === fieldId);
      if (!c || !it || !f) return;
      const t = fieldTarget(c, it, f);
      if (t) previewApi.current?.highlight(t);
    },
  }), [updateItem]);

  const addItem = useCallback(colId => {
    let created;
    setState(s => ({
      ...s,
      collections: s.collections.map(c => {
        if (c.id !== colId) return c;
        created = createItem(c, `New ${c.name.replace(/s$/i, '')}`);
        return { ...c, items: [created, ...c.items] };
      }),
    }));
    setView('content');
    setTimeout(() => created && setSel({ colId, key: created.key }), 0);
  }, []);

  // Selecting a layer: show it in the preview, like selecting a layer in Framer.
  //  • visible on the current page → scroll to it and outline it
  //  • has its own page → open it, then outline its title
  //  • no page of its own (e.g. Categories) → open a page that uses it
  const select = useCallback(async (s, { open = false } = {}) => {
    setSel(s);
    setView('content');
    setPreviewNote(null);
    setUsage(null);
    const st = stateRef.current;
    const c = st?.collections.find(x => x.id === s.colId);
    const it = c?.items.find(i => i.key === s.key);
    const api = previewApi.current;
    if (!c || !it || !api) return;
    if (it.status === 'deleted') { api.clear(); return; }
    const page = it.page || (it.status === 'new' && c.pagePrefix ? `${c.pagePrefix}/${itemSlug(c, it)}` : null);
    const title = itemTitle(c, it);
    const named = { text: title, label: title };
    if (page) {
      if (api.current() === page) { api.highlight(named); return; }
      // On a listing page (home, /work…) outline the item's card in place.
      // On another item's page, always open this item's own page (a small
      // "next project" link there isn't what the user wants to see).
      const cur = api.current();
      const onItemPage = st.collections.some(x => Object.values(x.itemPages || {}).includes(cur) ||
        Object.values(x.extraPages || {}).flat().includes(cur));
      if (!open && !onItemPage && api.find({ href: page })) { api.highlight({ href: page, label: title }); return; }
      api.open(page, named); setPreviewPath(page);
      return;
    }
    const uses = usagesOf(st, c, it);
    setUsage({ key: it.key, pages: uses });
    if (api.find(named)) { api.highlight(named); return; }
    // Prefer a page that actually shows it (not every page that references it does)
    const first = await pageWithText(uses.map(u => u.page), title)
      || await pageWithText(st.manifest.pages, title)
      || uses[0]?.page;
    if (first) setUsage({ key: it.key, pages: [...uses].sort((x, y) => (y.page === first) - (x.page === first)) });
    if (first) { api.open(first, named); setPreviewPath(first); }
    else { api.clear(); setPreviewNote({ text: `“${title}” isn't shown on any page yet` }); }
  }, []);

  // Clicking around inside the preview selects the matching item
  const onNavigate = useCallback(rel => {
    if (!state) return;
    for (const c of state.collections) {
      const it = c.items.find(i => i.page === rel || (c.pagePrefix && `${c.pagePrefix}/${itemSlug(c, i)}` === rel));
      if (it) { setSel({ colId: c.id, key: it.key }); return; }
    }
  }, [state]);

  const ctxRef = useRef(null);
  // Uploads are readable the instant they're added (the live preview swaps the
  // image right away), and stay visible after publishing until the live site
  // serves them (Vercel Blob / GitHub deploys take a while).
  const uploadsNow = useRef(new Map());
  uploadsNow.current = new Map([...uploadsNow.current, ...uploads]);
  const blobUrls = useRef(new Map());
  const ctx = useMemo(() => ({
    addUpload: (path, bytes) => { uploadsNow.current.set(path, bytes); setUploads(u => new Map(u).set(path, bytes)); },
    previewUrl: src => {
      if (!src) return null;
      if (blobUrls.current.has(src)) return blobUrls.current.get(src);
      const bytes = uploadsNow.current.get(src) ?? publishedOverlay().get(src);
      if (!bytes) return null;
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType(src) }));
      blobUrls.current.set(src, url);
      return url;
    },
    toast: notify,
  }), [uploads, notify, overlayVer]); // eslint-disable-line react-hooks/exhaustive-deps
  ctxRef.current = ctx;
  const resolveThumb = useCallback((url, c, it) => {
    const raw = itemImageSrc(c, it);
    return (raw && ctx.previewUrl(raw)) || url;
  }, [ctx]);

  // ── Publish ───────────────────────────────────────────────────────────────
  const doPublish = useCallback(async (target, { message, onProgress }) => {
    // Published from another tab/device meanwhile? Rebuild on top of that,
    // re-applying only this session's edits — never overwrite someone's work
    let base = state;
    if (target !== 'zip') {
      try {
        const live = await (await fetch(ROOT + 'cms/fx-site.json?t=' + Date.now(), { cache: 'no-store', headers: { 'x-fx-fresh': '1' } })).json();
        if ((live.updatedAt || '') > (state.manifest.updatedAt || state.manifest.exportedAt || '')) {
          setPublishedOverlay(null);
          clearCache();
          base = rebaseEdits(await loadSite(), state);
          setState(base);
          notify('This site was updated from another tab or device — your edits were added on top, nothing was overwritten.', 'info');
        }
      } catch (e) { console.warn('[cms] freshness check failed', e); }
    }
    const manifestForBuild = { ...base.manifest };
    delete manifestForBuild._liveUrlSaved;
    const st = { ...base, manifest: manifestForBuild };
    const changes = await buildChanges(st, uploads, {
      // Reuse pages already read for the preview (published files come from
      // the publish memory, so the copies are current) — no full re-download
      cache: true,
      extraFiles: (s, m) => {
        const files = [];
        for (const c of s.collections) {
          const base = slugify(c.name);
          files.push([`cms/data/${base}.csv`, toCSV(s, c, { rich: 'html', refs: 'slug', pageUrl: true })]);
          files.push([`cms/data/${base}.json`, toJSON(s, c)]);
        }
        return files;
      },
    });
    // Live site URL changes alone still need the manifest saved
    if (!changes.size && liveUrlChanged) changes.set('cms/fx-site.json', JSON.stringify(manifestForBuild, null, 2));
    if (!changes.size) return { nothing: true };

    draftGen.current++; // any preview rebuild still running is now outdated
    const result = await publish(target, changes, { onProgress, message, siteId: state.manifest.sourceUrl || 'site' });
    draftGen.current++;
    if (target === 'zip') return result; // user applies the files themselves → keep drafts

    const next = commitState(st, changes);
    next.manifest._liveUrlSaved = next.manifest.liveUrl;
    if (target === 'github' || target === 'blob' || target === 'hybrid') { setPublishedOverlay(new Map([...publishedOverlay(), ...changes])); setOverlayVer(v => v + 1); }
    setState(next);
    setUploads(new Map());
    await idbDel(draftKey(state.manifest));
    clearCache();
    if (target === 'github' || target === 'blob' || target === 'hybrid') {
      // Keep using the published files until the live site serves them
      const files = publishedOverlay();
      await idbSet(pubKey(next.manifest), { at: Date.now(), updatedAt: next.manifest.updatedAt, state: next, files: [...files] });
      await sendDrafts(files);
    } else {
      setPublishedOverlay(null);
      await sendDrafts(new Map());
    }
    lastDraftSig.current = '';
    setTimeout(() => setReloadKey(k => k + 1), 300);
    return { ...result, updatedAt: next.manifest.updatedAt };
  }, [state, uploads, liveUrlChanged]);

  // One click: destination is detected automatically, progress shows in the bar
  const watchLive = useCallback(async updatedAt => {
    const t0 = Date.now();
    while (Date.now() - t0 < 5 * 60e3) {
      setPubStatus(st => (st?.phase === 'working' || st?.phase === 'live-wait' || !st ? { phase: 'live-wait', text: `Published · going live… ${Math.round((Date.now() - t0) / 1000)}s` } : st));
      try {
        const m = await (await fetch(ROOT + 'cms/fx-site.json?t=' + Date.now(), { cache: 'no-store', headers: { 'x-fx-fresh': '1' } })).json();
        if ((m.updatedAt || '') >= updatedAt) {
          setPubStatus({ phase: 'done', text: `Live on your site ✓ (${Math.round((Date.now() - t0) / 1000)}s)` });
          setTimeout(() => setPubStatus(st => (st?.phase === 'done' ? null : st)), 5000);
          return;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 3000));
    }
    setPubStatus({ phase: 'done', text: 'Published — your host is still deploying it' });
    setTimeout(() => setPubStatus(st => (st?.phase === 'done' ? null : st)), 6000);
  }, []);

  const publishNow = useCallback(async ({ allowPicker = false } = {}) => {
    if (pubStatus?.phase === 'working') return;
    const target = autoTarget(server);
    // Any other local server (npx serve, Live Server…) can't save files, so the
    // browser writes into the site folder itself: picked once, then one click.
    const siteId = state?.manifest.sourceUrl || 'site';
    try {
      if (target === 'folder') {
        if (!(await hasFolder(siteId))) setPubStatus({ phase: 'working', text: 'Choose this site\'s folder once — after this, Publish saves straight to it' });
        await prepareFolder(siteId);
      }
      setPubStatus({ phase: 'working', text: 'Publishing…' });
      previewApi.current?.releaseMedia?.();
      const n = changeCount;
      // Progress may only move a running publish forward — never cover up an error
      const onProgress = p => setPubStatus(s => (s?.phase === 'working' ? { phase: 'working', text: `Publishing… ${Math.round(p * 100)}%` } : s));
      const r = await doPublish(target, { message: `Update content (${n} change${n === 1 ? '' : 's'})`, onProgress });
      // GitHub: the site rebuilds after the commit. Watch the live site and say
      // exactly when the publish is live, instead of guessing.
      if (target === 'github' && !r?.nothing && r?.updatedAt) { watchLive(r.updatedAt); return; }
      const text = r?.nothing ? 'Nothing to publish'
        : { hybrid: 'Live on your site ✓ · saved to GitHub', blob: 'Published — live on your site in a few seconds', github: 'Published — your site updates in about a minute',
            local: 'Saved to your site folder', folder: 'Saved to your site folder', zip: 'Downloaded the changed files' }[target];
      setPubStatus({ phase: 'done', text });
      setTimeout(() => setPubStatus(s => (s?.phase === 'done' ? null : s)), 3500);
    } catch (e) {
      if (e?.name === 'AbortError') { setPubStatus(null); return; } // folder picker cancelled
      const offline = /failed to fetch|load failed|networkerror|network request/i.test(e?.message || '');
      setPubStatus({ phase: 'error', text: offline
        ? (server.local ? 'Your site isn\'t running. Start it again (npm start), then click Try again.' : 'Can\'t reach your site. Check your connection, then click Try again.')
        : (e?.message || 'Something went wrong') });
    }
  }, [server, doPublish, changeCount, pubStatus]);

  // Cmd/Ctrl+S → publish
  useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (hasChanges) publishNow(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [hasChanges, publishNow]);

  // No "leave page?" prompt: every edit is auto-saved and restored next time.

  // ── Screens ───────────────────────────────────────────────────────────────
  if (boot.phase === 'loading') {
    return <div className="fx-gate"><VStack gap={3} hAlign="center"><Spinner size="lg" /><Text color="secondary">Loading your site…</Text></VStack></div>;
  }
  if (boot.phase === 'login') return <Login onDone={start} />;
  if (boot.phase === 'setup') return <Setup server={server} onContinue={() => { try { sessionStorage.setItem('fx-setup-skip', '1'); } catch {} start(); }} />;
  if (boot.phase === 'error') {
    return (
      <div className="fx-gate"><div className="fx-gate-card" style={{ maxWidth: 520 }}>
        <Banner status="error" title="The CMS couldn't load this site"
          description={location.protocol === 'file:'
            ? 'The CMS needs a web server. Double-click preview-mac.command (Mac) or preview-windows.bat (Windows) in your site folder, then open http://localhost:8080/cms/'
            : `${boot.error}. Make sure the whole exported folder was uploaded, including cms/fx-site.json.`} />
      </div></div>
    );
  }

  const summary = dirtyItems.length
    ? `${dirtyItems.filter(i => i.status === 'edited').length} edited · ${dirtyItems.filter(i => i.status === 'new').length} new · ${dirtyItems.filter(i => i.status === 'deleted').length} deleted${uploads.size ? ` · ${uploads.size} upload${uploads.size === 1 ? '' : 's'}` : ''}`
    : 'Nothing to publish';
  const modeBadge = server.host === 'local' ? <Badge variant="neutral" label="Local" /> : server.available
    ? <Badge variant="info" label={server.host === 'vercel' ? 'Live · Vercel' : server.host === 'netlify' ? 'Live · Netlify' : 'Live'} />
    : server.local ? <Badge variant="neutral" label="Local" /> : <Badge variant="warning" label="Static host" />;

  return (
    <div className="fx-app">
      <header className="fx-top">
        <AppMenu logoUrl={logoUrl} title="Webflow Extractor" subtitle="CMS" items={[
          { label: 'Publishing & hosting', icon: <IconSettings size={14} />, onSelect: () => setView('settings') },
          { label: 'View live site', icon: <IconExternal size={14} />, onSelect: () => window.open(ROOT, '_blank') },
          { divider: true },
          { label: 'Discard all changes', icon: <IconTrash size={14} />, danger: true, disabled: !hasChanges, onSelect: () => setConfirmDiscard(true) },
          ...(server.available && server.configured ? [{ label: 'Sign out', icon: <IconLogout size={14} />, onSelect: () => { logout(); start(); } }] : []),
        ]} />
        <div className="fx-crumb">
          <span className="fx-site-name" title={state.manifest.siteName}>{cleanSiteName(state.manifest.siteName)}</span>
          {modeBadge}
        </div>
        <div className="fx-spacer" />
        <IconButton size="sm" variant="ghost" label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} tooltip={isDark ? 'Light mode' : 'Dark mode'}
          icon={isDark ? <IconSun size={15} /> : <IconMoon size={15} />} onClick={() => setThemeMode(isDark ? 'light' : 'dark')} />
        <Button variant="primary" size="sm" label="Publish" isDisabled={(!hasChanges && !liveUrlChanged) || pubStatus?.phase === 'working'} isLoading={pubStatus?.phase === 'working'} onClick={() => publishNow()} tooltip="Publish (⌘S)" />
      </header>

      <div className={`fx-body ${view !== 'content' ? 'no-editor' : ''}`}
        style={{ gridTemplateColumns: view === 'content' ? `${leftW}px minmax(0, 1fr) ${rightW}px` : `${leftW}px minmax(0, 1fr)` }}>
        <aside className="fx-side">
          <Resizer side="right" width={leftW} setWidth={setLeftW} label="Resize content panel" />
          <NavTabs view={view} setView={setView} />
          <ContentTree state={state} selected={sel} onSelect={select} onAdd={addItem} resolveThumb={resolveThumb} />
        </aside>

        {view === 'content' && (
          <Preview ref={previewApi} path={previewPath} onNavigate={onNavigate} reloadKey={reloadKey} busy={busy}
            draftCount={changeCount} note={previewNote}
            onMiss={t => t?.text && t.label === t.text && setPreviewNote({ text: `“${t.text.slice(0, 40)}” isn't visible on this page` })} />
        )}
        {view === 'integrations' && <Integrations state={state} />}
        {view === 'settings' && (
          <Settings server={server} state={state} dirtyCount={dirtyItems.length}
            setLiveUrl={v => setState(s => ({ ...s, manifest: { ...s.manifest, _liveUrlSaved: s.manifest._liveUrlSaved ?? s.manifest.liveUrl, liveUrl: v } }))}
            onDiscardAll={() => setConfirmDiscard(true)}
            onLogout={server.available && server.configured ? () => { logout(); start(); } : null} />
        )}

        {view === 'content' && (
          <aside className="fx-editor" aria-label="Item editor">
            <Resizer side="left" width={rightW} setWidth={setRightW} label="Resize editor panel" />
            {(deployNote || (!server.available && !server.local)) && (
              <div style={{ padding: '12px 16px 0' }}>
                {deployNote
                  ? <Banner status="info" title="Deploying" description={deployNote} isDismissable onDismiss={() => setDeployNote('')} />
                  : <Banner status="info" title="Editing on a static host"
                    description="You can edit and preview here. To publish, download the changed files — or connect GitHub/Vercel Blob in Settings for one-click updates." />}
              </div>
            )}
            <ItemEditor key={item?.key || 'none'} state={state} col={col} item={item} ctx={ctx} actions={actions}
              usage={usage && usage.key === item?.key ? usage.pages : null}
              onOpenUsage={p => { previewApi.current?.open(p, { text: itemTitle(col, item), label: itemTitle(col, item) }); setPreviewPath(p); }} />
          </aside>
        )}
      </div>

      {(hasChanges || pubStatus) && (
        <ChangesBar count={changeCount} status={pubStatus}
          onDiscard={() => setConfirmDiscard(true)} onPublish={() => publishNow()}
          onPickFolder={() => publishNow({ allowPicker: true })} onDismiss={() => setPubStatus(null)} />
      )}

      <ConfirmDialog isOpen={confirmDiscard} onCancel={() => setConfirmDiscard(false)}
        title="Discard all unpublished changes?"
        description="Every edit, new item, deletion and upload that hasn't been published will be lost. This can't be undone."
        confirmLabel="Discard changes"
        onConfirm={async () => {
          setConfirmDiscard(false);
          await idbDel(draftKey(state.manifest));
          setUploads(new Map());
          setState(s => ({
            ...s,
            collections: s.collections.map(c => ({
              ...c, items: c.items.filter(i => i.status !== 'new').map(i => ({ ...i, data: structuredClone(i.orig), status: 'clean' })),
            })),
          }));
          notify('All unpublished changes discarded.');
        }} />
    </div>
  );
}

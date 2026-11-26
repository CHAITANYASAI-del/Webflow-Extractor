import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Spinner } from '@astryxdesign/core/Spinner';
import { ROOT } from '../core/site.js';
import { IconDesktop, IconTablet, IconPhone, IconRefresh, IconExternal } from '../icons.jsx';

const DEVICES = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Phone' };
// Render at real device widths (like Framer's canvas) and scale to fit, so
// the site never shows layouts squeezed to widths it wasn't designed for.
const DEVICE_W = { desktop: 1440, tablet: 820, mobile: 390 };
// Page folders always get a trailing slash so every server serves their
// index.html (folders like "article/projectionmapp.ing" look like files).
const pageUrl = p => ROOT + (p ? `${p.replace(/\/$/, '')}/` : '');
const relOf = loc => loc.protocol === 'about:' ? '' : decodeURIComponent(loc.pathname).slice(new URL(ROOT).pathname.length).replace(/index\.html$/, '').replace(/\/$/, '');

// ── Selection overlay inside the preview (Framer-style blue box + label) ─────
const BOX_ID = '__fx_select_box';
function ensureBox(doc) {
  let box = doc.getElementById(BOX_ID);
  if (!box) {
    box = doc.createElement('div');
    box.id = BOX_ID;
    box.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;border:2px solid #006DFF;border-radius:6px;opacity:0;transition:opacity .18s ease;display:none';
    doc.body.appendChild(box);
  }
  return box;
}
function hideBox(doc) { try { const b = doc && doc.getElementById(BOX_ID); if (b) { b.style.display = 'none'; b.style.opacity = '0'; } } catch {} }

function visible(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  // Opacity is ignored on purpose: Framer keeps below-the-fold sections at
  // opacity 0 until they scroll into view (reveal animations).
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Editor-style glide (like Shopify/Wix): eased, duration scales with distance
function glideTo(win, el, done) {
  const r = el.getBoundingClientRect();
  const from = win.scrollY;
  const max = win.document.documentElement.scrollHeight - win.innerHeight;
  const to = Math.max(0, Math.min(max, from + r.top - (win.innerHeight - Math.min(r.height, win.innerHeight * 0.8)) / 2));
  const dist = Math.abs(to - from);
  if (dist < 4) { done(); return () => {}; }
  const dur = Math.min(900, Math.max(380, dist * 0.45));
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const start = performance.now();
  let cancelled = false;
  // rAF when visible; timer fallback if the browser pauses animation frames
  const next = cb => (win.document.hidden || document.hidden) ? setTimeout(() => cb(performance.now()), 16) : win.requestAnimationFrame(cb);
  const step = now => {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / dur);
    win.scrollTo(0, from + (to - from) * ease(t));
    if (t < 1) next(step); else done();
  };
  next(step);
  return () => { cancelled = true; };
}

function findTarget(doc, t) {
  if (!doc?.body || !t) return null;
  const all = [...doc.body.querySelectorAll('a, img, video, h1, h2, h3, h4, h5, h6, p, span, div, li')];
  if (t.href) {
    const link = all.find(e => e.tagName === 'A' && (e.getAttribute('href') || '').replace(/\/$/, '').endsWith('/' + t.href) && visible(e));
    if (link) return link;
  }
  if (t.img) {
    const file = String(t.img).split('?')[0].split('/').pop();
    const img = all.find(e => (e.tagName === 'IMG' || e.tagName === 'VIDEO') && ((e.currentSrc || e.src || '').split('?')[0].endsWith(file)) && visible(e));
    if (img) return img;
  }
  if (t.text && norm(t.text).length >= 2) {
    const want = norm(t.text).slice(0, 120);
    let best = null, bestLen = Infinity;
    for (const e of all) {
      const txt = norm(e.textContent);
      if (!txt.includes(want) || txt.length > want.length * 3 + 40) continue;
      if (!visible(e)) continue;
      if (txt.length < bestLen) { best = e; bestLen = txt.length; }
    }
    return best;
  }
  return null;
}

// Instant feedback while typing: swap text/images in the visible page right
// away; the real rebuilt page is swapped in smoothly a moment later.
function patchDoc(doc, { oldText, newText, oldImg, newImg, mark }) {
  if (!doc?.body) return 0;
  let n = 0;
  if (oldText && oldText.length >= 2 && oldText !== newText) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(oldText)) hits.push(walker.currentNode);
    hits.forEach(tn => { tn.nodeValue = tn.nodeValue.split(oldText).join(newText ?? ''); n++; });
    if (doc.title.includes(oldText)) doc.title = doc.title.split(oldText).join(newText ?? '');
  }
  // Images the CMS changed before carry a marker (item/field) — use it first
  if (mark && newImg) {
    const marked = doc.querySelectorAll(`img[data-fx-f="${CSS.escape(mark)}"]`);
    marked.forEach(img => { img.srcset = ''; img.removeAttribute('sizes'); img.src = newImg; n++; });
    if (marked.length) return n;
  }
  if (oldImg && newImg) {
    const want = String(oldImg);
    const file = want.startsWith('blob:') ? want : want.split('?')[0].split('/').pop();
    const hit = u => !!u && (u === want || u.split('?')[0].endsWith(file));
    doc.querySelectorAll('img').forEach(img => {
      const all = [img.currentSrc, img.src, ...(img.srcset || '').split(',').map(x => x.trim().split(' ')[0])];
      if (all.some(hit)) { img.srcset = ''; img.removeAttribute('sizes'); img.src = newImg; n++; }
    });
  }
  return n;
}

export const Preview = forwardRef(function Preview({ path, onNavigate, reloadKey, busy, draftCount, note, onNoteAction, onMiss }, apiRef) {
  const onMissRef = useRef(onMiss);
  onMissRef.current = onMiss;
  // Two stacked frames: the visible one stays put while the other loads the
  // updated page; then they swap. No white flash, scroll position kept.
  const frames = [useRef(null), useRef(null)];
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const [device, setDevice] = useState('desktop');
  const stageRef = useRef(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const devW = DEVICE_W[device];
  const scale = stage.w ? Math.min(1, stage.w / devW) : 1;
  const viewW = Math.round(devW * scale);
  const viewH = Math.max(200, stage.h - 24);
  const [current, setCurrent] = useState(path || '');
  const lastNav = useRef(path ?? null); // first page is loaded by the iframe's src
  // Fixed for the component's lifetime: changing an iframe's src prop would
  // reload the VISIBLE frame directly and bypass the hidden preload.
  const [initialSrc] = useState('about:blank');
  const [firstReady, setFirstReady] = useState(false);
  const target = useRef(null);
  const tracked = useRef(null);
  const cancelGlide = useRef(null);
  const swapping = useRef(false);

  const frame = (i = activeRef.current) => frames[i].current;
  const doc = (i) => { try { return frame(i)?.contentDocument; } catch { return null; } };
  const win = (i) => { try { return frame(i)?.contentWindow; } catch { return null; } };

  const place = useCallback(() => {
    const d = doc(), el = tracked.current;
    if (!d || !el || !el.isConnected || el.ownerDocument !== d) { hideBox(d); return; }
    const r = el.getBoundingClientRect();
    const w = d.defaultView;
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > w.innerHeight || r.right < 0) { hideBox(d); return; }
    const box = ensureBox(d);
    box.style.display = 'block';
    box.style.left = `${r.left + w.scrollX - 4}px`;
    box.style.top = `${r.top + w.scrollY - 4}px`;
    box.style.width = `${r.width + 8}px`;
    box.style.height = `${r.height + 8}px`;
    requestAnimationFrame(() => { box.style.opacity = '1'; });
  }, []);

  // Find the target on the visible page (retries while Framer renders CMS)
  const apply = useCallback((t, { scroll = true } = {}) => {
    tracked.current = null;
    if (!t) { hideBox(doc()); return; }
    let tries = 0;
    const attempt = () => {
      if (target.current !== t) return;
      const d = doc();
      const el = d && findTarget(d, t);
      if (el) {
        tracked.current = el;
        hideBox(d);
        const r = el.getBoundingClientRect(), vh = d.defaultView.innerHeight;
        const needScroll = scroll && (r.top < 60 || r.bottom > vh - 40);
        cancelGlide.current?.();
        if (needScroll) cancelGlide.current = glideTo(d.defaultView, el, place);
        else place();
      } else if (++tries < 16) setTimeout(attempt, 200);
      else { hideBox(d); onMissRef.current?.(t); }
    };
    attempt();
  }, [place]);

  const highlight = useCallback((t, opts) => { target.current = t; apply(t, opts); }, [apply]);

  // Load a URL in the hidden frame; swap it in only once Framer has rendered,
  // so you never see half-rendered pages, placeholders or white flashes.
  const loadToken = useRef(0);
  const lastUrl = useRef('');
  const loadOffscreen = useCallback((url, { scrollY = 0 } = {}) => {
    // Never "load" the empty placeholder frame — reload the last real page instead
    if (!url || url.startsWith('about:')) url = lastUrl.current;
    if (!url) return;
    lastUrl.current = url;
    const token = ++loadToken.current;
    const to = 1 - activeRef.current;
    const back = frame(to);
    if (!back) return;
    swapping.current = true;
    let begun = false;
    const done = () => {
      const bw = back.contentWindow;
      // A new iframe fires 'load' for its initial about:blank first — wait for the real page
      try { if (bw.location.href === 'about:blank') return; } catch {}
      if (begun) return;
      begun = true;
      back.removeEventListener('load', done);
      if (token !== loadToken.current) return; // a newer request won
      const started = Date.now();
      // Framer animates with JavaScript (inline style changes every frame), so
      // "settled" = rendered AND no DOM/style changes for a short while.
      // "Ready" = the page STRUCTURE has stopped changing (Framer swaps in the
      // right breakpoint/header after hydrating). Style-only changes from
      // looping animations (videos, marquees, rolling text) are ignored.
      let lastChange = Date.now();
      let loadedAt = 0;
      let mo = null;
      try {
        mo = new bw.MutationObserver(list => { if (list.some(m => m.type === 'childList')) lastChange = Date.now(); });
        mo.observe(bw.document.documentElement, { childList: true, subtree: true });
      } catch {}
      let scrolled = false;
      const settle = () => {
        if (token !== loadToken.current) { mo?.disconnect(); return; }
        let rendered = false;
        try {
          const d = bw.document;
          rendered = d.readyState === 'complete' && d.body && d.body.children.length > 0;
          const vh = bw.innerHeight;
          if (rendered && [...d.images].some(i => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < vh && !i.complete; })) rendered = false;
        } catch {}
        const elapsed = Date.now() - started;
        if (!rendered && elapsed < 6000) return setTimeout(settle, 80);
        if (!rendered) {
          // Slow images/videos (cold CDN): show the page anyway once Framer's
          // structure is there — never leave the preview blank or stale
          let hasMain = false;
          try { hasMain = !!(bw.document.body && bw.document.body.children.length); } catch {}
          if (!hasMain) { mo?.disconnect(); swapping.current = false; return; }
        }
        if (!loadedAt) loadedAt = Date.now();
        // Scroll to the item while still hidden, so scroll-in animations play off-screen too
        if (!scrolled) {
          scrolled = true;
          try {
            if (scrollY) bw.scrollTo(0, scrollY);
            else if (target.current) {
              const el = findTarget(bw.document, target.current);
              if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
          } catch {}
          lastChange = Date.now();
          return setTimeout(settle, 80);
        }
        // structure quiet for 250ms, and give entrance animations ~450ms; cap 2.5s after load
        const sinceLoad = Date.now() - loadedAt;
        if ((Date.now() - lastChange < 250 || sinceLoad < 450) && sinceLoad < 2500) return setTimeout(settle, 60);
        mo?.disconnect();
        // Next frame when visible; background tabs get no frames, so use a timer
        (document.visibilityState === 'visible' ? requestAnimationFrame : f => setTimeout(f, 0))(() => {
          if (token !== loadToken.current) return;
          hideBox(doc());
          activeRef.current = to;
          setActive(to);
          setFirstReady(true);
          swapping.current = false;
          hookFrame(to);
          try { const rel = relOf(bw.location); setCurrent(rel); lastNav.current = rel; } catch {}
          if (target.current) apply(target.current, { scroll: false });
        });
      };
      settle();
    };
    back.addEventListener('load', done);
    // Always trigger a real load: setting the same src again fires no 'load'
    // event, which used to leave the preview stuck mid-switch.
    try {
      if (back.contentWindow && back.contentWindow.location.href === url) back.contentWindow.location.reload();
      else back.src = url;
    } catch { back.src = url; }
    // Safety net: never stay stuck if a page fails to load
    // Safety net: 'load' waits for every image and video, which can take long
    // on a cold CDN. If the page itself is there by then, go ahead without it.
    setTimeout(() => {
      if (token !== loadToken.current || begun) return;
      let ready = false;
      try { ready = back.contentWindow.location.href !== 'about:blank' && !!(back.contentDocument.body && back.contentDocument.body.children.length); } catch {}
      if (ready) { done(); return; }
      setTimeout(() => { if (token === loadToken.current && !begun) { back.removeEventListener('load', done); swapping.current = false; } }, 12000);
    }, 6000);
  }, [apply]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate: the new page loads off-screen, then the highlight is applied
  const go = useCallback((p, t) => {
    target.current = t || null;
    tracked.current = null;
    hideBox(doc());
    lastNav.current = p;
    loadOffscreen(pageUrl(p));
  }, [loadOffscreen]);

  useImperativeHandle(apiRef, () => ({
    highlight,
    open: go,
    clear: () => highlight(null),
    current: () => current,
    find: t => !!findTarget(doc(), t),
    patch: change => patchDoc(doc(), change),
    // Videos keep browser connections open (6 per site). Stop them before
    // publishing so the save requests never wait behind them; the preview
    // reloads after publishing anyway.
    releaseMedia: () => {
      loadToken.current++; // cancel a half-done preload
      [0, 1].forEach(i => {
        try {
          doc(i)?.querySelectorAll('video, audio').forEach(m => { m.pause(); m.removeAttribute('src'); m.querySelectorAll('source').forEach(x => x.remove()); m.load(); });
        } catch {}
      });
      swapping.current = false;
    },
  }), [highlight, go, current]);

  // First page: preload it hidden like every other page
  useEffect(() => { lastNav.current = path ?? ''; loadOffscreen(pageUrl(path || '')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // External navigation requests
  useEffect(() => {
    if (path == null) return;
    if (path === lastNav.current) return;
    go(path, target.current);
  }, [path, go]);

  // Rebuilt drafts → same page reloads off-screen, scroll kept, then swaps
  useEffect(() => {
    if (!reloadKey) return;
    const w = win();
    let url = pageUrl(current), scrollY = 0;
    try { if (w.location.protocol !== 'about:') { url = w.location.href; scrollY = w.scrollY; } else url = lastUrl.current || url; } catch {}
    loadOffscreen(url, { scrollY });
  }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const hookFrame = i => {
    const w = win(i);
    if (!w) return;
    try {
      w.addEventListener('scroll', place, { passive: true });
      w.addEventListener('resize', place);
    } catch {}
  };

  // Visible frame finished a navigation → re-apply the pending highlight
  const onLoad = i => () => {
    if (i !== activeRef.current || swapping.current) return;
    hookFrame(i);
    if (target.current) setTimeout(() => apply(target.current), 300);
  };

  // Follow navigation inside the preview (Framer uses client-side routing)
  useEffect(() => {
    const t = setInterval(() => {
      try {
        const w = win();
        if (!w) return;
        const rel = relOf(w.location);
        if (rel !== current) { setCurrent(rel); lastNav.current = rel; onNavigate?.(rel); }
        if (tracked.current) place();
      } catch {}
    }, 400);
    return () => clearInterval(t);
  }, [current, onNavigate, place]);

  return (
    <div className="fx-center">
      <div className="fx-preview-bar">
        <SegmentedControl label="Preview size" value={device} onChange={setDevice} size="sm">
          <SegmentedControlItem value="desktop" label="Desktop" isLabelHidden icon={<IconDesktop size={14} />} />
          <SegmentedControlItem value="tablet" label="Tablet" isLabelHidden icon={<IconTablet size={14} />} />
          <SegmentedControlItem value="mobile" label="Mobile" isLabelHidden icon={<IconPhone size={14} />} />
        </SegmentedControl>
        <div className="fx-spacer" />
        {busy && <span className="fx-preview-status" role="status"><Spinner size="sm" /> Updating</span>}
        <IconButton size="sm" variant="ghost" label="Reload preview" tooltip="Reload" icon={<IconRefresh size={14} />} onClick={() => { try { win().location.reload(); } catch {} }} />
        <IconButton size="sm" variant="ghost" label="Open page in new tab" tooltip="Open published page" icon={<IconExternal size={14} />} onClick={() => window.open(pageUrl(current), '_blank')} />
      </div>
      <div className="fx-stage" ref={stageRef}>
        <div className="fx-frame-col" style={{ width: viewW || '100%' }}>
          <div className="fx-frame-label"><span>{DEVICES[device]}{scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}</span><span className="fx-muted">/{current}</span></div>
          <div className="fx-frame-wrap" style={{ height: viewH }}>
            {[0, 1].map(i => (
              <iframe key={i} ref={frames[i]} className={`fx-frame ${active === i ? 'is-active' : 'is-buffer'}`}
                style={{ width: devW, height: viewH / scale, transform: `scale(${scale})`, transformOrigin: '0 0' }}
                title={active === i ? 'Site preview' : 'Preview buffer'} aria-hidden={active !== i} tabIndex={active === i ? 0 : -1}
                src={i === 0 ? initialSrc : 'about:blank'} onLoad={onLoad(i)} />
            ))}
            {!firstReady && <div className="fx-frame-loading" aria-hidden="true"><Spinner size="sm" /></div>}
            {note && (
              <div className="fx-preview-note">
                <span>{note.text}</span>
                {note.action && <button type="button" onClick={onNoteAction}>{note.action}</button>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

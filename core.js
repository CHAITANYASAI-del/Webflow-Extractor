// core.js — Webflow Extractor engine (no UI, no chrome.* APIs).
// Used by popup.js in the extension and by a Node test harness.
//
// Webflow publishes plain static HTML + one shared CSS file + a few runtime
// scripts, all hosted on Webflow's CDN. Extraction = fetch every page's server
// HTML, download every file it needs, point the references at local copies,
// and zip it up in a folder layout that any static host can serve.
'use strict';

(function (root) {

  // ── Hosts ─────────────────────────────────────────────────────────────────
  // Webflow-owned CDNs (images, fonts, css, js, video, lottie, …)
  const WF_CDN_SRC =
    'https?:\\/\\/(?:[a-z0-9-]+\\.)*(?:website-files\\.com|uploads-ssl\\.webflow\\.com|global-uploads\\.webflow\\.com)\\/' +
    '|https?:\\/\\/(?:d3e54v103j8qbb|daks2k3a4ib2z|d1otoma47x30pg)\\.cloudfront\\.net\\/';
  // Parentheses are part of real file names ("photo (1).png") but also end CSS url(…):
  // allow them only when balanced
  const URL_TAIL = '(?:[^\\s"\'`<>()\\\\,\\]\\[{}|^]|\\([^\\s"\'`<>()\\\\]*\\))+';
  const asAssetRe = () => new RegExp('(?:' + WF_CDN_SRC + ')' + URL_TAIL, 'gi');

  const CDN_HOST_RE = /^(?:(?:[a-z0-9-]+\.)*(?:website-files\.com|uploads-ssl\.webflow\.com|global-uploads\.webflow\.com)|(?:d3e54v103j8qbb|daks2k3a4ib2z|d1otoma47x30pg)\.cloudfront\.net)$/i;
  // Public library CDNs whose single-file scripts are safe to self-host
  const LIB_CDN_RE = /^(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|ajax\.googleapis\.com|code\.jquery\.com|stackpath\.bootstrapcdn\.com|cdn\.jsdelivr\.com)$/i;
  // Webflow's runtime ships a "Made in Webflow" badge icon — never needed
  // …and a placeholder image that 403s even on the live site
  const SKIP_URL_RE = /webflow-badge|\/img\/webflow-|webflow\.com\/api\/|\/plugins\/Basic\/assets\/placeholder\./i;

  const TYPE_BY_EXT = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', svg: 'image', ico: 'image', bmp: 'image',
    woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', eot: 'font',
    mp4: 'video', webm: 'video', ogg: 'video', mov: 'video', m4v: 'video',
    mp3: 'audio', wav: 'audio', m4a: 'audio',
    css: 'style', js: 'script', mjs: 'script', json: 'data', lottie: 'data',
    pdf: 'document', zip: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document', csv: 'document', txt: 'document',
  };
  const FOLDER = { image: 'images', font: 'fonts', video: 'videos', audio: 'media', style: 'css', script: 'js', data: 'data', document: 'documents', other: 'other' };
  const DEFAULT_EXT = { image: 'png', font: 'woff2', video: 'mp4', audio: 'mp3', style: 'css', script: 'js', data: 'json', document: 'bin', other: 'bin' };
  const TEXT_TYPES = new Set(['style', 'script']);

  // ── Small utils ───────────────────────────────────────────────────────────
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decodeEntities = s => s.replace(/&amp;/g, '&');

  // Cut an URL match at HTML-entity quotes and strip trailing punctuation
  function cleanUrl(raw) {
    let u = raw.replace(/&(?:quot|#x27|#39|apos|lt|gt);.*$/i, '');
    u = decodeEntities(u).replace(/[.;:!]+$/, '');
    return u;
  }

  function canon(u) { try { return new URL(u).href; } catch { return null; } }

  function extOf(url) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split(/\/|%2F/i).pop() || '');
      return last.includes('.') ? last.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    } catch { return ''; }
  }

  function classify(url) { return TYPE_BY_EXT[extOf(url)] || 'other'; }

  function sanitizeName(url, type, hintName) {
    let last = '';
    try {
      const segs = new URL(url).pathname.split(/\/|%2F/i);
      last = segs.pop() || segs.pop() || '';
      try { last = decodeURIComponent(last); } catch {}
    } catch {}
    let name = (hintName || last || 'file').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|-+$/g, '') || 'file';
    if (!/\.[A-Za-z0-9]{1,6}$/.test(name)) name += '.' + (DEFAULT_EXT[type] || 'bin');
    if (name.length > 110) {
      const dot = name.lastIndexOf('.');
      name = name.slice(0, 100) + (dot > 0 ? name.slice(dot) : '');
    }
    return name;
  }

  // Path of `to` as seen from a file that lives in directory `fromDir`
  function relPath(fromDir, to) {
    if (fromDir === null) return '/' + to;            // absolute mode (404.html)
    const f = fromDir ? fromDir.split('/') : [];
    const t = to.split('/');
    let i = 0;
    while (i < f.length && i < t.length - 1 && f[i] === t[i]) i++;
    return '../'.repeat(f.length - i) + t.slice(i).join('/');
  }

  // Link from a page in `fromDir` to the page folder `targetKey` ('' = home)
  function relLink(fromDir, targetKey) {
    const enc = k => k.split('/').map(encodeURIComponent).join('/');
    if (fromDir === null) return targetKey ? '/' + enc(targetKey) + '/' : '/';
    const f = fromDir ? fromDir.split('/') : [];
    const t = targetKey ? targetKey.split('/') : [];
    let i = 0;
    while (i < f.length && i < t.length && f[i] === t[i]) i++;
    const up = '../'.repeat(f.length - i);
    const down = t.slice(i).map(encodeURIComponent).join('/');
    return (up + (down ? down + '/' : '')) || './';
  }

  function siteFolderName(url) {
    let host = 'site';
    try { host = new URL(url || 'https://site').hostname || 'site'; } catch {}
    return (host.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'webflow') + '-site';
  }

  function siteInfo(pageUrl) {
    const u = new URL(pageUrl);
    return { origin: u.origin, host: u.hostname, isWebflowHost: /\.webflow\.io$/i.test(u.hostname) };
  }

  // ── Asset registry ────────────────────────────────────────────────────────
  // One entry per unique file. Remembers every spelling of the URL that was seen
  // (raw HTML form, canonical form) so each can be rewritten later.
  class Registry {
    constructor() { this.byUrl = new Map(); this.used = new Set(); }
    add(raw, hint = {}) {
      if (!raw || /^(?:data:|blob:|about:|#)/i.test(raw)) return null;
      const c = canon(raw);
      if (!c || !/^https?:/i.test(c) || SKIP_URL_RE.test(c)) return null;
      let a = this.byUrl.get(c);
      if (!a) {
        const type = hint.type || classify(c);
        const name = sanitizeName(c, type, hint.name);
        let lp = `${FOLDER[type] || 'other'}/${name}`;
        if (this.used.has(lp.toLowerCase())) {
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
          let n = 2;
          while (this.used.has(`${FOLDER[type] || 'other'}/${base}-${n}${ext}`.toLowerCase())) n++;
          lp = `${FOLDER[type] || 'other'}/${base}-${n}${ext}`;
        }
        this.used.add(lp.toLowerCase());
        a = { url: c, type, localPath: lp, aliases: new Set(), optional: !!hint.optional, fetched: false };
        this.byUrl.set(c, a);
      }
      a.aliases.add(raw);
      return a;
    }
    all() { return [...this.byUrl.values()]; }
    // every spelling → local path (only for files that downloaded OK)
    urlMap() {
      const m = {};
      this.all().filter(a => a.fetched).forEach(a => {
        m[a.url] = a.localPath;
        a.aliases.forEach(r => { m[r] = a.localPath; });
      });
      return m;
    }
  }

  // ── Scanning text for assets ──────────────────────────────────────────────
  // Anything on a Webflow CDN, whatever the file type (HTML, CSS, inline JS)
  function scanCdnUrls(text, reg) {
    let n = 0, m;
    const re = asAssetRe();
    while ((m = re.exec(text)) !== null) {
      const u = cleanUrl(m[0]);
      if (u.endsWith('/')) continue;
      if (reg.add(u)) n++;
    }
    return n;
  }

  // Background videos keep file names with spaces in data-poster-url /
  // data-video-urls ("People Staying Indoors-poster-00001.jpg"). A plain URL
  // scan would stop at the space, so read those attributes whole, register
  // them, and blank them out for the generic scan.
  const SPACED_ATTR_RE = /(\s(?:src|href|poster|data-[\w-]*?(?:url|urls|src))\s*=\s*)(["'])([^"']*\s[^"']*)\2/gi;
  // …and inline styles: background-image:url(&quot;…/People Staying Indoors-poster.jpg&quot;)
  const SPACED_CSS_URL_RE = /url\(\s*(&quot;|["'])((?:https?:)?\/\/[^"')]*?\s[^"')]*?)\1\s*\)/gi;
  function scanSpacedAttrs(html, reg) {
    html = html.replace(SPACED_CSS_URL_RE, (all, q, val) => {
      const u = decodeEntities(val.trim());
      if (!new RegExp('^(?:' + WF_CDN_SRC + ')', 'i').test(u)) return all;
      reg.add(u);
      return 'url()';
    });
    return html.replace(SPACED_ATTR_RE, (all, pre, q, val) => {
      const parts = val.split(',').map(v => decodeEntities(v.trim())).filter(Boolean);
      if (!parts.length || !parts.every(v => new RegExp('^(?:' + WF_CDN_SRC + ')', 'i').test(v))) return all;
      parts.forEach(v => reg.add(v));
      return pre + q + q;
    });
  }

  function attrOf(tag, name) {
    const m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
    return m ? decodeEntities(m[1] ?? m[2] ?? '') : null;
  }

  // <link rel=stylesheet> and <script src> → registry (resolved against pageUrl)
  function scanTags(html, pageUrl, reg) {
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0];
      if (!/\srel\s*=\s*["'][^"']*stylesheet/i.test(tag)) continue;
      const href = attrOf(tag, 'href');
      if (!href) continue;
      let abs; try { abs = new URL(href, pageUrl).href; } catch { continue; }
      reg.add(abs, { type: 'style', name: /fonts\.googleapis\.com/i.test(abs) ? 'google-fonts.css' : undefined });
    }
    for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
      const src = attrOf(m[0], 'src');
      if (!src) continue;
      let u; try { u = new URL(src, pageUrl); } catch { continue; }
      if (/\stype\s*=\s*["']module["']/i.test(m[0])) continue; // leave ES modules alone
      if (CDN_HOST_RE.test(u.hostname)) reg.add(u.href, { type: 'script' });
      else if (LIB_CDN_RE.test(u.hostname)) reg.add(u.href, { type: 'script', optional: true });
    }
  }

  // url(...) and @import in a stylesheet (relative URLs resolve against cssUrl)
  const CSS_URL_RE = /url\(\s*(["']?)([^"')]+?)\1\s*\)/gi;
  const CSS_IMPORT_RE = /@import\s+(["'])([^"']+)\1/gi;
  function scanCss(text, cssUrl, reg) {
    let n = 0, m;
    CSS_URL_RE.lastIndex = 0;
    while ((m = CSS_URL_RE.exec(text)) !== null) {
      const raw = m[2].trim();
      if (/^(?:data:|#|about:)/i.test(raw)) continue;
      let abs; try { abs = new URL(raw, cssUrl).href; } catch { continue; }
      const isImport = /@import\s+$/i.test(text.slice(Math.max(0, m.index - 12), m.index));
      if (reg.add(abs, isImport ? { type: 'style', name: /fonts\.googleapis\.com/i.test(abs) ? 'google-fonts.css' : undefined } : {})) n++;
    }
    CSS_IMPORT_RE.lastIndex = 0;
    while ((m = CSS_IMPORT_RE.exec(text)) !== null) {
      let abs; try { abs = new URL(m[2], cssUrl).href; } catch { continue; }
      if (reg.add(abs, { type: 'style' })) n++;
    }
    return n;
  }

  function rewriteCss(text, cssUrl, urlMap, fromDir) {
    const sub = (raw) => {
      raw = raw.trim();
      if (/^(?:data:|#|about:)/i.test(raw)) return null;
      let abs; try { abs = new URL(raw, cssUrl).href; } catch { return null; }
      const lp = urlMap[abs];
      return lp ? relPath(fromDir, lp) : null;
    };
    return text
      .replace(CSS_URL_RE, (all, q, raw) => { const r = sub(raw); return r ? `url(${q || '"'}${r}${q || '"'})` : all; })
      .replace(CSS_IMPORT_RE, (all, q, raw) => { const r = sub(raw); return r ? `@import ${q}${r}${q}` : all; });
  }

  // A script from a public CDN is only safe to self-host if it is one
  // self-contained file (no lazy chunks that resolve relative to its own URL)
  function isSelfContainedScript(text) {
    return !/(?:^|[;\n])\s*(?:import|export)\s*[\w{*]|\bimport\s*\(|webpackChunk|__webpack_require__\.[pu]\b|importScripts\s*\(/m.test(text);
  }

  // ── URL rewriting (HTML) ──────────────────────────────────────────────────
  // One combined regex, longest URL first. Handles raw and &amp; spellings.
  const _cache = new WeakMap();
  function rewriteUrls(text, urlMap, fromDir) {
    if (!text) return text;
    const n = Object.keys(urlMap).length;
    let c = _cache.get(urlMap);
    if (!c || c.n !== n) {
      const lookup = new Map();
      Object.entries(urlMap).forEach(([u, lp]) => {
        lookup.set(u, lp);
        if (u.includes('&')) lookup.set(u.replace(/&/g, '&amp;'), lp);
      });
      const keys = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escRe);
      c = { n, lookup, re: keys.length ? new RegExp(keys.join('|'), 'g') : null };
      _cache.set(urlMap, c);
    }
    if (!c.re) return text;
    return text.replace(c.re, m => relPath(fromDir, c.lookup.get(m)));
  }

  // ── Pages ─────────────────────────────────────────────────────────────────
  // Webflow collection lists paginate with  ?<hash>_page=2
  function pageKey(u) {
    let url; try { url = new URL(u); } catch { return null; }
    let p = url.pathname;
    try { p = decodeURIComponent(p); } catch {}
    p = p.replace(/^\/+|\/+$/g, '');
    const pg = /^\?[A-Za-z0-9]+_page=(\d+)$/.exec(url.search);
    if (pg && +pg[1] > 1) p = (p ? p + '/' : '') + 'page-' + pg[1];
    return p;
  }

  const SKIP_PATH_RE = /\.(?:pdf|zip|jpe?g|png|gif|svg|webp|avif|mp4|webm|mp3|wav|css|js|json|xml|txt|ico|woff2?|ttf|otf)$/i;
  const SKIP_PREFIX_RE = /^\/(?:api|cdn-cgi|_next|\.well-known)(?:\/|$)/;

  function extractPageLinks(html, baseUrl) {
    const base = new URL(baseUrl);
    const out = new Map(); // key → url
    for (const m of html.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const href = decodeEntities((m[1] ?? m[2] ?? '').trim());
      if (!href || /^(?:#|mailto:|tel:|javascript:|sms:)/i.test(href)) continue;
      if (/\$\{|\{\{|\\|<%/.test(href)) continue; // template strings inside inline scripts
      let url; try { url = new URL(href, baseUrl); } catch { continue; }
      if (url.origin !== base.origin) continue;
      if (SKIP_PATH_RE.test(url.pathname) || SKIP_PREFIX_RE.test(url.pathname)) continue;
      const key = pageKey(url.href);
      if (key === null || key === '404' || out.has(key)) continue;
      const pg = /^\?[A-Za-z0-9]+_page=\d+$/.test(url.search) ? url.search : '';
      out.set(key, url.origin + url.pathname + pg);
    }
    return out;
  }

  // ── HTML processing ───────────────────────────────────────────────────────
  // RULE: never reformat the HTML or strip data-* attributes — Webflow's
  // interactions (data-w-id, data-animation-type, …) depend on them.
  const FILE_HELPER = `<script>if(location.protocol==='file:'){document.addEventListener('DOMContentLoaded',function(){var d=document.createElement('div');d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999999;background:#1E293B;color:#F8FAFC;padding:14px 20px;font:13px/1.5 system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';d.innerHTML='<strong>Animations, Lottie and page links need a local server.</strong> Double-click <code style="background:#334155;padding:2px 8px;border-radius:4px;margin:0 4px">preview-mac.command</code> or <code style="background:#334155;padding:2px 8px;border-radius:4px;margin:0 4px">preview-windows.bat</code> in this folder, or drag the folder to netlify.com/drop. <button onclick="this.parentElement.remove()" style="margin-left:12px;background:#475569;border:none;color:#F8FAFC;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px">\u2715</button>';document.body.prepend(d)})}</script>`;

  const OWN_CSS = `/* Your custom CSS goes here. This file loads after Webflow's own styles,\n   so anything you add here overrides them. */\n\n/* Hides the "Made in Webflow" badge Webflow adds to free-plan and .webflow.io sites */\n.w-webflow-badge { display: none !important; }\n`;

  function processHtml(htmlString, ctx) {
    const { urlMap, pageDir, pagesByKey, site, pageUrl } = ctx;
    let html = htmlString;

    // <html> attributes that make Webflow's runtime show its badge / redirect to the editor
    html = html.replace(/<html\b[^>]*>/i, tag =>
      tag.replace(/\s+data-wf-(?:status|domain)\s*=\s*(?:"[^"]*"|'[^']*')/gi, ''));

    // Pointless once files are local
    html = html.replace(/<link\b[^>]*\brel\s*=\s*["'](?:preconnect|dns-prefetch)["'][^>]*>/gi, tag =>
      /website-files\.com|cloudfront\.net|webflow\.com/i.test(tag) ? '' : tag);

    // Page-to-page links → relative folders (works on any host / sub-folder)
    html = html.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])([^"']*)\2/gi, (all, pre, q, href) => {
      const h = decodeEntities(href.trim());
      if (!h || /^(?:#|mailto:|tel:|javascript:|sms:)/i.test(h)) return all;
      let url; try { url = new URL(h, pageUrl); } catch { return all; }
      if (url.origin !== site.origin) return all;
      const key = pageKey(url.href);
      if (key === '404') return `${pre}${q}${relPath(pageDir, '404.html')}${q}`;
      if (key === null || !pagesByKey.has(key)) return all;
      return `${pre}${q}${relLink(pageDir, key)}${url.hash}${q}`;
    });

    // RSS feeds (<link rel="alternate" href="rss.xml">) are saved at their real path
    if (ctx.feeds) html = html.replace(/<link\b[^>]*>/gi, tag => {
      if (!/application\/(?:rss|atom)\+xml/i.test(tag)) return tag;
      const href = attrOf(tag, 'href');
      let u; try { u = new URL(href, pageUrl); } catch { return tag; }
      const lp = ctx.feeds.get(u.origin + u.pathname);
      return lp ? tag.replace(/(\shref\s*=\s*)(["'])[^"']*\2/i, `$1$2${relPath(pageDir, lp)}$2`) : tag;
    });

    // Social-preview images must stay absolute URLs
    const metaKeep = [];
    html = html.replace(/<meta\b[^>]*>/gi, tag => {
      if (!/(?:property|name)\s*=\s*["'](?:og:image(?::url)?|twitter:image(?::src)?)["']/i.test(tag)) return tag;
      return tag.replace(/(\scontent\s*=\s*)(["'])([^"']*)\2/i, (all, pre, q, val) => {
        metaKeep.push(decodeEntities(val));
        return `${pre}${q}__WFX_META_${metaKeep.length - 1}__${q}`;
      });
    });

    html = rewriteUrls(html, urlMap, pageDir);

    html = html.replace(/__WFX_META_(\d+)__/g, (all, i) => {
      const orig = metaKeep[+i];
      const lp = urlMap[orig] || urlMap[canon(orig) || ''];
      // custom domain → the exported file will live at <origin>/<path>; else keep the CDN URL
      return (lp && !site.isWebflowHost) ? `${site.origin}/${lp}` : orig.replace(/&/g, '&amp;');
    });

    // Local files changed → the original integrity hashes no longer match
    html = html.replace(/<(?:script|link)\b[^>]*>/gi, tag => {
      const isSheet = /^<script/i.test(tag) || /\srel\s*=\s*["'][^"']*stylesheet/i.test(tag);
      const ref = attrOf(tag, isSheet && /^<script/i.test(tag) ? 'src' : 'href');
      if (!ref || /^(?:https?:)?\/\//i.test(ref)) return tag;
      let t = tag.replace(/\s+integrity\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
      if (isSheet) t = t.replace(/\s+crossorigin(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/gi, '');
      return t;
    });

    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${FILE_HELPER}`);
    html = html.replace(/<\/head>/i, `<link rel="stylesheet" href="${relPath(pageDir, 'styles.css')}">\n</head>`);
    if (!/^\s*<!DOCTYPE/i.test(html)) html = '<!DOCTYPE html>\n' + html;
    return html;
  }

  // canonical / og:url pointing at the old *.webflow.io address would tell
  // search engines the real page still lives there
  function seoFix(html, site, notes, path) {
    let out = html;
    if (/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(out) ||
        /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots["']/i.test(out)) notes.noindexPages.push(path);
    if (site.isWebflowHost) {
      const e = escRe(site.origin);
      const before = out.length;
      out = out.replace(new RegExp(`<link[^>]+rel=["']canonical["'][^>]*>`, 'gi'), t => t.includes(site.origin) ? '' : t);
      out = out.replace(new RegExp(`<meta[^>]+property=["']og:url["'][^>]*>`, 'gi'), t => new RegExp(e).test(t) ? '' : t);
      if (out.length !== before) notes.canonicalsRemoved++;
    }
    return out;
  }

  // ── Hosting / docs ────────────────────────────────────────────────────────
  function hostingFiles(zip, site, paths, hasCms) {
    const cmsRule = hasCms ? 'Disallow: /cms/\n' : '';
    const all = ['', ...paths];
    const origin = site.isWebflowHost ? 'https://YOUR-DOMAIN.com' : site.origin;
    const urls = all.map(p => `  <url><loc>${origin}/${p.split('/').map(encodeURIComponent).join('/')}${p ? '/' : ''}</loc></url>`).join('\n');
    zip.file('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n${site.isWebflowHost ? '<!-- Replace YOUR-DOMAIN.com with your real domain before deploying (see README) -->\n' : ''}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    zip.file('robots.txt', site.isWebflowHost
      ? `User-agent: *\nAllow: /\n${cmsRule}\n# After replacing YOUR-DOMAIN.com in sitemap.xml, add:\n# Sitemap: https://YOUR-DOMAIN.com/sitemap.xml\n`
      : `User-agent: *\nAllow: /\n${cmsRule}\nSitemap: ${site.origin}/sitemap.xml\n`);
    zip.file('.nojekyll', '');
    zip.file('preview-mac.command',
      '#!/bin/bash\n# Double-click to preview this site. Keep the window open; close it to stop.\n' +
      'cd "$(dirname "$0")"\nPORT=8080\n' +
      'if command -v node >/dev/null 2>&1; then\n  node preview-server.mjs $PORT --open\n' +
      'elif xcode-select -p >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then\n  (sleep 1; open "http://localhost:$PORT") &\n  python3 -m http.server $PORT\n' +
      'else\n  osascript -e \'display dialog "To preview your site, install Node.js (free) from nodejs.org, then double-click this file again." buttons {"Open nodejs.org"} default button 1\' && open "https://nodejs.org/en/download"\nfi\n',
      { unixPermissions: '755' });
    zip.file('preview-windows.bat',
      '@echo off\r\nREM Double-click to preview this site. Close this window to stop.\r\n' +
      'cd /d "%~dp0"\r\n' +
      'where node >nul 2>nul && (node preview-server.mjs 8080 --open & goto :eof)\r\n' +
      'where python >nul 2>nul && (start "" http://localhost:8080 & python -m http.server 8080 & goto :eof)\r\n' +
      'echo To preview your site, install Node.js from https://nodejs.org then run this file again.\r\nstart "" https://nodejs.org/en/download\r\npause\r\n');
  }

  function readme(title, url, info) {
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const { files = 0, pages = 1, site, seoNotes, leftovers = 0, scriptsLeft = [], cms = null } = info;
    const cmsSection = cms ? `
## ✏️ Edit your content (CMS)

Your Webflow CMS came along. Edit it in the built-in CMS:

1. Start the preview (\`npm start\`, step 1).
2. Open **http://localhost:8080/cms/**
3. Pick an item on the left. The middle shows your real site; change fields on the right and the page updates as you type.
4. Click **Publish** — your edits are saved straight into this folder.

| Collection | Items | Pages |
|---|---|---|
${cms.map(c => `| ${c.name} | ${c.count} | ${c.folder ? `\`/${c.folder}/…\`` : 'shown in lists'} |`).join('\n')}

You can edit text, rich text, images, links, references (author, category) and multi-references (tags);
add, duplicate, reorder or delete items. Lists without their own pages (testimonials, FAQs, team) are
collections too. Every list follows your edits: blog grids, "latest posts", category pages, paginated
lists (page 2, 3…) and sliders. Renaming a slug updates every link; deleting an item clears references to it.

Good to know: the CMS edits what Webflow published. Webflow-only settings (Switch fields that show/hide
blocks, list filters, sorting rules) aren't in the export, so the CMS follows what the lists showed.
Edits change this exported site only — your Webflow project isn't touched, so a new export from Webflow replaces CMS-only edits.

### Edit from your live site (optional)

| Setup | You get | Publish speed |
|---|---|---|
| **Vercel + Blob** | Edit at \`your-site/cms\` from anywhere | Live in seconds |
| **Vercel + GitHub + Blob** | Same, and every publish is a GitHub commit | Live in seconds |
| **Vercel or Netlify + GitHub** | Every publish is a commit, the host redeploys | ~30 seconds |
| **Netlify Drop / GitHub Pages** | Edit on your computer, upload the folder again | When you upload |

**Vercel, ~2 minutes:**
1. Deploy this folder to Vercel (\`npx vercel\` here, or import a GitHub repo at vercel.com/new).
2. Project → **Settings → Environment Variables** → add \`FX_ADMIN_PASSWORD\` = a password you choose (your CMS password).
3. Project → **Storage → Create → Blob** → connect it to the project (instant publishing).
4. **Deployments → ⋯ → Redeploy.** Open \`your-site/cms\` and sign in.

| Variable | What it's for |
|---|---|
| \`FX_ADMIN_PASSWORD\` | **Required.** Password to open \`/cms\` on the live site |
| \`BLOB_READ_WRITE_TOKEN\` | Added when you connect a **Vercel Blob** store → changes go live in seconds |
| \`GITHUB_TOKEN\` + \`GITHUB_REPO\` | Optional: every publish is also a GitHub commit (fine-grained token, Contents read & write) |

The CMS is password-protected online and hidden from search engines.
` : '';
    const domainNote = site.isWebflowHost
      ? `Your sitemap.xml and robots.txt contain \`YOUR-DOMAIN.com\` — replace it with your real domain before deploying.`
      : `sitemap.xml and robots.txt already point at ${site.origin}.`;
    return `# ${title || 'Webflow site'} — static export

Exported from ${url} on ${date} with **Webflow Extractor**.
${pages} page(s) · ${files} files · plain HTML, CSS and JS — no build step, no Webflow account needed.

## 1. Preview it

\`\`\`
npm start            # or: node preview-server.mjs --open
\`\`\`

or double-click \`preview-mac.command\` / \`preview-windows.bat\`. Opening index.html straight from disk
(file://) shows the layout, but animations, Lottie files and page links need a server.

${cmsSection}
## 2. Put it online (free)

| Host | How |
|---|---|
| **Netlify** | Drag this folder onto https://app.netlify.com/drop |
| **Vercel** | \`npx vercel\` inside this folder (Framework: Other, no build command) |
| **Cloudflare Pages** | Create a project → upload this folder |
| **GitHub Pages** | Push to a repo → Settings → Pages → deploy from branch |

${domainNote}

## 3. Folder layout

\`\`\`
index.html, <page>/index.html   every page (CMS item pages included)
404.html                        your Webflow 404 page
css/   js/   images/   fonts/   videos/   data/   documents/
styles.css                      yours — linked last, so it overrides Webflow's CSS${cms ? `
cms/                            the CMS editor · cms/data/*.csv|json = copies of your content` : ''}
\`\`\`

Edit text in the HTML files, or add CSS to \`styles.css\`. Keep the \`data-w-id\` / \`data-*\` attributes:
Webflow's interactions need them.

## 4. What does NOT carry over

Webflow runs these on its servers, so a static copy cannot:

- **Forms** — submissions post to Webflow. Point each \`<form action>\` at Netlify Forms, Formspree, Basin, etc.
- **Site search**, **Ecommerce / checkout**, **Memberships / logins**
${cms ? '' : "- **Editing in Webflow's CMS** — this site has no CMS collections, so there is no editor at /cms.\n"}
${leftovers ? `\n> ${leftovers} image/asset URL(s) are still loaded from Webflow's CDN (variants only used at some screen sizes).\n` : ''}${scriptsLeft.length ? `\n> Still loaded from public CDNs (not self-hosted because they load extra files): ${scriptsLeft.join(', ')}\n` : ''}${seoNotes && seoNotes.noindexPages.length ? `\n> ${seoNotes.noindexPages.length} page(s) are set to "noindex" in Webflow — search engines will skip them.\n` : ''}
## 5. Legal

Only export sites you own or have permission to copy.
`;
  }

  function agentsGuide(title, url, cms) {
    const cmsNotes = cms ? `
## CMS (/cms)
- The site has Webflow CMS collections (${cms.map(c => `${c.name} ×${c.count}${c.folder ? ` at /${c.folder}/…` : ' (list only)'}`).join(', ')}), editable at **/cms/** (prebuilt app in \`cms/\`).
- \`cms/fx-site.json\` holds every item's values. Elements that show a field carry \`data-wfx-f="<field>"\`; collection-list cards carry \`data-wfx-i="<collection>/<item>"\`. **Keep these attributes** — the CMS rewrites exactly those elements on Publish.
- Change CMS content through /cms (or edit \`cms/fx-site.json\` *and* the marked HTML together). \`cms/data/*\` are generated copies; editing them changes nothing.
- Publish needs a server: locally \`npm start\` (preview-server.mjs saves into this folder via a localhost-only \`/api/fx-cms\`). Online: Vercel/Netlify run \`api/fx-cms\` (\`fx-server/handler.mjs\`). Required env var \`FX_ADMIN_PASSWORD\` (ask the user — never invent, print or commit it); optional Vercel Blob (\`BLOB_READ_WRITE_TOKEN\`) for instant publishing, \`GITHUB_TOKEN\` + \`GITHUB_REPO\` for commits.
- After deploying, give the user two links: **Site** \`<url>\` and **CMS** \`<url>/cms/\`.
` : `
- This site has **no CMS collections**: /cms is not part of it and shows the 404 page.
`;
    return `# ${title || 'Webflow site'} — notes for AI coding tools

This is a **static export of a Webflow site** (source: ${url}). There is no framework and no build step.

- Pages: \`index.html\` and \`<slug>/index.html\`. Paths to css/js/images are **relative** (\`../../css/…\`), so keep each page's depth consistent if you move files.
- Webflow's runtime (\`js/webflow.*.js\`, jQuery, GSAP) drives all animations through \`data-w-id\` and \`data-animation-type\` attributes. **Never strip \`data-*\` attributes or reformat the HTML structure** unless asked.
- \`css/*.webflow.shared.*.css\` is Webflow's generated stylesheet. Put edits in \`styles.css\` (loaded last) instead of changing it.
- Forms post to Webflow and will not work here; replace each form's action with another backend.
- Preview: \`npm start\` (serves on http://localhost:8080 and prints the links).
${cmsNotes}`;
  }

  // ── The extraction run ────────────────────────────────────────────────────
  // opts: { pageUrl, renderedUrls, JSZip, netText(url,{anyStatus}), netBinary(url),
  //         log(type,msg), progress(pct,label), step(id,state), stepCount(id,text) }
  async function run(opts) {
    const { JSZip, netText, netBinary } = opts;
    const log = opts.log || (() => {});
    const progress = opts.progress || (() => {});
    const step = opts.step || (() => {});
    const stepCount = opts.stepCount || (() => {});

    const site = siteInfo(opts.pageUrl);
    const homeUrl = site.origin + '/';
    const MAX_PAGES = 1000, PAGE_BATCH = 8, POOL = 12;
    const reg = new Registry();

    // ── STEP 1: scan ──────────────────────────────────────────────────────
    step('scan', 'active');
    log('info', 'Reading the page exactly as Webflow published it…');

    const home = await netText(homeUrl);
    if (!home.success || !/<html/i.test(home.text)) throw new Error('Could not load ' + homeUrl + (home.error ? ` (${home.error})` : ''));
    const homeTitle = ((home.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();

    const pages = new Map();             // key → { url, html }
    pages.set('', { url: homeUrl, html: home.text });
    const scanHtml = (html, url) => { scanCdnUrls(scanSpacedAttrs(html, reg), reg); scanTags(html, url, reg); };
    scanHtml(home.text, homeUrl);
    // Files the live tab actually loaded (catches anything added at runtime)
    (opts.renderedUrls || []).forEach(u => {
      let h; try { h = new URL(u).hostname; } catch { return; }
      if (CDN_HOST_RE.test(h) || /^fonts\.gstatic\.com$/i.test(h)) reg.add(u);
    });

    const counts = () => {
      const c = { image: 0, video: 0, font: 0, script: 0, style: 0 };
      reg.all().forEach(a => { if (c[a.type] !== undefined) c[a.type]++; });
      return c;
    };
    const c0 = counts();
    step('scan', 'done');
    stepCount('scan', `${reg.all().length} items`);
    log('ok', `${c0.image} images · ${c0.video} videos · ${c0.font} fonts · ${c0.script} scripts · ${c0.style} stylesheets`);
    progress(12, 'Finding pages…');

    // ── Pages: links on the home page + sitemap.xml, then links on every page ─
    const queue = [];
    const queued = new Set(['']);
    const enqueue = (key, url) => { if (!queued.has(key)) { queued.add(key); queue.push({ key, url }); } };
    extractPageLinks(home.text, homeUrl).forEach((url, key) => enqueue(key, url));
    try {
      const sm = await netText(site.origin + '/sitemap.xml');
      if (sm.success && /<urlset|<sitemapindex/i.test(sm.text)) {
        for (const m of sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
          try {
            const u = new URL(decodeEntities(m[1]));
            if (u.origin !== site.origin || SKIP_PATH_RE.test(u.pathname)) continue;
            const key = pageKey(u.href);
            if (key !== null && key !== '404') enqueue(key, u.origin + u.pathname);
          } catch {}
        }
      }
    } catch {}

    if (queue.length) {
      const groups = {};
      queue.forEach(q => { const seg = q.key.split('/'); const k = seg.length > 1 ? `/${seg[0]}/*` : '/ (pages)'; groups[k] = (groups[k] || 0) + 1; });
      log('info', `Found ${queue.length} more page(s): ` + Object.entries(groups).map(([k, n]) => `${k} ×${n}`).join(' · '));
    }
    let qi = 0, skipped = 0;
    while (qi < queue.length && qi < MAX_PAGES) {
      const batch = queue.slice(qi, Math.min(qi + PAGE_BATCH, MAX_PAGES));
      qi += batch.length;
      const results = await Promise.all(batch.map(b => netText(b.url).catch(() => null)));
      results.forEach((r, i) => {
        const b = batch[i];
        if (r && r.success && /<html/i.test(r.text)) {
          pages.set(b.key, { url: b.url, html: r.text });
          scanHtml(r.text, b.url);
          extractPageLinks(r.text, b.url).forEach((u, k) => enqueue(k, u));
          log('ok', `↳ /${b.key}`);
        } else { skipped++; log('warn', `↳ /${b.key} skipped (could not load)`); }
      });
      progress(12, `Pages ${pages.size}/${Math.min(queue.length + 1, MAX_PAGES + 1)}…`);
    }
    if (queue.length > MAX_PAGES) log('warn', `Site has ${queue.length + 1} pages — exported the first ${MAX_PAGES + 1}`);
    log('ok', `${pages.size} page(s) captured${skipped ? ` · ${skipped} skipped` : ''}`);

    // The site's own 404 design
    let notFound = null;
    try {
      const nf = await netText(site.origin + '/404', { anyStatus: true });
      if (nf.success && /<html/i.test(nf.text)) { notFound = { url: site.origin + '/404', html: nf.text }; scanHtml(nf.text, notFound.url); }
    } catch {}

    // ── STEP 2: download ──────────────────────────────────────────────────
    step('fetch', 'active');
    let done = 0, failed = 0, total = 0;
    const text = {};                     // url → text (css / js)
    const download = async (list) => {
      total += list.length;
      let next = 0;
      const worker = async () => {
        while (next < list.length) {
          const a = list[next++];
          const isText = TEXT_TYPES.has(a.type);
          const r = isText ? await netText(a.url) : await netBinary(a.url);
          done++;
          progress(12 + Math.min(1, done / Math.max(total, 1)) * 52, `Fetching ${done}/${total}…`);
          if (r && r.success) {
            if (isText) text[a.url] = r.text; else a.bytes = r.bytes;
            a.fetched = true;
          } else {
            failed++;
            log('warn', `Skipped (${(r && r.error) || 'failed'}): ${shortName(a.url)}`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(POOL, list.length) }, worker));
    };

    let pending = reg.all().filter(a => !a.fetched && !a.tried);
    for (let round = 0; round < 4 && pending.length; round++) {
      pending.forEach(a => { a.tried = true; });
      await download(pending);
      // optional library scripts: keep only if a single self-contained file
      pending.filter(a => a.type === 'script' && a.optional && a.fetched).forEach(a => {
        if (!isSelfContainedScript(text[a.url] || '')) { a.fetched = false; a.skipped = true; delete text[a.url]; }
      });
      // stylesheets pull in fonts / images / more stylesheets
      let found = 0;
      pending.filter(a => a.type === 'style' && a.fetched).forEach(a => { found += scanCss(text[a.url], a.url, reg); });
      pending = reg.all().filter(a => !a.tried);
      if (pending.length) log('info', `Found ${pending.length} more file(s) inside stylesheets — downloading…`);
    }

    const okCount = reg.all().filter(a => a.fetched).length;
    step('fetch', 'done');
    stepCount('fetch', `${okCount} files`);
    log('ok', `Downloaded ${okCount} files${failed ? ` · ${failed} skipped` : ''}`);
    progress(68, 'Rewriting & separating…');

    // ── STEP 3: rewrite ───────────────────────────────────────────────────
    step('rewrite', 'active');
    const urlMap = reg.urlMap();

    // ── STEP 4: zip ───────────────────────────────────────────────────────
    const zipRoot = new JSZip();
    const folder = siteFolderName(opts.pageUrl);
    const zip = zipRoot.folder(folder);
    const seoNotes = { noindexPages: [], canonicalsRemoved: 0 };
    const pagesByKey = new Map([...pages.keys()].map(k => [k, true]));

    // RSS feeds Webflow generates per collection
    const feeds = new Map();   // absolute URL → local path
    for (const [, pg] of pages) for (const m of pg.html.matchAll(/<link\b[^>]*>/gi)) {
      if (!/application\/(?:rss|atom)\+xml/i.test(m[0])) continue;
      let u; try { u = new URL(attrOf(m[0], 'href'), pg.url); } catch { continue; }
      if (u.origin !== site.origin || feeds.has(u.origin + u.pathname)) continue;
      feeds.set(u.origin + u.pathname, decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'rss.xml');
    }
    for (const [url, lp] of [...feeds]) {
      const r = await netText(url).catch(() => null);
      if (r && r.success && /<(?:rss|feed)\b/i.test(r.text)) zip.file(lp, r.text);
      else feeds.delete(url);
    }
    if (feeds.size) log('ok', `RSS feed${feeds.size > 1 ? 's' : ''}: ${[...feeds.values()].join(', ')}`);

    const exportedPaths = [];
    const finals = [];
    for (const [key, pg] of pages) {
      const dir = key;
      const out = processHtml(pg.html, { urlMap, pageDir: dir, pagesByKey, site, pageUrl: pg.url, feeds });
      finals.push({ key, html: seoFix(out, site, seoNotes, '/' + key) });
      if (key) exportedPaths.push(key);
    }

    // Webflow CMS → editable at /cms (collections found from the item pages)
    let cms = null;
    const CMS = opts.cms || root.WFXCMS;
    if (CMS) {
      try {
        cms = CMS.annotate(finals, { DOMParser: opts.DOMParser, siteName: homeTitle, sourceUrl: homeUrl });
        if (cms) {
          finals.forEach(f => { if (cms.pages.has(f.key)) f.html = cms.pages.get(f.key); });
          cms.manifest.liveUrl = site.isWebflowHost ? '' : site.origin;
          log('ok', `CMS found: ${cms.manifest.collections.map(c => `${c.name} ×${c.items.length}`).join(' · ')} → editor at /cms`);
        } else log('info', 'No Webflow CMS collections on this site');
      } catch (e) { cms = null; log('warn', `CMS skipped: ${e.message}`); }
    }
    let hasCms = false;
    if (cms && opts.loadKit) {
      try {
        const kit = await opts.loadKit();
        kit.forEach(([dest, content]) => zip.file(dest, content));
        zip.file('cms/fx-site.json', JSON.stringify(cms.manifest));
        CMS.dataFiles(cms.manifest).forEach(([p, c]) => zip.file(p, c));
        hasCms = true;
      } catch (e) { log('warn', `CMS editor not added: ${e.message}`); }
    }
    if (!hasCms) cms = null;

    const written = [];
    for (const f of finals) {
      zip.file(f.key ? `${f.key}/index.html` : 'index.html', f.html);
      written.push(f.html);
    }
    if (notFound) {
      const out = processHtml(notFound.html, { urlMap, pageDir: null, pagesByKey, site, pageUrl: notFound.url });
      zip.file('404.html', seoFix(out, site, seoNotes, '/404'));
    } else {
      // No Webflow 404 design to copy: a plain "page not found" (also what /cms shows on sites without a CMS)
      zip.file('404.html', `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Page not found</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fafafa;color:#111;text-align:center;padding:24px;box-sizing:border-box}h1{font-size:72px;line-height:1;margin:0 0 12px;letter-spacing:-.04em}p{margin:0 0 24px;color:#666}a{display:inline-block;padding:10px 18px;border-radius:8px;background:#111;color:#fff;text-decoration:none}</style>
</head><body><main><h1>404</h1><p>This page doesn’t exist or has been moved.</p><a href="/">Back to home</a></main></body></html>
`);
    }
    zip.file('styles.css', OWN_CSS);

    // Files
    reg.all().filter(a => a.fetched).forEach(a => {
      if (a.type === 'style') {
        const dir = a.localPath.split('/').slice(0, -1).join('/');
        zip.file(a.localPath, rewriteCss(text[a.url], a.url, urlMap, dir));
      } else if (a.type === 'script') {
        zip.file(a.localPath, text[a.url].replace(/\n?\/\/[#@]\s*sourceMappingURL=.*$/gm, ''));
      } else {
        zip.file(a.localPath, a.bytes, { compression: 'STORE' });
      }
    });

    setStepDone();
    function setStepDone() {
      step('rewrite', 'done');
      stepCount('rewrite', 'Done');
      log('ok', 'HTML links · css/ · js/ · relative paths');
      progress(80, 'Building ZIP…');
      step('zip', 'active');
    }

    hostingFiles(zip, site, exportedPaths, hasCms);
    zip.file('package.json', JSON.stringify({
      name: folder, private: true, type: 'module',
      description: 'Static site exported from Webflow with Webflow Extractor. Run: npm start',
      scripts: { start: 'node preview-server.mjs --open', dev: 'node preview-server.mjs --open', preview: 'node preview-server.mjs --open' },
      // `npx serve` / `npx http-server` here run the site's own server (CMS publish works)
      bin: { serve: 'preview-server.mjs', 'http-server': 'preview-server.mjs', 'live-server': 'preview-server.mjs' },
      ...(hasCms ? { dependencies: { '@vercel/blob': '^2.0.0' } } : {}),
    }, null, 2) + '\n');
    if (opts.previewServerSource) zip.file('preview-server.mjs', opts.previewServerSource, { unixPermissions: '755' });

    // Independence check: Webflow CDN URLs still referenced by the pages
    const leftovers = new Set();
    written.forEach(h => (h.replace(/<meta\b[^>]*>/gi, '').match(asAssetRe()) || []).forEach(u => { const c = cleanUrl(u).split('?')[0]; if (!SKIP_URL_RE.test(c)) leftovers.add(c); }));
    const scriptsLeft = reg.all().filter(a => a.skipped).map(a => { try { return new URL(a.url).hostname; } catch { return a.url; } });
    if (leftovers.size) log('warn', `${leftovers.size} image/asset URL(s) still load from Webflow's CDN`);
    else log('ok', 'Independence check: every page asset is local');
    if (seoNotes.noindexPages.length) log('warn', `${seoNotes.noindexPages.length} page(s) are set to "noindex" in Webflow — search engines will skip them`);

    const cmsInfo = cms ? cms.manifest.collections.map(c => ({ name: c.name, count: c.items.length, folder: c.pagePrefix })) : null;
    zip.file('README.md', readme(homeTitle, homeUrl, { files: okCount, pages: pages.size, site, seoNotes, leftovers: leftovers.size, scriptsLeft: [...new Set(scriptsLeft)], cms: cmsInfo }));
    const guide = agentsGuide(homeTitle, homeUrl, cmsInfo);
    zip.file('AGENTS.md', guide);
    zip.file('CLAUDE.md', guide);

    return { zipRoot, folder, title: homeTitle, stats: { pages: pages.size, files: okCount, failed, leftovers: leftovers.size, cms: cmsInfo } };
  }

  function shortName(url) {
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop()) || url.slice(0, 40); } catch { return String(url).slice(0, 40); }
  }

  // ── Webflow detection helper (works on an HTML string) ────────────────────
  function looksLikeWebflow(html) {
    return /<html[^>]+data-wf-(?:site|page)=/i.test(html) || /<meta[^>]+name=["']generator["'][^>]+content=["']Webflow/i.test(html) ||
           /<meta[^>]+content=["']Webflow["'][^>]+name=["']generator["']/i.test(html);
  }

  const api = { run, processHtml, rewriteUrls, rewriteCss, scanCdnUrls, scanCss, scanTags, Registry, relPath, relLink, pageKey,
                extractPageLinks, classify, sanitizeName, siteFolderName, siteInfo, cleanUrl, isSelfContainedScript, looksLikeWebflow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WFX = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

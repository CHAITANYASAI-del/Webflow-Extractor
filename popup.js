// popup.js — UI + orchestration for Webflow Extractor.
// All extraction logic lives in core.js (WFX.run); this file owns the popup UI,
// talks to the page's content script, downloads over the network and saves the ZIP.
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let currentTab   = null;
let extractedZip = null;
let isRunning    = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const siteBadge     = document.getElementById('site-badge');
const siteUrlEl     = document.getElementById('site-url');
let   extractBtn    = document.getElementById('extract-btn');   // re-queried after Re-Extract rebuilds the buttons
let   downloadBtn   = document.getElementById('download-btn');
const progressWrap  = document.getElementById('progress-container');
const progressFill  = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const progressPct   = document.getElementById('progress-pct');
const logWrap       = document.getElementById('log-container');
const logEl         = document.getElementById('log');

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab  = tab;
  const url   = tab.url || '';

  siteUrlEl.textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '') || '—';

  // *.webflow.io is certainly Webflow; custom domains are checked by the page itself
  const isWebflowUrl = /\.webflow\.io(\/|$)/.test(url);
  if (isWebflowUrl) {
    setBadge('webflow', 'Webflow Site');
    extractBtn.disabled = false;
  } else {
    setBadge('unknown', 'Checking…');
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
      const check = await new Promise(resolve => {
        chrome.tabs.sendMessage(tab.id, { type: 'CHECK_WEBFLOW' }, r => resolve(chrome.runtime.lastError ? null : r));
      });
      if (check?.isWebflow) {
        setBadge('webflow', 'Webflow Site');
        extractBtn.disabled = false;
      } else {
        window.location.href = 'not-webflow.html';
        return;
      }
    } catch {
      window.location.href = 'not-webflow.html';
      return;
    }
  }

  extractBtn.addEventListener('click',  startExtraction);
  downloadBtn.addEventListener('click', triggerDownload);
});

// ── UI helpers ─────────────────────────────────────────────────────────────
function setBadge(type, label) {
  siteBadge.className = `badge badge--${type}`;
  siteBadge.querySelector('.badge-label').textContent = label;
}
function setStep(id, state) {
  const el = document.getElementById(`step-${id}`);
  if (!el) return;
  el.className = `step step--${state}`;
  const indicator = el.querySelector('.step__indicator');
  if (state === 'done') {
    indicator.innerHTML = `<img class="step__checkbox" src="assets/Checkbox.svg" alt="" />`;
  } else {
    if (!indicator.querySelector('.step__dot')) {
      indicator.innerHTML = `<div class="step__dot step__dot--idle"></div>`;
    }
    indicator.querySelector('.step__dot').className = `step__dot step__dot--${
      state === 'active' ? 'active' : state === 'error' ? 'error' : 'idle'}`;
  }
}
function setStepCount(id, text) {
  const el = document.getElementById(`step-${id}-count`);
  if (el) el.textContent = text;
}
function setProgress(pct, label) {
  progressFill.style.width  = `${pct}%`;
  progressLabel.textContent = label;
  progressPct.textContent   = `${Math.round(pct)}%`;
}
function addLog(type, msg) {
  const icons = { info:'›', ok:'✓', warn:'!', error:'✗' };
  const line  = document.createElement('div');
  line.className = `log-line log-line--${type}`;
  line.innerHTML = `<span class="log-icon">${icons[type]||'›'}</span><span class="log-msg">${esc(msg)}</span>`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function setLoading(on) {
  const btnOuter = extractBtn.closest('.btn-outer');
  if (on) {
    extractBtn.disabled  = true;
    extractBtn.innerHTML = `<svg class="btn-loading-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.22 4.22l2.83 2.83M12.95 12.95l2.83 2.83M4.22 15.78l2.83-2.83M12.95 7.05l2.83-2.83" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg><span>Extracting…</span>`;
    if (btnOuter) btnOuter.classList.add('btn-outer--extracting');
  } else {
    extractBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <path d="M7.5 2v8M4.5 7l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 12h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg><span>Extract Again</span>`;
    extractBtn.disabled = false;
    if (btnOuter) btnOuter.classList.remove('btn-outer--extracting');
  }
}

// ── Network ─────────────────────────────────────────────────────────────────
// Downloads run directly in the popup (extension pages may fetch any host in
// host_permissions, no CORS). Every request has a timeout: a stuck file is
// skipped with a warning instead of freezing the whole extraction.
const TEXT_TIMEOUT = 45000;   // pages, css, scripts
const BIN_IDLE     = 30000;   // binary: abort if no bytes arrive for 30s
const BIN_MAX      = 240000;  // binary: hard cap (large videos)

async function netText(url, opts = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TEXT_TIMEOUT);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok && !opts.anyStatus) throw new Error(`HTTP ${res.status}`);
    return { success: true, text: await res.text(), url };
  } catch (e) {
    return { success: false, error: e.name === 'AbortError' ? 'timed out' : e.message, url };
  } finally { clearTimeout(timer); }
}

async function netBinary(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BIN_MAX);
  let idle;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Stream so a stalled transfer is detected
    const reader = res.body.getReader();
    const parts = []; let size = 0;
    const bump = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), BIN_IDLE); };
    bump();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); size += value.length; bump();
    }
    const bytes = new Uint8Array(size); let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
    return { success: true, bytes, url };
  } catch (e) {
    return { success: false, error: e.name === 'AbortError' ? 'timed out' : e.message, url };
  } finally { clearTimeout(timer); clearTimeout(idle); }
}

function sendMsg(msg) {
  return new Promise((res, rej) => {
    chrome.tabs.sendMessage(currentTab.id, msg, r => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res(r);
    });
  });
}

// ── Main extraction ────────────────────────────────────────────────────────
async function startExtraction() {
  if (isRunning) return;
  isRunning = true;

  progressWrap.style.display = 'flex';
  logWrap.style.display      = 'block';
  downloadBtn.style.display  = 'none';
  document.querySelector('.success-banner')?.remove();
  logEl.innerHTML = '';
  setLoading(true);
  setProgress(0, 'Starting…');

  try {
    // What the live tab loaded (finds files that only appear at runtime)
    let renderedUrls = [];
    try {
      await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['content.js'] }).catch(() => {});
      const scan = await sendMsg({ type: 'SCAN_PAGE' });
      if (scan?.success) renderedUrls = scan.data.urls || [];
    } catch {}

    let previewServerSource = null;
    try {
      const ps = await fetch(chrome.runtime.getURL('site-kit/preview-server.mjs'));
      if (ps.ok) previewServerSource = await ps.text();
    } catch {}

    const result = await WFX.run({
      pageUrl: currentTab.url,
      renderedUrls,
      previewServerSource,
      loadKit: loadCmsKit,
      JSZip,
      netText, netBinary,
      log: addLog,
      progress: setProgress,
      step: setStep,
      stepCount: setStepCount,
    });

    const blob = await result.zipRoot.generateAsync({
      type: 'blob', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 6 },
    }, meta => setProgress(80 + (meta.percent / 100) * 17, `Compressing… ${Math.round(meta.percent)}%`));

    extractedZip = blob;
    const mb = (blob.size / 1024 / 1024).toFixed(2);
    setStep('zip', 'done');
    setStepCount('zip', `${mb} MB`);
    addLog('ok', `ZIP ready — ${mb} MB`);
    setProgress(100, 'Complete!');
    showSuccess();
  } catch (err) {
    addLog('error', err.message);
    setProgress(0, 'Error — see log');
    console.error('[WebflowExtractor]', err);
    ['scan', 'fetch', 'rewrite', 'zip'].forEach(id => {
      if (document.getElementById(`step-${id}`)?.classList.contains('step--active')) setStep(id, 'error');
    });
    setLoading(false);
  } finally {
    isRunning = false;
  }
}

// The prebuilt CMS editor + its server files, added only to sites with a CMS
const CMS_KIT = [
  ['admin-dist/index.html', 'cms/index.html'],
  ['admin-dist/assets/admin.js', 'cms/assets/admin.js'],
  ['admin-dist/assets/admin.css', 'cms/assets/admin.css'],
  ['admin-dist/assets/heic.js', 'cms/assets/heic.js'], // iPhone photo decoder, loaded only when needed
  ['admin-dist/fx-admin-sw.js', 'fx-admin-sw.js'],
  ['site-kit/fx-server/handler.mjs', 'fx-server/handler.mjs'],
  ['site-kit/api/fx-cms.mjs', 'api/fx-cms.mjs'],
  ['site-kit/netlify/functions/fx-cms.mjs', 'netlify/functions/fx-cms.mjs'],
  ['site-kit/middleware.js', 'middleware.js'],
  ['site-kit/netlify.toml', 'netlify.toml'],
];
async function loadCmsKit() {
  return Promise.all(CMS_KIT.map(async ([src, dest]) => {
    const r = await fetch(chrome.runtime.getURL(src));
    if (!r.ok) throw new Error(`missing ${src}`);
    return [dest, await r.text()];
  }));
}

// ── Download ───────────────────────────────────────────────────────────────
// Use URL.createObjectURL directly in the popup — avoids message size limits
async function triggerDownload() {
  if (!extractedZip) return;
  try {
    const filename  = `${WFX.siteFolderName(currentTab.url)}.zip`;
    const objectUrl = URL.createObjectURL(extractedZip);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    addLog('ok', `Downloading ${filename}…`);
  } catch (err) {
    addLog('error', `Download failed: ${err.message}`);
    console.error('[WebflowExtractor] Download error:', err);
  }
}

function showSuccess() {
  document.querySelector('.success-banner')?.remove();

  progressWrap.style.display = 'none';
  logWrap.style.display      = 'none';

  const banner = document.createElement('div');
  banner.className = 'success-banner';
  banner.innerHTML = `
    <img class="success-banner__bee" src="assets/ff1abbe881bc6062e9d0f05bb4edc33b40c95e28.png" alt="" />
    <div class="success-banner__title">Sweet Build Ready!!!</div>
    <div class="success-banner__desc">Your site is ready— Download it, deploy on Vercel, or run locally. Need help? The README has you covered.</div>`;
  document.querySelector('.steps-card').insertAdjacentElement('beforebegin', banner);

  // Dual-button layout: Re-Extract + Download ZIP
  const actionsEl = document.querySelector('.actions');
  actionsEl.className = 'actions actions--dual';
  actionsEl.innerHTML = `
    <div class="btn-outer btn-outer--secondary">
      <button class="btn btn--primary" id="re-extract-btn">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" stroke="#006DFF" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M8 2.5L10.5 2.5L8 0" stroke="#006DFF" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Re-Extract</span>
      </button>
    </div>
    <div class="btn-outer btn-outer--primary">
      <button class="btn btn--primary" id="download-btn-new">
        <svg class="btn__icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2.5 12.5h11M8 2v8M5 7.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Download ZIP</span>
      </button>
    </div>`;

  document.getElementById('re-extract-btn').addEventListener('click', () => {
    document.querySelector('.success-banner')?.remove();
    actionsEl.className = 'actions';
    actionsEl.innerHTML = `
      <div class="btn-outer">
        <button id="extract-btn" class="btn btn--primary">
          <img src="assets/download-icon.svg" alt="" class="btn__icon" />
          <span>Extract Site</span>
        </button>
      </div>
      <button id="download-btn" class="btn btn--download" style="display:none">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M2.5 12.5h10M7.5 1.5v8M4.5 7l3 3 3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>Download ZIP</span>
      </button>`;
    extractedZip = null;
    isRunning = false;
    ['scan', 'fetch', 'rewrite', 'zip'].forEach(id => { setStep(id, 'idle'); setStepCount(id, '—'); });
    // The buttons are new DOM nodes — re-point the shared refs and listeners
    extractBtn  = document.getElementById('extract-btn');
    downloadBtn = document.getElementById('download-btn');
    extractBtn.addEventListener('click', startExtraction);
    downloadBtn.addEventListener('click', triggerDownload);
    startExtraction();
  });
  document.getElementById('download-btn-new').addEventListener('click', triggerDownload);
}

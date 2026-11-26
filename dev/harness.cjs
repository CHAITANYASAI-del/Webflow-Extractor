const fs = require('fs'), path = require('path');
const PROJ = path.resolve(__dirname, '..');
const JSZip = require(PROJ + '/jszip.min.js');
const { run } = require(PROJ + '/core.js');
const CMS = require(PROJ + '/webflow-cms.js');
const { DOMParser } = require('linkedom');
const KIT = [['admin-dist/index.html','cms/index.html'],['admin-dist/assets/admin.js','cms/assets/admin.js'],['admin-dist/assets/admin.css','cms/assets/admin.css'],['admin-dist/assets/heic.js','cms/assets/heic.js'],['admin-dist/fx-admin-sw.js','fx-admin-sw.js'],['site-kit/fx-server/handler.mjs','fx-server/handler.mjs'],['site-kit/api/fx-cms.mjs','api/fx-cms.mjs'],['site-kit/netlify/functions/fx-cms.mjs','netlify/functions/fx-cms.mjs'],['site-kit/middleware.js','middleware.js'],['site-kit/netlify.toml','netlify.toml']];
const target = process.argv[2] || 'https://two26.studio/';
const outDir = process.argv[3] || path.join(__dirname, 'out');
const netText = async (url, o = {}) => {
  try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok && !o.anyStatus) throw new Error('HTTP ' + r.status); return { success: true, text: await r.text() }; }
  catch (e) { return { success: false, error: e.message }; }
};
const netBinary = async (url) => {
  try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return { success: true, bytes: new Uint8Array(await r.arrayBuffer()) }; }
  catch (e) { return { success: false, error: e.message }; }
};
(async () => {
  const res = await run({
    pageUrl: target, JSZip, netText, netBinary, renderedUrls: [],
    previewServerSource: fs.readFileSync(PROJ + '/site-kit/preview-server.mjs', 'utf8'), cms: CMS, DOMParser,
    loadKit: async () => KIT.map(([s, d]) => [d, fs.readFileSync(PROJ + '/' + s, 'utf8')]),
    log: (t, m) => console.log(`[${t}] ${m}`), step: (i, s) => console.log(`  step ${i}: ${s}`),
    progress: () => {}, stepCount: (i, t) => console.log(`  count ${i}: ${t}`),
  });
  const buf = await res.zipRoot.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE' });
  fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'site.zip'), buf);
  console.log('ZIP', (buf.length / 1048576).toFixed(2), 'MB', JSON.stringify(res.stats), res.folder);
})().catch(e => { console.error('FAIL', e); process.exit(1); });

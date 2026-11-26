// Content exports for moving CMS data to other tools.
//  • CSV  — Notion, Airtable, Google Sheets, Webflow, Framer (Import CSV)
//  • JSON — developers / headless CMS
//  • WXR  — WordPress native importer (Tools → Import → WordPress)

import { itemTitle, itemSlug, resolveImage, ROOT } from './site.js';
import { richTextToHtml, richTextToPlain } from './richtext.js';

const SYSTEM = new Set(['id', 'previousItemId', 'nextItemId']);

function refTitle(state, id) {
  for (const c of state.collections) {
    const it = c.items.find(i => i.data.id?.v === id);
    if (it) return { title: itemTitle(c, it), slug: itemSlug(c, it) };
  }
  return { title: id, slug: id };
}

function absUrl(src, manifest) {
  if (!src) return '';
  const r = resolveImage(src, manifest.imageMap);
  // Local file → absolute URL of the live site if we know it, else this origin
  if (r && r.startsWith(ROOT) && manifest.liveUrl) return manifest.liveUrl.replace(/\/$/, '') + '/' + r.slice(ROOT.length);
  return r || '';
}

// Plain JS value for one field, formatted for a target
export function exportValue(state, col, field, item, { rich = 'html', refs = 'title' } = {}) {
  const v = item.data[field.id];
  if (!v || v.v == null) return '';
  if (/CollectionReference/.test(field.type)) {
    const ids = v.t === 'array' ? v.v.map(x => x.v) : [v.v];
    return ids.filter(Boolean).map(id => refTitle(state, id)[refs]).join(', ');
  }
  switch (v.t) {
    case 'string': case 'enum': case 'color': case 'file': return String(v.v);
    case 'number': return v.v;
    case 'boolean': return v.v ? 'true' : 'false';
    case 'date': return v.v;
    case 'link': return typeof v.v === 'object' ? (v.v.url || v.v.href || '') : String(v.v);
    case 'image': return absUrl(typeof v.v === 'string' ? v.v : v.v.src, state.manifest);
    case 'richtext': return rich === 'text' ? richTextToPlain(v.v) : richTextToHtml(v.v);
    case 'richtextRef': return '';
    case 'array': return v.v.map(x => (x.t === 'string' ? refTitle(state, x.v)[refs] : '')).filter(Boolean).join(', ');
    default: break;
  }
  if (/CollectionReference/.test(field.type) && v.t === 'string') return refTitle(state, v.v)[refs];
  return '';
}

const csvCell = s => { s = s == null ? '' : String(s); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function toCSV(state, col, opts = {}) {
  const fields = col.fields.filter(f => !SYSTEM.has(f.id));
  // Notion/Airtable use the FIRST column as the record name → put Title first
  if (opts.titleFirst && col.titleFieldId) {
    const i = fields.findIndex(f => f.id === col.titleFieldId);
    if (i > 0) fields.unshift(...fields.splice(i, 1));
  }
  const rows = [fields.map(f => csvCell(f.title)).join(',')];
  if (opts.pageUrl) rows[0] += ',Page URL';
  for (const it of col.items.filter(i => i.status !== 'deleted')) {
    let row = fields.map(f => csvCell(exportValue(state, col, f, it, opts))).join(',');
    if (opts.pageUrl) row += ',' + csvCell(it.page ? (state.manifest.liveUrl || ROOT).replace(/\/$/, '') + '/' + it.page : '');
    rows.push(row);
  }
  return '﻿' + rows.join('\r\n');
}

export function toJSON(state, col) {
  const fields = col.fields.filter(f => !SYSTEM.has(f.id));
  return JSON.stringify({
    collection: col.name,
    exportedAt: new Date().toISOString(),
    fields: fields.map(f => ({ id: f.id, title: f.title, type: f.type })),
    items: col.items.filter(i => i.status !== 'deleted').map(it => {
      const o = { id: it.data.id?.v, page: it.page ? '/' + it.page : null };
      fields.forEach(f => { o[f.title] = exportValue(state, col, f, it); });
      return o;
    }),
  }, null, 2);
}

// ── WordPress WXR ────────────────────────────────────────────────────────────
const cdata = s => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const xmlEsc = s => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const wpDate = iso => { const d = iso ? new Date(iso) : new Date(); return isNaN(d) ? new Date().toISOString().slice(0, 19).replace('T', ' ') : d.toISOString().slice(0, 19).replace('T', ' '); };

export function toWXR(state, cols, { postType = 'post', siteTitle = 'Webflow site' } = {}) {
  let postId = 1000;
  const items = [];
  const categories = new Map();
  for (const col of cols) {
    const fields = col.fields.filter(f => !SYSTEM.has(f.id));
    const richField = fields.find(f => f.type === 'RichText');
    const dateField = fields.find(f => f.type === 'Date' && !['createdAt', 'updatedAt'].includes(f.id)) || fields.find(f => f.id === 'createdAt');
    const imgField = fields.find(f => f.type === 'ResponsiveImage' || f.type === 'Image');
    const excerptField = fields.find(f => f.type === 'String' && f.id !== col.titleFieldId && f.id !== col.slugFieldId && /desc|summary|excerpt|intro|subtitle|body/i.test(f.title));
    const catFields = fields.filter(f => /CollectionReference/.test(f.type) || f.type === 'Enum');

    for (const it of col.items.filter(i => i.status !== 'deleted')) {
      const id = postId++;
      const title = itemTitle(col, it);
      const slug = itemSlug(col, it);
      let content = richField ? exportValue(state, col, richField, it) : '';
      // Other text fields that aren't mapped anywhere become extra paragraphs only if there is no rich text
      if (!content) content = fields.filter(f => f.type === 'String' && ![col.titleFieldId, col.slugFieldId, excerptField?.id].includes(f.id))
        .map(f => exportValue(state, col, f, it)).filter(Boolean).map(t => `<p>${xmlEsc(t)}</p>`).join('\n');
      const date = dateField ? exportValue(state, col, dateField, it) : '';
      const cats = [{ domain: 'category', name: col.name }];
      catFields.forEach(f => {
        const val = exportValue(state, col, f, it);
        String(val).split(',').map(s => s.trim()).filter(Boolean).forEach(n => cats.push({ domain: 'post_tag', name: n }));
      });
      cats.forEach(c => categories.set(`${c.domain}:${c.name}`, c));
      const meta = fields.filter(f => ![col.titleFieldId, col.slugFieldId, richField?.id].includes(f.id))
        .map(f => ({ key: f.title, value: exportValue(state, col, f, it) })).filter(m => m.value !== '');

      let attachment = '', thumbMeta = '';
      const img = imgField ? exportValue(state, col, imgField, it) : '';
      if (img && /^https?:/.test(img)) {
        const aid = postId++;
        attachment = `
  <item>
    <title>${cdata(title)}</title>
    <wp:post_id>${aid}</wp:post_id>
    <wp:post_date>${cdata(wpDate(date))}</wp:post_date>
    <wp:post_name>${cdata(slug + '-image')}</wp:post_name>
    <wp:status>${cdata('inherit')}</wp:status>
    <wp:post_parent>${id}</wp:post_parent>
    <wp:post_type>${cdata('attachment')}</wp:post_type>
    <wp:attachment_url>${cdata(img)}</wp:attachment_url>
    <guid isPermaLink="false">${xmlEsc(img)}</guid>
  </item>`;
        thumbMeta = `
    <wp:postmeta><wp:meta_key>${cdata('_thumbnail_id')}</wp:meta_key><wp:meta_value>${cdata(aid)}</wp:meta_value></wp:postmeta>`;
      }
      items.push(`${attachment}
  <item>
    <title>${cdata(title)}</title>
    <dc:creator>${cdata('admin')}</dc:creator>
    <content:encoded>${cdata(content)}</content:encoded>
    <excerpt:encoded>${cdata(excerptField ? exportValue(state, col, excerptField, it, { rich: 'text' }) : '')}</excerpt:encoded>
    <wp:post_id>${id}</wp:post_id>
    <wp:post_date>${cdata(wpDate(date))}</wp:post_date>
    <wp:post_date_gmt>${cdata(wpDate(date))}</wp:post_date_gmt>
    <wp:post_name>${cdata(slug)}</wp:post_name>
    <wp:status>${cdata('publish')}</wp:status>
    <wp:post_type>${cdata(postType)}</wp:post_type>
${cats.map(c => `    <category domain="${c.domain}" nicename="${xmlEsc(c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${cdata(c.name)}</category>`).join('\n')}${thumbMeta}
${meta.map(m => `    <wp:postmeta><wp:meta_key>${cdata(m.key)}</wp:meta_key><wp:meta_value>${cdata(m.value)}</wp:meta_value></wp:postmeta>`).join('\n')}
  </item>`);
    }
  }
  const cats = [...categories.values()];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- WordPress import file generated by Webflow Extractor. In WordPress: Tools → Import → WordPress → upload this file. -->
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>${xmlEsc(siteTitle)}</title>
  <wp:wxr_version>1.2</wp:wxr_version>
${cats.filter(c => c.domain === 'category').map(c => `  <wp:category><wp:category_nicename>${cdata(c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}</wp:category_nicename><wp:cat_name>${cdata(c.name)}</wp:cat_name></wp:category>`).join('\n')}
${cats.filter(c => c.domain === 'post_tag').map(c => `  <wp:tag><wp:tag_slug>${cdata(c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}</wp:tag_slug><wp:tag_name>${cdata(c.name)}</wp:tag_name></wp:tag>`).join('\n')}
${items.join('\n')}
</channel>
</rss>
`;
}

export function download(name, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

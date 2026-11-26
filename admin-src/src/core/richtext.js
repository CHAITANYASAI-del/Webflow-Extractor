// Webflow rich text is plain HTML (the inside of a .w-richtext block).
// The editor works on HTML too; saving keeps only safe rich-text markup.
// Webflow's own blocks (figures, embeds with class w-richtext-figure-type-*)
// are kept as they are.

const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'a',
  'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'br', 'hr', 'img', 'div', 'span', 'figure', 'figcaption',
  'sup', 'sub', 'iframe', 'video', 'source', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const DROP = new Set(['script', 'style', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta']);
const ATTRS = new Set(['href', 'src', 'srcset', 'sizes', 'alt', 'title', 'target', 'rel', 'class', 'id', 'width', 'height',
  'loading', 'style', 'allow', 'allowfullscreen', 'frameborder', 'scrolling', 'data-rt-type', 'data-rt-align',
  'data-rt-max-width', 'data-rt-max-height', 'data-rt-dimensions', 'data-page-url', 'start', 'type']);

export function richTextToHtml(value) {
  return typeof value === 'string' ? value : '';
}

function clean(node, doc) {
  for (const n of [...node.childNodes]) {
    if (n.nodeType === 8) { n.remove(); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (DROP.has(tag)) { n.remove(); continue; }
    if (!ALLOWED.has(tag)) { clean(n, doc); n.replaceWith(...n.childNodes); continue; }
    for (const a of [...n.attributes]) {
      const name = a.name.toLowerCase();
      if (!ATTRS.has(name) || /^on/.test(name) || ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
    }
    if (tag === 'iframe' && !/^https:\/\//i.test(n.getAttribute('src') || '')) { n.remove(); continue; }
    clean(n, doc);
  }
}

export function htmlToRichText(html) {
  const doc = new DOMParser().parseFromString(`<div id="r">${html || ''}</div>`, 'text/html');
  const root = doc.getElementById('r');
  clean(root, doc);
  // Stray top-level text → paragraphs, so Webflow's rich-text styles apply
  const out = [];
  let inline = [];
  const flush = () => { if (inline.join('').trim()) out.push(`<p>${inline.join('')}</p>`); inline = []; };
  for (const n of [...root.childNodes]) {
    const isInline = n.nodeType === 3 || (n.nodeType === 1 && ['strong', 'em', 'b', 'i', 'u', 's', 'a', 'code', 'span', 'br', 'sup', 'sub'].includes(n.tagName.toLowerCase()));
    if (isInline) inline.push(n.nodeType === 3 ? n.nodeValue.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) : n.outerHTML);
    else { flush(); out.push(n.outerHTML); }
  }
  flush();
  return out.join('');
}

export function richTextToPlain(value) {
  const html = richTextToHtml(value);
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

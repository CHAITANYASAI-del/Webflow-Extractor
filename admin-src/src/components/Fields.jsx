import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Switch } from '@astryxdesign/core/Switch';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Token } from '@astryxdesign/core/Token';
import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { richTextToHtml, htmlToRichText } from '../core/richtext.js';
import { itemTitle, resolveImage, slugify } from '../core/site.js';
import { IconBold, IconItalic, IconLink, IconList, IconListOl, IconQuote, IconUpload, IconTrash, IconImage, IconPlus } from '../icons.jsx';

const LONG_TEXT = /desc|body|text|summary|content|bio|excerpt|about|intro|paragraph|caption|quote/i;

export function FieldEditor({ field, value, onChange, ctx }) {
  const t = field.type;
  const label = field.title;
  if (/^slug$/i.test(field.title) || field.id === ctx.col.slugFieldId) return <SlugField {...{ field, value, onChange, ctx }} />;
  if (/CollectionReference/.test(t)) return t.startsWith('Multi') ? <MultiRefField {...{ field, value, onChange, ctx }} /> : <RefField {...{ field, value, onChange, ctx }} />;
  switch (t) {
    case 'String': {
      const v = value?.v ?? '';
      const long = LONG_TEXT.test(label) || String(v).length > 90 || String(v).includes('\n');
      return long
        ? <TextArea size="sm" label={label} value={v} rows={Math.min(10, Math.max(3, Math.ceil(String(v).length / 48)))} onChange={x => onChange({ t: 'string', v: x })} />
        : <TextInput size="sm" autoComplete="off" label={label} value={v} onChange={x => onChange({ t: 'string', v: x })} />;
    }
    case 'RichText':
      if (value?.t === 'richtextRef') return <ReadOnly label={label} note="This rich text is stored separately by Webflow. Edit it in Webflow and export again." />;
      return <RichTextField label={label} value={value} onChange={onChange} />;
    case 'Boolean':
      return <Switch size="sm" label={label} value={!!value?.v} onChange={x => onChange({ t: 'boolean', v: x })} />;
    case 'Number':
      return <NumberInput size="sm" label={label} value={value?.v ?? null} onChange={x => onChange({ t: 'number', v: Number(x) || 0 })} />;
    case 'Date': {
      const iso = value?.v ? String(value.v).slice(0, 10) : undefined;
      return <DateInput size="sm" label={label} value={iso} onChange={x => onChange(x ? { t: 'date', v: new Date(x + 'T00:00:00.000Z').toISOString() } : { t: 'null', v: null })} />;
    }
    case 'Color':
      return (
        <div>
          <div className="fx-label">{label}</div>
          <div className="fx-color">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(value?.v || '') ? value.v : '#000000'} onChange={e => onChange({ t: 'color', v: e.target.value })} aria-label={label} />
            <TextInput size="sm" autoComplete="off" label={label} isLabelHidden value={value?.v || ''} onChange={x => onChange({ t: 'color', v: x })} />
          </div>
        </div>
      );
    case 'Link': {
      const raw = value?.v;
      const url = raw && typeof raw === 'object' ? (raw.url || raw.href || '') : (raw || '');
      return <TextInput size="sm" autoComplete="off" type="url" label={label} value={url} placeholder="https://"
        onChange={x => onChange(x ? { t: 'link', v: raw && typeof raw === 'object' ? { ...raw, url: x } : x } : { t: 'null', v: null })} />;
    }
    case 'Enum':
      return <EnumField {...{ field, value, onChange, ctx }} />;
    case 'ResponsiveImage': case 'Image':
      return <ImageField {...{ field, value, onChange, ctx }} />;
    case 'File':
      return <FileField {...{ field, value, onChange, ctx }} />;
    default:
      if (value?.t === 'string') return <TextInput size="sm" autoComplete="off" label={label} value={value.v} onChange={x => onChange({ t: 'string', v: x })} />;
      return <ReadOnly label={label} note={`${t || 'This field'} can't be edited here yet. Edit it in Webflow and export again.`} />;
  }
}

function ReadOnly({ label, note }) {
  return (
    <div>
      <div className="fx-label">{label}</div>
      <Text type="supporting" color="secondary">{note}</Text>
    </div>
  );
}

function SlugField({ field, value, onChange, ctx }) {
  const v = value?.v ?? '';
  const title = itemTitle(ctx.col, ctx.item);
  const taken = ctx.col.items.some(i => i.key !== ctx.item.key && i.status !== 'deleted' && i.data[field.id]?.v === v);
  return (
    <VStack gap={1}>
      <TextInput size="sm" autoComplete="off" label={field.title} value={v} startIcon={undefined}
        description={ctx.col.pagePrefix ? `Page address: /${ctx.col.pagePrefix}/${v || '…'}` : undefined}
        status={taken ? { type: 'error', message: 'Another item already uses this slug' } : !v ? { type: 'warning', message: 'Slug is empty' } : undefined}
        onChange={x => onChange({ t: 'string', v: x.toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-').slice(0, 80) })} />
      <HStack>
        <Button size="sm" variant="ghost" label="Generate from title" onClick={() => onChange({ t: 'string', v: slugify(title) })} />
      </HStack>
    </VStack>
  );
}

function EnumField({ field, value, onChange, ctx }) {
  const options = useMemo(() => {
    const set = new Set();
    ctx.col.items.forEach(i => { const v = i.data[field.id]; if (v?.v) set.add(String(v.v)); });
    (field.options || []).forEach(o => set.add(typeof o === 'string' ? o : o.value));
    return [...set].map(v => ({ value: v, label: (field.optionLabels || {})[v] || v }));
  }, [ctx.col.items, field]);
  return <Selector size="sm" label={field.title} options={options} value={value?.v || ''} onChange={x => onChange({ t: 'enum', v: x })} placeholder="Choose…" />;
}

function refCollection(field, ctx) {
  return ctx.state.collections.find(c => c.id === field.ref) || null;
}

function RefField({ field, value, onChange, ctx }) {
  const target = refCollection(field, ctx);
  const options = (target?.items || []).filter(i => i.status !== 'deleted').map(i => ({ value: i.data.id.v, label: itemTitle(target, i) }));
  if (!target) return <ReadOnly label={field.title} note="Linked collection wasn't found in this export." />;
  return <Selector size="sm" label={field.title} description={`From ${target.name}`} options={options} hasSearch={options.length > 8} hasClear
    value={value?.t === 'string' ? value.v : ''} placeholder="None"
    onChange={x => onChange(x ? { t: 'string', v: x } : { t: 'null', v: null })} />;
}

function MultiRefField({ field, value, onChange, ctx }) {
  const target = refCollection(field, ctx);
  const ids = value?.t === 'array' ? value.v.map(x => x.v) : [];
  if (!target) return <ReadOnly label={field.title} note="Linked collection wasn't found in this export." />;
  const all = target.items.filter(i => i.status !== 'deleted');
  const options = all.filter(i => !ids.includes(i.data.id.v)).map(i => ({ value: i.data.id.v, label: itemTitle(target, i) }));
  const set = next => onChange({ t: 'array', v: next.map(v => ({ t: 'string', v })) });
  return (
    <VStack gap={1}>
      <div className="fx-label">{field.title} <small>from {target.name}</small></div>
      <HStack gap={1} wrap="wrap">
        {ids.map(id => {
          const it = all.find(i => i.data.id.v === id);
          return <Token key={id} label={it ? itemTitle(target, it) : id} onRemove={() => set(ids.filter(x => x !== id))} />;
        })}
        {!ids.length && <Text type="supporting" color="secondary">None selected</Text>}
      </HStack>
      {options.length > 0 && <Selector size="sm" label={`Add ${field.title}`} isLabelHidden options={options} value="" placeholder={`Add from ${target.name}…`} onChange={x => x && set([...ids, x])} />}
    </VStack>
  );
}

// ── Images & files ───────────────────────────────────────────────────────────
function pickFile(accept) {
  return new Promise(res => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => res(input.files?.[0] || null);
    input.click();
  });
}
async function fileToUpload(file, ctx, kind) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = slugify(file.name.replace(/\.[^.]+$/, '')).slice(0, 40) || kind;
  const path = `images/uploads/${base}-${Date.now().toString(36)}.${ext}`;
  return { path, bytes };
}
function imageSize(file) {
  return new Promise(res => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { res({ w: 0, h: 0 }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// Websites can only show JPG/PNG/WebP/GIF/AVIF/SVG. iPhone HEIC photos are
// converted to JPG, other images the browser can read (BMP, TIFF…) to WebP.
// Anything else is refused with a message that says why — so a broken image
// never reaches the site and nobody wonders what happened.
export const IMAGE_FORMATS = 'JPG, PNG, WebP, GIF, AVIF, SVG or iPhone HEIC';
const WEB_IMAGE = /^image\/(jpeg|png|webp|gif|avif|svg\+xml)$/;
const formatOf = file => (file.name.includes('.') ? file.name.split('.').pop() : file.type.split('/').pop() || 'unknown').toUpperCase();
const refuse = (file, why) => new Error(`"${file.name}" can't be used: ${why} Upload a ${IMAGE_FORMATS} image instead.`);
async function decodable(blob) {
  try { const b = await createImageBitmap(blob); return b; } catch { return null; }
}
async function toWebImage(file) {
  const fmt = formatOf(file);
  const isHeic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
  if (!file.size) throw refuse(file, 'the file is empty.');
  const looksImage = file.type.startsWith('image/') || isHeic || /\.(jpe?g|png|webp|gif|avif|svg|bmp|tiff?|ico)$/i.test(file.name);
  if (!looksImage) throw refuse(file, `${fmt} files aren't images.`);
  if (file.type === 'image/svg+xml') return file;
  if (WEB_IMAGE.test(file.type) && !isHeic) {
    const ok = await decodable(file);
    if (!ok) throw refuse(file, `the ${fmt} file looks damaged or isn't really a ${fmt}.`);
    ok.close?.();
    return file;
  }
  // iPhone photos: Chrome can't read them, so use the bundled decoder
  // (cms/assets/heic.js, only downloaded when someone uploads one)
  if (isHeic) {
    try {
      const { heicTo } = await import(/* @vite-ignore */ new URL('./heic.js', import.meta.url).href);
      const jpg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
      return new File([jpg], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch (e) {
      console.warn('[cms] HEIC decode failed', e);
      throw refuse(file, 'this HEIC photo couldn\'t be converted (on a Mac: open it in Preview → File → Export → JPEG).');
    }
  }
  // Other formats the browser can read → WebP (keeps transparency)
  const bmp = await decodable(file);
  if (!bmp) throw refuse(file, `${fmt} images can't be shown on websites.`);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.9));
  if (!blob) throw refuse(file, `this ${fmt} image couldn't be converted.`);
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
}

// Big photos make sites slow and hit host upload limits. Anything over
// 1.5 MB or 2560 px is resized (longest side 2560 px) and saved as WebP,
// which keeps transparency. GIFs (animation) and SVGs are left alone.
const MAX_SIDE = 2560;
async function optimizeImage(file) {
  if (/^image\/(gif|svg\+xml)$/.test(file.type)) return file;
  const bmp = await decodable(file);
  if (!bmp) return file;
  const big = Math.max(bmp.width, bmp.height);
  if (file.size <= 1.5 * 1024 * 1024 && big <= MAX_SIDE) { bmp.close?.(); return file; }
  const k = Math.min(1, MAX_SIDE / big);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.85));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
}

function ImageField({ field, value, onChange, ctx }) {
  const v = value?.v && typeof value.v === 'object' ? value.v : value?.v ? { src: value.v } : null;
  const src = v ? (ctx.previewUrl(v.src) || resolveImage(v.src, ctx.state.manifest.imageMap)) : null;
  const replace = async () => {
    const picked = await pickFile('image/*');
    if (!picked) return;
    let file;
    try { file = await optimizeImage(await toWebImage(picked)); } catch (e) { ctx.toast(e.message, 'error'); return; }
    if (file.size > 3 * 1024 * 1024) ctx.toast(`This image is still ${(file.size / 1048576).toFixed(1)} MB after optimizing. It works on your computer, but Vercel and GitHub only accept up to 3 MB.`, 'info');
    const { path, bytes } = await fileToUpload(file, ctx, 'image');
    const { w, h } = await imageSize(file);
    ctx.addUpload(path, bytes); // same step as onChange: never an unused upload in between
    onChange({ t: 'image', v: { src: path, alt: v?.alt || '', ...(w ? { pixelWidth: w, pixelHeight: h } : {}) } });
  };
  return (
    <div className="fx-image-field">
      <div className="fx-label">{field.title}</div>
      {src ? <img className="fx-image-preview" src={src} alt={v?.alt || ''} />
        : <button type="button" className="fx-image-empty" onClick={replace}><VStack gap={1} hAlign="center"><IconImage size={22} /><span>Add image</span><span className="fx-image-formats">JPG, PNG, WebP, GIF, SVG, HEIC</span></VStack></button>}
      <HStack gap={1}>
        <Button size="sm" variant="secondary" icon={<IconUpload />} label={src ? 'Replace' : 'Upload'} onClick={replace} />
        {src && <Button size="sm" variant="ghost" icon={<IconTrash />} label="Remove" onClick={() => onChange({ t: 'null', v: null })} />}
      </HStack>
      {v && <TextInput size="sm" autoComplete="off" label="Alt text" description="Describes the image for screen readers and Google" value={v.alt || ''}
        onChange={x => onChange({ t: 'image', v: { ...v, alt: x } })} />}
    </div>
  );
}

function FileField({ field, value, onChange, ctx }) {
  const url = value?.v || '';
  const replace = async () => {
    const file = await pickFile('*/*');
    if (!file) return;
    const { path, bytes } = await fileToUpload(file, ctx, 'file');
    ctx.addUpload(path, bytes);
    onChange({ t: 'file', v: path });
  };
  return (
    <VStack gap={1}>
      <div className="fx-label">{field.title}</div>
      {url ? <Text type="supporting" maxLines={1}>{String(url).split('/').pop().split('?')[0]}</Text> : <Text type="supporting" color="secondary">No file</Text>}
      <HStack gap={1}>
        <Button size="sm" variant="secondary" icon={<IconUpload />} label={url ? 'Replace file' : 'Upload file'} onClick={replace} />
        {url && <Button size="sm" variant="ghost" label="Remove" onClick={() => onChange({ t: 'null', v: null })} />}
      </HStack>
    </VStack>
  );
}

// ── Rich text ────────────────────────────────────────────────────────────────
function RichTextField({ label, value, onChange }) {
  const ref = useRef(null);
  const lastEmitted = useRef(null);
  const html = useMemo(() => richTextToHtml(value?.v || ''), [value?.v]);

  // Only rewrite the DOM when the value changed from outside (not while typing)
  useEffect(() => {
    if (!ref.current) return;
    if (value?.v !== lastEmitted.current) ref.current.innerHTML = html;
  }, [html, value?.v]);

  const emit = () => {
    if (!ref.current) return;
    const tree = htmlToRichText(ref.current.innerHTML);
    lastEmitted.current = tree;
    onChange({ t: 'richtext', v: tree });
  };
  const cmd = (c, arg) => { ref.current?.focus(); document.execCommand(c, false, arg); emit(); };
  const block = tag => cmd('formatBlock', tag);
  const link = () => { const url = prompt('Link URL', 'https://'); if (url) cmd('createLink', url); };

  return (
    <div>
      <div className="fx-label">{label}</div>
      <div className="fx-rt">
        <div className="fx-rt-bar" role="toolbar" aria-label={`${label} formatting`}>
          <button type="button" className="fx-rt-btn" onMouseDown={e => e.preventDefault()} onClick={() => block('P')}>¶</button>
          <button type="button" className="fx-rt-btn" onMouseDown={e => e.preventDefault()} onClick={() => block('H2')}>H2</button>
          <button type="button" className="fx-rt-btn" onMouseDown={e => e.preventDefault()} onClick={() => block('H3')}>H3</button>
          <button type="button" className="fx-rt-btn" aria-label="Bold" onMouseDown={e => e.preventDefault()} onClick={() => cmd('bold')}><IconBold size={14} /></button>
          <button type="button" className="fx-rt-btn" aria-label="Italic" onMouseDown={e => e.preventDefault()} onClick={() => cmd('italic')}><IconItalic size={14} /></button>
          <button type="button" className="fx-rt-btn" aria-label="Link" onMouseDown={e => e.preventDefault()} onClick={link}><IconLink size={14} /></button>
          <button type="button" className="fx-rt-btn" aria-label="Bulleted list" onMouseDown={e => e.preventDefault()} onClick={() => cmd('insertUnorderedList')}><IconList size={14} /></button>
          <button type="button" className="fx-rt-btn" aria-label="Numbered list" onMouseDown={e => e.preventDefault()} onClick={() => cmd('insertOrderedList')}><IconListOl size={14} /></button>
          <button type="button" className="fx-rt-btn" aria-label="Quote" onMouseDown={e => e.preventDefault()} onClick={() => block('BLOCKQUOTE')}><IconQuote size={14} /></button>
        </div>
        <div ref={ref} className="fx-rt-area" contentEditable suppressContentEditableWarning
          role="textbox" aria-multiline="true" aria-label={label}
          onInput={emit} onBlur={emit}
          onPaste={e => { e.preventDefault(); const text = e.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); }} />
      </div>
    </div>
  );
}

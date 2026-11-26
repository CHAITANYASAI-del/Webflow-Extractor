import { useEffect, useRef, useState } from 'react';
import { TextInput } from '@astryxdesign/core/TextInput';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { itemTitle, itemImage } from '../core/site.js';
import { IconDatabase, IconPlug, IconExport, IconSettings, IconPlus, IconSearch, IconImage, IconChevron, IconPage } from '../icons.jsx';

export function NavTabs({ view, setView }) {
  const tabs = [
    { id: 'content', label: 'Content', icon: <IconDatabase size={15} /> },
    { id: 'integrations', label: 'Export', icon: <IconExport size={15} /> },
  ];
  return (
    <nav className="fx-nav-tabs" aria-label="Admin sections">
      {tabs.map(t => (
        <button key={t.id} type="button" className="fx-nav-tab" aria-current={view === t.id} onClick={() => setView(t.id)}>
          {t.icon}<span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Thumb({ src, textOnly }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  // Collections without image fields (e.g. Categories) get a text tile
  if (textOnly) return <span className="fx-item-thumb is-text" aria-hidden="true">T</span>;
  if (!src || bad) return <span className="fx-item-thumb"><IconImage size={12} /></span>;
  return <img className="fx-item-thumb" src={src} alt="" loading="lazy" onError={() => setBad(true)} />;
}

export function ContentTree({ state, selected, onSelect, onAdd, resolveThumb }) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState({});
  const selRef = useRef(null);
  const query = q.trim().toLowerCase();

  // Keep the selected layer in view (e.g. after clicking inside the preview)
  useEffect(() => { selRef.current?.scrollIntoView({ block: 'nearest' }); }, [selected?.key]);

  if (!state.collections.length) {
    return <div style={{ padding: 16 }}><Text type="supporting" color="secondary">This site has no CMS collections. Static pages can be edited in their HTML files.</Text></div>;
  }
  return (
    <>
      <div className="fx-side-search">
        <TextInput label="Search content" isLabelHidden placeholder="Search…" size="sm" value={q} onChange={setQ} startIcon={() => <IconSearch size={13} />} hasClear autoComplete="off" />
      </div>
      <div className="fx-side-scroll" role="tree" aria-label="CMS content">
        {state.collections.map(col => {
          const items = col.items.filter(i => !query || itemTitle(col, i).toLowerCase().includes(query));
          const isClosed = closed[col.id] && !query;
          const live = col.items.filter(i => i.status !== 'deleted').length;
          const changed = col.items.filter(i => i.status !== 'clean').length;
          return (
            <section className="fx-col" key={col.id} role="group" aria-label={col.name}>
              <div className="fx-col-head">
                <button type="button" className="fx-col-toggle" aria-expanded={!isClosed} onClick={() => setClosed(c => ({ ...c, [col.id]: !c[col.id] }))}>
                  <IconChevron size={12} className={isClosed ? '' : 'open'} />
                  <IconDatabase size={13} />
                  <span className="fx-col-name">{col.name}</span>
                  <span className="fx-col-count">{live}</span>
                  {changed > 0 && <span className="fx-dot edited" title={`${changed} unpublished`} />}
                </button>
                <IconButton size="sm" variant="ghost" label={`Add ${col.name} item`} tooltip={`New ${col.name.replace(/s$/i, '')}`} icon={<IconPlus size={13} />} onClick={() => onAdd(col.id)} />
              </div>
              {!isClosed && items.map(it => {
                const isSel = selected?.colId === col.id && selected?.key === it.key;
                return (
                  <button type="button" role="treeitem" aria-selected={isSel} key={it.key} ref={isSel ? selRef : null}
                    className={`fx-item ${it.status === 'deleted' ? 'is-deleted' : ''}`} aria-current={isSel}
                    onClick={() => onSelect({ colId: col.id, key: it.key })}
                    onDoubleClick={() => onSelect({ colId: col.id, key: it.key }, { open: true })}
                    title={it.page ? `/${it.page}` : undefined}>
                    <Thumb textOnly={!col.fields.some(f => /Image/.test(f.type))} src={resolveThumb(itemImage(col, it, state.manifest.imageMap), col, it)} />
                    <span className="fx-item-title">{itemTitle(col, it)}</span>
                    {it.status !== 'clean' && <span className={`fx-dot ${it.status}`} title={{ edited: 'Edited', new: 'New', deleted: 'Will be deleted' }[it.status]} />}
                  </button>
                );
              })}
              {!isClosed && !items.length && <div className="fx-empty-row">{query ? 'No matches' : 'No items yet'}</div>}
            </section>
          );
        })}
      </div>
    </>
  );
}

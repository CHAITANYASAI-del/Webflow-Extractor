import { useEffect, useRef, useState } from 'react';
import { IconChevronDown } from '../icons.jsx';

// Figma-style main menu: click the logo/name to open settings and actions
export function AppMenu({ logoUrl, title, subtitle, items, footer }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="fx-menu" ref={ref}>
      <button type="button" className="fx-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <img className="fx-logo" src={logoUrl} alt="" />
        <span className="fx-brand-name">{title}</span>
        <span className="fx-brand-pill">{subtitle}</span>
        <span className="fx-menu-caret" aria-hidden="true"><IconChevronDown size={12} /></span>
      </button>
      {open && (
        <div className="fx-menu-pop" role="menu">
          {items.map((it, i) => it.divider
            ? <div key={i} className="fx-menu-sep" role="separator" />
            : (
              <button key={i} type="button" role="menuitem" className={`fx-menu-item ${it.danger ? 'is-danger' : ''}`} disabled={it.disabled}
                onClick={() => { setOpen(false); it.onSelect?.(); }}>
                {it.icon}<span>{it.label}</span>
              </button>
            ))}
          {footer && <><div className="fx-menu-sep" role="separator" />{footer}</>}
        </div>
      )}
    </div>
  );
}

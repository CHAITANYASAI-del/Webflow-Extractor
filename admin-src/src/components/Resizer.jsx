import { useCallback, useEffect, useState } from 'react';

// Panel widths that can be dragged (Framer/Figma style) and are remembered
const load = (k, d) => { try { const v = Number(localStorage.getItem(k)); return v > 0 ? v : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };

export function usePanelWidth(key, def, min, max) {
  const [w, setW] = useState(() => Math.min(max, Math.max(min, load(key, def))));
  useEffect(() => { save(key, w); }, [key, w]);
  return [w, v => setW(Math.min(max, Math.max(min, Math.round(v))))];
}

// side: 'right' = handle on the right edge of a left panel (drag right → wider)
export function Resizer({ side, width, setWidth, label }) {
  const onPointerDown = useCallback(e => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    document.body.classList.add('fx-resizing');
    const move = ev => setWidth(startW + (side === 'right' ? ev.clientX - startX : startX - ev.clientX));
    const up = () => {
      document.body.classList.remove('fx-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [side, width, setWidth]);

  return (
    <div className={`fx-resizer fx-resizer-${side}`} role="separator" aria-orientation="vertical" aria-label={label}
      tabIndex={0} onPointerDown={onPointerDown}
      onKeyDown={e => { if (e.key === 'ArrowLeft') setWidth(width + (side === 'right' ? -16 : 16)); if (e.key === 'ArrowRight') setWidth(width + (side === 'right' ? 16 : -16)); }}
      onDoubleClick={() => setWidth(side === 'right' ? 264 : 320)} title="Drag to resize · double-click to reset" />
  );
}

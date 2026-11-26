import { useEffect, useRef } from 'react';

// Small confirm dialog with a clear red destructive action
export function ConfirmDialog({ isOpen, title, description, confirmLabel, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    if (!isOpen) return;
    cancelRef.current?.focus();
    const esc = e => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [isOpen, onCancel]);
  if (!isOpen) return null;
  return (
    <div className="fx-confirm-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="fx-confirm" role="alertdialog" aria-modal="true" aria-labelledby="fx-confirm-title" aria-describedby="fx-confirm-desc">
        <h2 id="fx-confirm-title">{title}</h2>
        <p id="fx-confirm-desc">{description}</p>
        <div className="fx-confirm-actions">
          <button ref={cancelRef} type="button" className="fx-btn-quiet" onClick={onCancel}>Cancel</button>
          <button type="button" className="fx-btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

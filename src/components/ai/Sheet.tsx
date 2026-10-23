import { useEffect, type ReactNode } from 'react';

/** Side panel on wide screens, full screen on phones. Escape closes it. */
export function Sheet({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          {actions}
          <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}>
            ✕
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}

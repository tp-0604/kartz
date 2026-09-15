// A button that opens a panel under itself, positioned so it never leaves the window. Used for
// every menu in the toolbar, so they all behave the same way and close the same way.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function Dropdown({ label, title, className = 'btn btn--sm', width = 260,
                                   align = 'left', disabled, children, onOpen }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const panel = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const b = btn.current.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const left = align === 'right' ? Math.max(8, b.right - w) : Math.min(b.left, window.innerWidth - w - 8);
    setPos({ left, top: b.bottom + 4, width: w, maxHeight: window.innerHeight - b.bottom - 16 });
  }, [open, width, align]);

  useEffect(() => {
    if (!open) return;
    const away = e => {
      if (panel.current && panel.current.contains(e.target)) return;
      if (btn.current && btn.current.contains(e.target)) return;
      setOpen(false);
    };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className={className + (open ? ' is-on' : '')} title={title}
              disabled={disabled} aria-expanded={open}
              onClick={() => { const next = !open; setOpen(next); if (next && onOpen) onOpen(); }}>
        {label}
      </button>
      {open && pos && createPortal(
        <div ref={panel} className="menu" style={pos} role="menu">
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>, document.body)}
    </>
  );
}

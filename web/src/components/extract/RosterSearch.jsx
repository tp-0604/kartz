// A search box with a list we control the size of.
//
// A native <select> of several hundred players opens a list as tall as the page and cannot
// be typed into; a <datalist> can be typed into but the browser decides how tall its popup
// is. So the list is drawn here: filtered as you type, capped at a couple of hundred pixels,
// scrolled inside itself, and positioned fixed so the scrolling table cannot clip it.
//
// Typing decides nothing. A row is answered only by choosing an entry or pressing Enter, so
// an edit opened by accident costs nothing: leave, and it goes back exactly as it was.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fold, symKey } from '../../extractor/matching.js';

const NEW = 'new';

export default function RosterSearch({ roster, initial = '', onCommit, onCancel, autoFocus = true, commitOnBlur = false, placeholder = 'type to search…', className = 'pickbox' }) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(1);
  const [pos, setPos] = useState(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const picking = useRef(false);

  const q = fold(value);
  const hits = (q ? roster.filter(r => fold(r.search).includes(q) || fold(r.ingame).includes(q)
                                    || (symKey(q) && symKey(r.ingame).includes(symKey(q))))
                  : roster).slice(0, 60);
  const items = [
    { v: NEW, label: value.trim() ? `New player — keep “${value.trim()}”` : 'New player', isNew: true },
    ...hits.map(r => {
      const shown = (r.ingame || r.search).trim();
      return { v: shown, label: shown, alliance: r.alliance || '',
               hint: fold(shown) === fold(r.search) ? '' : r.search };
    }),
  ];

  const place = () => {
    const el = inputRef.current; if (!el) return;
    const b = el.getBoundingClientRect();
    const below = window.innerHeight - b.bottom;
    setPos(below < 220 && b.top > below
      ? { left: b.left, width: Math.max(b.width, 200), bottom: window.innerHeight - b.top + 4 }
      : { left: b.left, width: Math.max(b.width, 200), top: b.bottom + 4 });
  };
  useLayoutEffect(() => { if (open) place(); }, [open, value]);
  useEffect(() => {
    if (!open) return;
    const follow = e => { if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return; place(); };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => { window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
  }, [open]);
  useEffect(() => { if (autoFocus && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [autoFocus]);
  useEffect(() => { setAt(hits.length ? 1 : 0); }, [value, hits.length]);

  const choose = item => {
    picking.current = true;
    setOpen(false);
    if (item.isNew) onCommit(value.trim());
    else { setValue(item.v); onCommit(item.v); }
    picking.current = false;
  };

  const onKeyDown = e => {
    if (e.key === 'Escape') { setOpen(false); if (!commitOnBlur) onCancel && onCancel(); return; }
    if (!open) { if (e.key === 'ArrowDown') { setOpen(true); e.preventDefault(); } else if (e.key === 'Enter') { e.preventDefault(); onCommit(value.trim()); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAt(i => e.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[at] || items[0]);
    }
  };
  const onBlur = () => {
    setTimeout(() => {
      if (picking.current) return;
      setOpen(false);
      if (commitOnBlur) onCommit(value.trim()); else onCancel && onCancel();
    }, 0);
  };
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const el = menuRef.current.querySelector('.on');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [at, open]);

  return (
    <>
      <input ref={inputRef} className={className} value={value} placeholder={placeholder} spellCheck={false} autoComplete="off"
             onChange={e => { setValue(e.target.value); setOpen(true); }}
             onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
             onKeyDown={onKeyDown} onBlur={onBlur} />
      {open && pos && createPortal(
        <div ref={menuRef} className="menu" style={pos} onMouseDown={e => e.preventDefault()}>
          {items.map((it, i) => (
            <div key={it.isNew ? NEW : it.v + i} className={(it.isNew ? 'newopt' : '') + (i === at ? ' on' : '')}
                 onMouseDown={e => { e.preventDefault(); choose(it); }} onMouseEnter={() => setAt(i)}>
              {it.label}
              {!it.isNew && <span>{it.alliance}{it.hint ? ` · ${it.hint}` : ''}</span>}
            </div>
          )).flatMap((el, i) => (i === 0 ? [el, <hr key="hr" />] : [el]))}
          {hits.length === 0 && <div className="none">no roster name matches that</div>}
        </div>,
        document.body)}
    </>
  );
}

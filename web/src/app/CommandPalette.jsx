/**
 * ⌘K. Everything the application can do, and everything it holds, in one list.
 *
 * It is not a search box with commands bolted on: a board, a player and an action are all just
 * things you can go to, so they are all in the same list and typing narrows all of them at once.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

const score = (text, q) => {
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const i = t.indexOf(q);
  if (i >= 0) return 60 - Math.min(20, i);
  // Every letter in order, anywhere: "69w1" finds "698W · Day 1".
  let at = 0;
  for (const ch of q) { at = t.indexOf(ch, at); if (at < 0) return 0; at++; }
  return 20;
};

export default function CommandPalette({ open, onClose, commands }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const listRef = useRef(null);

  useEffect(() => { if (open) { setQ(''); setAt(0); } }, [open]);

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands.slice(0, 40);
    return commands
      .map(c => ({ c, s: Math.max(score(c.label, t), score(c.group || '', t) * 0.4) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map(x => x.c);
  }, [commands, q]);

  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector('.on');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [at, hits]);

  if (!open) return null;

  const run = c => { onClose(); if (c) setTimeout(() => c.run(), 0); };

  // The group heading is drawn once, before the first item that belongs to it.
  let lastGroup = null;

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Commands">
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} spellCheck={false}
               placeholder="Go to a board, a view, or do something…"
               onKeyDown={e => {
                 if (e.key === 'Escape') { e.preventDefault(); onClose(); }
                 else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(i + 1, hits.length - 1)); }
                 else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(i - 1, 0)); }
                 else if (e.key === 'Enter') { e.preventDefault(); run(hits[at]); }
               }} />
        <div className="palette__list" ref={listRef}>
          {hits.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head && <div className="palette__group">{head}</div>}
                <button type="button" className={'palette__item' + (i === at ? ' on' : '')}
                        onMouseEnter={() => setAt(i)} onClick={() => run(c)}>
                  <span className="palette__kind">{c.kind || ''}</span>
                  <span className="truncate">{c.label}</span>
                  {c.where && <span className="palette__where">{c.where}</span>}
                </button>
              </div>
            );
          })}
          {!hits.length && <div className="palette__empty">Nothing matches “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}

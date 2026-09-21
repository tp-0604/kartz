/**
 * The rail: what you can do, and where everything is.
 *
 * It never leaves, which is the whole point — no back button, no breadcrumbs, and moving from
 * TC to Members is one press rather than three. Sections wear their own covers, so after a day
 * of use you find Seal Stone by its stripes rather than by reading twelve names.
 *
 * What it holds depends on who you are. A member came here to send a recording, so Extract sits
 * at the top and their own boards under it; the sections are below, to look at. An admin gets
 * the same rail with everything on it.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { isAdmin } from '../utils/roles.js';
import { store } from '../utils/storage.js';
import Cover from './Cover.jsx';
import { useSections } from './FilesScreen.jsx';

const RECENTS = 'files.recent';

/** The last three files opened, so the thing you are working on is never more than one press. */
export function rememberOpened(file) {
  if (!file || !file.id) return;
  const was = (store.get(RECENTS) || []).filter(x => x && x.id !== file.id);
  store.set(RECENTS, [{ id: file.id, name: file.name }, ...was].slice(0, 3));
}
export const recentlyOpened = () => (store.get(RECENTS) || []).filter(x => x && x.id);

const short = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0));

function Item({ glyph, cover, seed, title, line, current, onClick, go, onPeek }) {
  return (
    <button type="button" className={'rail__item' + (go ? ' rail__item--go' : '')}
            aria-current={current ? 'true' : undefined} onClick={onClick} title={title}
            onMouseEnter={onPeek ? e => onPeek(e.currentTarget) : undefined}
            onMouseLeave={onPeek ? () => onPeek(null) : undefined}
            onFocus={onPeek ? e => onPeek(e.currentTarget) : undefined}
            onBlur={onPeek ? () => onPeek(null) : undefined}>
      {cover !== undefined
        ? <Cover cover={cover} seed={seed || title} className="rail__cover" />
        : <span className="rail__glyph" aria-hidden="true">{glyph}</span>}
      <span className="rail__words">
        <b>{title}</b>
        {line ? <small>{line}</small> : null}
      </span>
    </button>
  );
}

export default function Rail({ narrow }) {
  const { mode, go, user, section, openSection, openFile, fileOpen, boards, datasets,
          openInData, tree } = useApp();
  const sections = useSections();
  const admin = isAdmin(user);
  const mine = (boards || []).length;
  const [recent, setRecent] = useState(recentlyOpened);
  const [peek, setPeek] = useState(null);

  // The recents change as files are opened, which happens elsewhere.
  useEffect(() => { setRecent(recentlyOpened()); }, [fileOpen, mode]);

  const peekAt = (sec, el) => {
    if (!el || narrow) { setPeek(null); return; }
    const box = el.getBoundingClientRect();
    setPeek({ section: sec, top: Math.max(58, box.top) });
  };

  return (
    <nav className={'rail' + (narrow ? ' rail--narrow' : '')} aria-label="Where everything is">
      <div className="rail__head">Do</div>
      <Item glyph="↑" title="Extract" line="or drop anywhere" go
            current={mode === 'extract'} onClick={() => go('extract')} />
      {!admin && (
        <Item glyph="▦" title="My boards" line={mine ? `${mine} in the database` : 'none yet'}
              current={mode === 'home'} onClick={() => go('home')} />
      )}
      {admin && (
        <Item glyph="▦" title="Boards" line={mine ? `${mine} extracted` : 'none yet'}
              current={mode === 'home'} onClick={() => go('home')} />
      )}
      <Item glyph="☰" title="Roster" line={datasets ? `${datasets.roster.rows} players` : ''}
            onClick={() => openInData({ kind: 'dataset', key: 'roster' })} />

      {recent.length > 0 && (
        <>
          <hr className="rail__sep" />
          <div className="rail__head">Lately</div>
          {recent.map(r => (
            <Item key={r.id} glyph="◷" title={r.name}
                  current={!!fileOpen && fileOpen.id === r.id}
                  onClick={() => openFile(r.id)} />
          ))}
        </>
      )}

      <hr className="rail__sep" />
      <div className="rail__head">Files</div>
      <Item glyph="◫" title="All files" current={mode === 'files' && !section && !fileOpen}
            onClick={() => openSection(null)} />
      {sections.map(s => (
        <Item key={s.id || s.name} cover={s.cover} seed={s.name} title={s.name}
              line={`${s.files.length} · ${short(s.cells)}`}
              current={mode === 'files' && section === s.id}
              onClick={() => openSection(s.id)}
              onPeek={el => peekAt(s, el)} />
      ))}

      {peek && peek.section && (
        <div className="peek" style={{ top: peek.top }} role="presentation">
          <b>{peek.section.name}</b>
          {peek.section.files.slice(0, 5).map(f => (
            <span key={f.id}>{f.name}</span>
          ))}
          {peek.section.files.length > 5 && (
            <small>and {peek.section.files.length - 5} more</small>
          )}
          {!peek.section.files.length && <small>nothing in it yet</small>}
        </div>
      )}
    </nav>
  );
}

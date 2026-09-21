/**
 * Everything that is not a board: folders, workbooks and their tabs.
 *
 * Three states, no page changes between them — the rail beside this never moves, so there is no
 * back button to hunt for and no breadcrumb to read. All sections, one section, one file.
 */
import { useEffect, useMemo } from 'react';
import { useApp } from '../state/AppContext.jsx';
import Cover from './Cover.jsx';
import FileView from './FileView.jsx';
import ImportDrop from './ImportDrop.jsx';
import { Empty } from '../components/shared/ui.jsx';

const short = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0));

/** Files and folders, grouped the way the rail groups them. */
export function useSections() {
  const { tree } = useApp();
  return useMemo(() => {
    if (!tree) return [];
    const tops = tree.folders.filter(f => !f.parent_id);
    // The imported tree is one folder deep under a single root; its children are the sections.
    const roots = tops.length === 1 ? tree.folders.filter(f => f.parent_id === tops[0].id) : tops;
    const sections = (roots.length ? roots : tops).map(folder => {
      const files = tree.files.filter(f => f.folder_id === folder.id);
      return {
        id: folder.id,
        name: folder.name,
        files,
        tabs: files.reduce((n, f) => n + (f.sheets || 0), 0),
        cells: files.reduce((n, f) => n + (f.cells || 0), 0),
        cover: files.map(f => f.cover).find(Boolean) || null,
        touched: files.map(f => f.updated_at).filter(Boolean).sort().pop() || null,
      };
    });
    const loose = tree.files.filter(f => !sections.some(s => s.id === f.folder_id)
                                      && (!tops.length || f.folder_id !== tops[0].id));
    const rootFiles = tops.length === 1 ? tree.files.filter(f => f.folder_id === tops[0].id) : loose;
    if (rootFiles.length) {
      sections.unshift({
        id: tops.length === 1 ? tops[0].id : null,
        name: tops.length === 1 ? tops[0].name : 'Loose files',
        files: rootFiles,
        tabs: rootFiles.reduce((n, f) => n + (f.sheets || 0), 0),
        cells: rootFiles.reduce((n, f) => n + (f.cells || 0), 0),
        cover: rootFiles.map(f => f.cover).find(Boolean) || null,
        touched: rootFiles.map(f => f.updated_at).filter(Boolean).sort().pop() || null,
      });
    }
    return sections.sort((a, b) => b.cells - a.cells);
  }, [tree]);
}

/**
 * A tile is its name, big and in the middle, over a design that is faded on purpose: the cover
 * says what kind of thing this is at a glance, and the word says which one it is.
 */
function Tile({ cover, title, line, note, onOpen, onPeek }) {
  return (
    <button type="button" className="tile" onClick={onOpen}
            onMouseEnter={onPeek ? () => onPeek(true) : undefined}
            onMouseLeave={onPeek ? () => onPeek(false) : undefined}>
      <Cover cover={cover} seed={title} className="tile__bg" />
      <span className="tile__cap">
        <b>{title}</b>
        <small>{line}</small>
        {note ? <em>{note}</em> : null}
      </span>
    </button>
  );
}

/** "3 days ago", near enough. What a tile needs is recent or not. */
export function ago(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  const months = Math.round(days / 30);
  return months === 1 ? 'a month ago' : months + ' months ago';
}

export default function FilesScreen() {
  const { tree, treeError, refreshTree, section, openSection, fileOpen, openFile, setFileOpen,
          droppedBooks, setDroppedBooks } = useApp();
  const sections = useSections();

  useEffect(() => { if (!tree) refreshTree(); }, [tree, refreshTree]);

  if (droppedBooks && droppedBooks.length) {
    return (
      <ImportDrop files={droppedBooks} folderId={section || null}
                  onCancel={() => setDroppedBooks(null)}
                  onDone={id => { setDroppedBooks(null); if (id) openFile(id); }} />
    );
  }

  if (treeError) {
    return (
      <div className="pane">
        <div className="note note--bad">Could not read the files: {treeError}</div>
        <button type="button" className="btn" onClick={refreshTree}>Try again</button>
      </div>
    );
  }
  if (!tree) return <div className="loading">Reading the files…</div>;

  if (fileOpen) {
    return (
      <FileView fileId={fileOpen.id} sheetIdx={fileOpen.sheetIdx}
                onBack={() => setFileOpen(null)} />
    );
  }

  const here = section ? sections.find(s => s.id === section) : null;

  if (here) {
    return (
      <div className="pane">
        <div className="pane__head">
          <h2>{here.name}</h2>
          <span className="hint">
            {here.files.length} file{here.files.length === 1 ? '' : 's'} · {here.tabs} tabs
            · {here.cells.toLocaleString()} cells
          </span>
        </div>
        {here.files.length ? (
          <div className="tiles">
            {here.files.map(f => (
              <Tile key={f.id} cover={f.cover} title={f.name}
                    line={`${f.sheets} tab${f.sheets === 1 ? '' : 's'} · ${short(f.cells)} cells`}
                    note={f.owner ? `sent by ${f.owner}` : ago(f.updated_at)}
                    onOpen={() => openFile(f.id)} />
            ))}
          </div>
        ) : (
          <Empty title="Nothing here yet">Drop a spreadsheet anywhere to put one in.</Empty>
        )}
      </div>
    );
  }

  const totals = sections.reduce((a, s) => ({
    files: a.files + s.files.length, tabs: a.tabs + s.tabs, cells: a.cells + s.cells,
  }), { files: 0, tabs: 0, cells: 0 });

  return (
    <div className="pane">
      <div className="pane__head">
        <h2>Files</h2>
        <span className="hint">
          {totals.files} files · {totals.tabs} tabs · {totals.cells.toLocaleString()} cells
        </span>
      </div>
      {sections.length ? (
        <div className="tiles">
          {sections.map(s => (
            <Tile key={s.id || s.name} cover={s.cover} title={s.name}
                  line={`${s.files.length} file${s.files.length === 1 ? '' : 's'} · ${s.tabs} tabs · ${short(s.cells)} cells`}
                  note={s.touched ? 'changed ' + ago(s.touched) : ''}
                  onOpen={() => openSection(s.id)} />
          ))}
        </div>
      ) : (
        <Empty title="No files yet">Drop a spreadsheet anywhere on the window to import one.</Empty>
      )}
    </div>
  );
}

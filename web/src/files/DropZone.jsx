/**
 * Drop a file anywhere on the window, on any screen.
 *
 * This is where the presses went. A recording goes to the extractor, a workbook is imported, a
 * csv becomes a sheet — and none of it needs you to find the right screen first. What a file is
 * is decided by its name and type, and anything else is refused with a sentence rather than
 * silently ignored.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { isAdmin } from '../utils/roles.js';

const VIDEO = /\.(mov|mp4|m4v|webm|avi|mkv)$/i;
const BOOK = /\.xlsx$/i;
const SHEETISH = /\.(csv|tsv)$/i;

const kindOf = file => {
  if (VIDEO.test(file.name) || /^video\//.test(file.type || '')) return 'recording';
  if (BOOK.test(file.name)) return 'workbook';
  if (SHEETISH.test(file.name)) return 'rows';
  if (/^image\//.test(file.type || '')) return 'image';
  return null;
};

const WORDS = {
  recording: ['Let go to read it', 'A recording, so it goes to the extractor'],
  workbook: ['Let go to import it', 'A workbook — every tab of it, as it looks'],
  rows: ['Let go to import it', 'Rows, which become a sheet of their own'],
  image: ['Not this, sorry', 'A picture on its own has nowhere to go yet'],
  none: ['Not a file this can read', 'Recordings, .xlsx workbooks and .csv rows'],
};

export default function DropZone() {
  const { go, setPendingFiles, user, notify, setDroppedBooks } = useApp();
  const [over, setOver] = useState(null);
  const depth = useRef(0);

  const kindOfList = useCallback(list => {
    const files = [...(list || [])];
    if (!files.length) return 'none';
    const kinds = files.map(kindOf);
    if (kinds.includes('recording')) return 'recording';
    if (kinds.includes('workbook')) return 'workbook';
    if (kinds.includes('rows')) return 'rows';
    if (kinds.includes('image')) return 'image';
    return 'none';
  }, []);

  useEffect(() => {
    const has = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');

    const onEnter = e => {
      if (!has(e)) return;
      depth.current++;
      e.preventDefault();
      // Before the drop a browser will not say what the files are, only that there are some.
      setOver('files');
    };
    const onOver = e => { if (has(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
    const onLeave = e => {
      if (!has(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(null);
    };
    const onDrop = e => {
      if (!has(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(null);
      const files = [...(e.dataTransfer.files || [])];
      if (!files.length) return;
      const kind = kindOfList(files);

      if (kind === 'recording') {
        setPendingFiles(files.filter(f => kindOf(f) === 'recording'));
        go('extract');
      } else if (kind === 'workbook' || kind === 'rows') {
        if (!isAdmin(user)) {
          notify('Importing a whole workbook is an admin’s. Ask one, or send a recording instead.', 'bad');
          return;
        }
        setDroppedBooks(files.filter(f => kindOf(f) === 'workbook' || kindOf(f) === 'rows'));
        go('files');
      } else if (kind === 'image') {
        notify('A picture on its own has nowhere to go yet. Pictures come in inside a workbook.', 'bad');
      } else {
        notify('That is not a file this can read. Recordings, .xlsx workbooks and .csv rows.', 'bad');
      }
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [go, kindOfList, notify, setDroppedBooks, setPendingFiles, user]);

  if (!over) return null;
  return (
    <div className="dropzone" aria-hidden="true">
      <div className="dropzone__box">
        <h3>Let go</h3>
        <p>A recording goes to the extractor. A workbook or a csv becomes a file.</p>
      </div>
    </div>
  );
}

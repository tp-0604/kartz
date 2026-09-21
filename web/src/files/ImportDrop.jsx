/**
 * A workbook dropped on the window, read in.
 *
 * The whole of it happens here in the browser: unzip, read every tab, decide what each one is,
 * compress the grid and send it a band at a time. The Worker never holds a file in memory and
 * never spends its CPU unzipping one — the same path the backload takes, which is why a file
 * dropped here lands identical to one that came in with the folder.
 *
 * It says what it is doing while it works, and what it cost when it is done.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import * as API from '../services/api.js';
import { readBook } from '../services/xlsxBook.js';
import { planImport, sendImport } from '../services/bookImport.js';

const step = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export default function ImportDrop({ files, folderId, onDone, onCancel }) {
  const { notify, refreshTree } = useApp();
  const [at, setAt] = useState({ i: 0, name: files[0] ? files[0].name : '', doing: 'Reading…' });
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    let dead = false;

    (async () => {
      const results = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (dead) return;
          setAt({ i, name: file.name, doing: 'Reading the workbook…' });
          const bytes = new Uint8Array(await file.arrayBuffer());
          const book = await readBook(bytes, { media: true });
          if (dead) return;

          setAt({ i, name: file.name, doing: `Working out ${step(book.sheets.length, 'tab')}…` });
          const plan = await planImport(book, {
            name: file.name.replace(/\.[^.]+$/, ''), sourceName: file.name, folderId,
          });
          if (dead) return;

          const out = await sendImport(plan, (method, path, body) => API.api(path, {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }), {
            putAsset: asset => API.putAsset(asset.id, asset.bytes, asset.mime),
            onStep: s => {
              if (dead) return;
              if (s.step === 'sheet') setAt({ i, name: file.name, doing: `Sending ${s.name}…` });
              else if (s.step === 'asset') setAt({ i, name: file.name, doing: 'Sending the pictures…' });
            },
          });
          results.push({ name: plan.file.name, ...out, report: plan.report });
        }
        if (dead) return;
        await refreshTree();
        setDone(results);
      } catch (e) {
        if (!dead) setError(e.message || String(e));
      }
    })();

    return () => { dead = true; };
  }, [files, folderId, refreshTree]);

  if (error) {
    return (
      <div className="pane">
        <div className="note note--bad">That workbook could not be read: {error}</div>
        <button type="button" className="btn" onClick={onCancel}>Close</button>
      </div>
    );
  }

  if (done) {
    const cells = done.reduce((n, d) => n + (d.cells || 0), 0);
    const sheets = done.reduce((n, d) => n + (d.sheets || 0), 0);
    const notes = done.flatMap(d => (d.report && d.report.notes) || []);
    return (
      <div className="pane">
        <div className="pane__head">
          <h2>{done.length === 1 ? done[0].name : `${done.length} files`} imported</h2>
          <span className="hint">{step(sheets, 'tab')} · {step(cells, 'cell')}</span>
        </div>
        {notes.length > 0 && (
          <div className="fileview__report" style={{ borderRadius: 'var(--r2)' }}>
            <b>What came across:</b> {notes.join(' · ')}
          </div>
        )}
        <div className="btnrow">
          <button type="button" className="btn btn--primary"
                  onClick={() => onDone(done[0] && done[0].fileId)}>Open it</button>
          <button type="button" className="btn" onClick={onCancel}>Stay here</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane__head">
        <h2>Reading {at.name}</h2>
        <span className="hint">{files.length > 1 ? `${at.i + 1} of ${files.length}` : ''}</span>
      </div>
      <div className="importing">
        <div className="importing__bar"><i /></div>
        <p className="hint">{at.doing}</p>
        <p className="hint">
          Everything happens in this browser: the file is unzipped, read and compressed here, and
          sent a band at a time.
        </p>
      </div>
    </div>
  );
}

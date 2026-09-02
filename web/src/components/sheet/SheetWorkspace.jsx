// The one place Univer is created. Loaded lazily by the Sheet screen, because the workbook is
// the largest thing in the bundle and the extractor screen — the one opened on a phone in
// front of the game — should not pay for it.
import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import CoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import SortEnUS from '@univerjs/preset-sheets-sort/locales/en-US';
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter';
import FilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-sort/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';
import { createSheetController } from '../../sheet/SheetController.js';
import { BUILD } from '../../extractor/config.js';

export default function SheetWorkspace({ onReady, unitId = 'kartz', name = 'Kartz', className = 'sheet-host' }) {
  const host = useRef(null);
  useEffect(() => {
    // React's StrictMode mounts, unmounts and mounts again in development. Univer is an
    // imperative engine that measures its container once and does not enjoy being created
    // twice against the same element, so creation is deferred a tick and the first, doomed
    // mount never creates anything at all.
    let alive = true, univerAPI = null, controller = null;
    const t = setTimeout(() => {
      if (!alive || !host.current) return;
      host.current.dataset.booting = '1';
      console.log('[kartz] creating the workbook, build', BUILD);
      ({ univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(CoreEnUS, SortEnUS, FilterEnUS) },
        presets: [
          UniverSheetsCorePreset({ container: host.current }),
          UniverSheetsSortPreset(),
          UniverSheetsFilterPreset(),
        ],
      }));
      univerAPI.createWorkbook({ id: unitId, name });
      controller = createSheetController(univerAPI);
      onReady(controller);
      if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
        // A test bridge for development only: code dropped on document.body runs here, in the
        // page's own world with the controller in scope, and answers on the same element. Two
        // sheets can be open at once, so each answers only to its own unit id.
        window.__kartzSheets = { ...(window.__kartzSheets || {}), [unitId]: { controller, univerAPI } };
        host.current.dataset.ready = unitId;
        window.addEventListener('kartz:test', async () => {
          if ((document.body.dataset.kartzUnit || 'kartz') !== unitId) return;
          try {
            const fn = new Function('controller', 'univerAPI', document.body.dataset.kartzCode || '');
            const out = await fn(controller, univerAPI);
            document.body.dataset.kartzResult = JSON.stringify(out ?? null);
          } catch (e) { document.body.dataset.kartzResult = JSON.stringify({ error: String(e && e.stack || e) }); }
        });
      }
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
      if (controller) { onReady(null); controller.dispose(); }
      if (univerAPI) univerAPI.dispose();
    };
  }, []);
  return <div ref={host} className={className} />;
}

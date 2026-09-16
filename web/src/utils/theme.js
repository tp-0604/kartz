// Light or dark, in one place.
//
// The device has a preference and the app can override it. Everything that draws a colour it has
// to choose in code — a cell's fill swatch, a chart's series — asks here, so the grid, the charts
// and the stylesheet can never disagree about which theme is showing.
import { useEffect, useState } from 'react';
import { store } from './storage.js';

const media = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

/** 'light' | 'dark' when chosen here; null when following the device. */
export const themeChoice = () => {
  const t = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
  return t === 'light' || t === 'dark' ? t : null;
};

export function isDark() {
  const t = themeChoice();
  if (t) return t === 'dark';
  const m = media();
  return !!(m && m.matches);
}

/** Choose 'light' or 'dark', or null to follow the device again. Remembered on this device. */
export function setTheme(choice) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
  else root.removeAttribute('data-theme');
  store.set('theme', choice === 'light' || choice === 'dark' ? choice : null);
  window.dispatchEvent(new Event('kartz:theme'));
}

/** Whether dark is showing, kept current through a device change and a choice made here. */
export function useDark() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const update = () => setDark(isDark());
    const m = media();
    if (m) m.addEventListener('change', update);
    window.addEventListener('kartz:theme', update);
    return () => {
      if (m) m.removeEventListener('change', update);
      window.removeEventListener('kartz:theme', update);
    };
  }, []);
  return dark;
}

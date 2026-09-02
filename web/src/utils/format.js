export const monthName = m => new Date(m + '-01T00:00:00').toLocaleString(undefined, { month: 'long' });
export const fmtMonth = m => new Date(m + '-02T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
export const today = () => new Date().toLocaleDateString('en-CA');
export const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
};
export const fmtTime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
export const n = v => (typeof v === 'number' ? v.toLocaleString() : v ?? '');

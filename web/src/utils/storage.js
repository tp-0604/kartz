// The same 'kartz.' keys the old page used, so nobody's phone has to be set up again.
export const store = {
  get: k => { try { return JSON.parse(localStorage.getItem('kartz.' + k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('kartz.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del: k => { try { localStorage.removeItem('kartz.' + k); } catch { /* ignore */ } },
};

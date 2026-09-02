// Where the extractor reports to. The old page wrote straight into two DOM elements; the
// modules now write here and the screen decides what to do with it. runExtraction swaps these
// in for the duration of a run and puts the no-ops back afterwards.
export const ctx = {
  log: () => {},
  progress: () => {},
  frames: () => {},
};

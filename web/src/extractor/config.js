// The handful of numbers the whole extractor is tuned around. They were the top of the old
// single-file page and they are unchanged; see README.md for why each is what it is.

// Shown in the header. Several people run this from their own phones and a browser can sit on
// an open tab for days, so "it is still happening" and "it is fixed" are easy to say about
// different builds. Bump it with any change worth telling apart from the one before.
export const BUILD = '2026-09-02u';
export const MODEL = 'gemini-3.5-flash-lite';
export const FALLBACKS = [];        // one model, deliberately: a run either works or says why

// Six requests, not four or twelve: fewer resends less roster prompt, but a long batch is
// attended to worse than a short one — 47 images to a request dropped the match rate from 91
// of 129 to 67. The floor stops a short run from sending near-empty requests; the ceiling
// stops one huge request from putting the whole run on a single throw.
export const REQ_CAP = 6, BATCH_MIN = 8, BATCH_MAX = 40;
export const batchSize = n => Math.min(BATCH_MAX, Math.max(BATCH_MIN, Math.ceil(n / REQ_CAP)));

// The frame budget. 64 frames is about 223,000 tokens against a limit of 250,000 a minute, so
// the run goes in one burst; runExtraction trims it further if the roster has grown.
export const FRAME_BUDGET = 64;

// The one tab everybody pulls from. It was a text box on every device, which is a per-person
// chance to paste the wrong link for something that has only ever had one right answer.
export const ROSTER_SHEET =
  'https://docs.google.com/spreadsheets/d/1aXTc9v4jHtB5Ma598R3Qfij-vsMlDhXho9bP_m2M5kE/edit?gid=767166123';

// The four alliances the sheet is actually organised around. Anything else in its Alliance
// column — z3.?, z1.Transferred, a stray 698E — is a candidate for filtering out.
export const MAIN_ALLIANCES = ['698W', '698S', '698N', '698C'];

// Which of the month's recordings a board is. Chosen rather than worked out from the date
// order, because a missed or re-shot day would silently shift every label after it.
export const DAYS = ['Day 1', 'Day 4', 'Final'];

// Frame sampling. Lifted verbatim from the single-file page. Everything here is canvas
// and <video> work with no DOM of the app's own, and it reports progress only through the
// onProg callback extractFrames is given.
const once = (el, ev) => new Promise(res => el.addEventListener(ev, res, { once: true }));

// A leaderboard of near-identical cards defeats any whole-frame difference metric —
// scrolled or not, the picture looks about the same. So instead measure how far the
// list has actually travelled: reduce each frame to a vertical brightness profile of
// the text column, then slide consecutive profiles against each other to recover the
// scroll offset in pixels. Keep a frame each time the list has moved far enough that
// the next screenful still overlaps the last kept one by roughly a third.
const TOP_MASK = 0.10, BOT_MASK = 0.84;   // ignore the fixed title bar and the pinned own-rank card

// Where the list actually is, found rather than assumed. The first attempt used fixed
// fractions of the frame, which held only for the phone they were measured on: a recording
// from a taller device showed the Ranking dialog as a window inset in the game screen, and
// the same fractions then kept the surrounding chrome and the pinned own-rank row.
//
// The reliable signal is motion. Over a scrolling recording the list is the only thing that
// changes; the title bar, the surrounding game UI and the pinned "your rank" card all sit
// still. So accumulate per-cell change across the sampling pass and take the bounding box
// of whatever moved. That adapts to any phone and any layout, and it excludes the pinned
// card for free — precisely because it does not move.
const GW = 64, GH = 128;              // resolution of the motion map
function motionMap(cx, W, H) {
  const tmp = motionMap.cv || (motionMap.cv =
    Object.assign(document.createElement('canvas'), { width: GW, height: GH }));
  const tc = motionMap.cx || (motionMap.cx = tmp.getContext('2d', { willReadFrequently: true }));
  tc.drawImage(cx.canvas, 0, 0, W, H, 0, 0, GW, GH);
  const d = tc.getImageData(0, 0, GW, GH).data;
  const g = new Float32Array(GW * GH);
  for (let i = 0; i < g.length; i++)
    g[i] = (d[i*4] * .299 + d[i*4+1] * .587 + d[i*4+2] * .114) / 255;
  return g;
}
// Bounding box of the cells that moved, as fractions of the frame. Null when the result is
// implausible, in which case the caller sends the frame uncropped rather than guessing.
function movingRegion(accum) {
  let max = 0;
  for (const v of accum) if (v > max) max = v;
  if (max <= 1e-6) return null;
  const thresh = max * 0.18;
  let x0 = GW, x1 = -1, y0 = GH, y1 = -1, hits = 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    if (accum[y*GW + x] < thresh) continue;
    hits++;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (hits < GW * GH * 0.02 || x1 < 0) return null;
  const pad = 0.006;
  const box = { x0: Math.max(0, x0/GW - pad), x1: Math.min(1, (x1+1)/GW + pad),
                y0: Math.max(0, y0/GH - pad), y1: Math.min(1, (y1+1)/GH + pad) };
  if ((box.x1 - box.x0) < 0.25 || (box.y1 - box.y0) < 0.25) return null;
  return box;
}
function cropFrame(src, W, H, box) {
  if (!box) return src;
  const sx = Math.round(W * box.x0), sy = Math.round(H * box.y0);
  const sw = Math.round(W * (box.x1 - box.x0)), sh = Math.round(H * (box.y1 - box.y0));
  const out = cropFrame.cv || (cropFrame.cv = document.createElement('canvas'));
  out.width = sw; out.height = sh;
  out.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

// How much the list moved between two frames. Deliberately only a *rate* of change,
// never a displacement: the leaderboard is a run of near-identical cards, so matching
// one frame against another is genuinely ambiguous — several offsets, one card pitch
// apart, fit equally well. Measuring "is it moving" instead of "how far" sidesteps that
// entirely, and integrating it over the recording is all the pacing we actually need.
const MW = 96, MH = 96;
function motionGrid(cx, W, H) {
  const yA = Math.round(H * TOP_MASK), yB = Math.round(H * BOT_MASK);
  const tmp = motionGrid.cv || (motionGrid.cv =
    Object.assign(document.createElement('canvas'), { width: MW, height: MH }));
  const tc = motionGrid.cx || (motionGrid.cx = tmp.getContext('2d', { willReadFrequently: true }));
  tc.drawImage(cx.canvas, 0, yA, W, yB - yA, 0, 0, MW, MH);
  const d = tc.getImageData(0, 0, MW, MH).data;
  const g = new Float32Array(MW * MH);
  for (let i = 0; i < g.length; i++)
    g[i] = (d[i*4] * .299 + d[i*4+1] * .587 + d[i*4+2] * .114) / 255;
  return g;
}
const gridDiff = (a, b) => {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

async function openVideo(file) {
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true;
  video.src = URL.createObjectURL(file);
  await once(video, 'loadedmetadata');
  // iOS refuses to paint into a canvas until the pipeline has decoded at least once
  try { await video.play(); video.pause(); } catch {}
  return video;
}
const seek = async (video, t) => {
  video.currentTime = t;
  await Promise.race([once(video, 'seeked'), new Promise(r => setTimeout(r, 1500))]);
};

// Two passes. The first is cheap — no JPEG encoding — and just builds a motion profile,
// which tells us how this particular recording was scrolled. The second spends the frame
// budget evenly across accumulated motion, so a slow careful scroll and a fast flick both
// come out with the same coverage and the same cost.
let lastCropBox = null;
// A chosen timestamp is a position in the scroll, not a promise that the frame is legible.
// The list is frequently mid-flick at that instant, and when it is, the names smear into
// unreadable strokes while the rank numbers and points — large, bold, high-contrast —
// survive intact. That failure is invisible in the output: the row arrives with a confident
// rank and a nonsense name. Rank 4 came back as 𝓡𝓑𝓙 from such a frame while a sharp frame
// two tenths of a second away reads the same row as DUBI, which the roster then resolves.
//
// So each pick is treated as the centre of a short window and the sharpest frame in that
// window is the one sent. Sharpness is the mean absolute Laplacian over the cropped list:
// high where glyph edges are crisp, low where motion has smeared them. Measured on this
// recording the sharp frames score about 15 and the blurred ones about 7, so the two are
// not close and the comparison does not need to be subtle.
// The window has to stay inside this pick's own share of the scroll. A fixed offset looked
// fine until it cost three players: while the list is flicking past, two tenths of a second
// is a whole screen of names, so a pick that slid sideways to find a sharper frame landed on
// ground the neighbouring pick had already covered and left a band of the list unphotographed.
// Ranks are numbered by position afterwards, so a band lost that way does not leave a hole —
// it silently renumbers everyone below it. Hence the window is bounded by the distance to the
// nearest neighbouring pick, which is small exactly when the scroll is fast.
const SHARP_MAX = 0.2, SHARP_STEPS = 3;

// Every image costs the model the same ~1090 tokens whatever its pixel dimensions, which is
// why enlarging a frame before sending it changes nothing: 1x and 3x arrive as the same 1092
// tokens and read identically. The budget is spent on whatever is in the picture, so a whole
// frame spends most of it on rank numerals, avatars and "Contribution (Pt)" captions, and
// leaves each name a few dozen tokens.
//
// Cutting the frame into bands spends N times the budget on the same pixels, and costs
// exactly what sending N frames costs. Rank 37's name is a lone emoji about twenty pixels
// across: whole, it came back as 🐼, and as three bands — 3304 image tokens instead of 1080 —
// it came back as 🐻‍❄️, which is what it actually is. The bands overlap so that a row falling
// on a seam still appears whole in its neighbour.
// The bands overlap by a whole row, which is what 0.25 works out to. At 0.08 they overlapped
// by 46 pixels against a row height of 143, so a row landing on a seam was cut in half in the
// strip above it and in half again in the strip below, and appeared whole in neither. That is
// how a single rank goes missing while its neighbours arrive intact — the gaps are 54 and 60,
// not 54 through 60.
//
// It costs nothing. An image is charged a flat ~1100 tokens whatever its dimensions, so taller
// bands are free, and because each one now spans about three rows instead of 2.3, every rank
// turns up in more of them. That matters more than the seams: 56 of 153 ranks were being seen
// exactly once in a run, with no second reading to fall back on if the first went wrong.
const STRIPS = 3, STRIP_OVERLAP = 0.25;
function sliceStrips(src) {
  const w = src.width, h = src.height;
  const band = h / STRIPS, pad = band * STRIP_OVERLAP;
  const out = [];
  for (let i = 0; i < STRIPS; i++) {
    const y0 = Math.max(0, Math.round(i * band - pad));
    const y1 = Math.min(h, Math.round((i + 1) * band + pad));
    const c = Object.assign(document.createElement('canvas'), { width: w, height: y1 - y0 });
    c.getContext('2d').drawImage(src, 0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
    out.push(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
  }
  return out;
}
function sharpness(canvas) {
  const w = canvas.width, h = canvas.height;
  if (w < 8 || h < 8) return 0;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const lum = i => d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
  let acc = 0, n = 0;
  for (let y = 1; y < h - 1; y += 2)
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * 4;
      acc += Math.abs(4*lum(i) - lum(i-4) - lum(i+4) - lum(i - w*4) - lum(i + w*4));
      n++;
    }
  return n ? acc / n : 0;
}
async function extractFrames(file, budget, onProg) {
  const video = await openVideo(file);
  const dur = video.duration;
  // Keep the recording's own resolution. 560 was chosen when the worry was payload size,
  // but token cost turns out to be near enough flat per image, so the downscale bought
  // nothing and cost the fine detail in stylised names: at 560 the glyphs "ŊŲƁĮ" came back
  // as "MB" and "DJ", while the same row read at the phone's native width resolves to Nubi.
  const W = Math.min(video.videoWidth || 720, 1080);
  const H = Math.round(W * video.videoHeight / video.videoWidth);
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const step = 0.25;

  const times = [], motion = [];
  const accum = new Float32Array(GW * GH);     // per-cell change, for locating the list
  let prev = null, prevMap = null, total = 0;
  for (let t = 0; t < dur; t += step) {
    await seek(video, Math.min(t, dur - 0.05));
    cx.drawImage(video, 0, 0, W, H);
    const g = motionGrid(cx, W, H);
    const d = prev ? gridDiff(prev, g) : 0;
    prev = g; total += d;
    const map = motionMap(cx, W, H);
    if (prevMap) for (let i = 0; i < accum.length; i++) accum[i] += Math.abs(map[i] - prevMap[i]);
    prevMap = map;
    times.push(t); motion.push(total);
    onProg(0.6 * t / dur, 0);
  }
  const box = movingRegion(accum);      // always: it removes the pinned own-rank card
  lastCropBox = box;

  // Most of the budget goes at equal increments of accumulated motion, which spreads frames
  // along the scroll rather than along the clock and stops a slow drag eating the allowance.
  //
  // The blind spot is a bad one: a stretch where nothing moves accumulates no motion and takes
  // exactly one pick. That stretch is the top of the list, held steady before the scrolling
  // starts, so the ranks people care about most were the ones read once — and a single reading
  // has nothing to outvote it when it goes wrong. It did: with three full seconds of sharp
  // footage available, ranks 1 to 3 came back with their scores written into the name field
  // and no second reading to disagree.
  //
  // A quarter of the budget is therefore spread evenly through the recording regardless of
  // motion. This reallocates the same number of frames rather than adding any, so the token
  // cost of a run does not move: where the list is scrolling these land among the motion picks
  // and collapse into them, and where it is still they are the only thing sampling it twice.
  const MOTION_SHARE = 0.75;
  const nMotion = Math.max(2, Math.round((budget - 1) * MOTION_SHARE));
  const chosen = new Set([times[0]]);
  if (total > 1e-6) {
    const gap = total / nMotion;
    let want = gap;
    for (let i = 1; i < times.length; i++)
      if (motion[i] >= want && chosen.size < nMotion) { chosen.add(times[i]); want = motion[i] + gap; }
  }
  const nTime = Math.max(0, budget - chosen.size - 1);
  for (let k = 0; k < nTime; k++) {
    const want = times[0] + (times[times.length-1] - times[0]) * (k + 0.5) / nTime;
    let best = times[0], d = Infinity;
    for (const t of times) { const e = Math.abs(t - want); if (e < d) { d = e; best = t; } }
    chosen.add(best);
  }
  chosen.add(times[times.length - 1]);
  const picks = [...chosen].sort((a, b) => a - b);

  const frames = [];
  for (let i = 0; i < picks.length; i++) {
    const prevGap = i > 0 ? picks[i] - picks[i-1] : Infinity;
    const nextGap = i < picks.length - 1 ? picks[i+1] - picks[i] : Infinity;
    // A quarter of the way to the nearest neighbour, not four tenths. Two picks can move in
    // opposite directions, so the reach is doubled in the worst case, and at four tenths that
    // was enough to open a hole: ranks 86 to 88 fell between two picks that had each slid away
    // from the other and were photographed by neither.
    const reach = Math.min(SHARP_MAX, 0.25 * Math.min(prevGap, nextGap));
    let bestT = null, bestScore = -1;
    for (let k = 0; k < SHARP_STEPS; k++) {
      const off = reach * (2 * k / (SHARP_STEPS - 1) - 1);   // -reach .. +reach
      const t = picks[i] + off;
      if (t < 0 || t > dur - 0.05) continue;
      await seek(video, t);
      cx.drawImage(video, 0, 0, W, H);
      const score = sharpness(cropFrame(cv, W, H, box));
      if (score > bestScore) { bestScore = score; bestT = t; }
    }
    if (bestT !== null) {
      await seek(video, bestT);
      cx.drawImage(video, 0, 0, W, H);
      for (const strip of sliceStrips(cropFrame(cv, W, H, box))) frames.push(strip);
    }
    onProg(0.6 + 0.4 * (i + 1) / picks.length, frames.length);
  }
  URL.revokeObjectURL(video.src);
  return frames;
}

// A picture of the roster, for the names that words cannot describe.
//
// Sending "Phil West Alt = 🐻‍❄️" as text asks the model to go from pixels on screen, to a
// concept, to a character it has only read about. Sending a *picture* of that emoji asks it
// to compare two images instead — and when the page is open on the phone that made the
// recording, the browser draws the emoji with the very same font the game did, so the two
// pictures are near enough identical. That is a far easier question than "polar bear or
// panda", and it is the one failure that text alone could not fix.
//
// Which names go on it: any whose in-game form is mostly not plain ASCII. That is wider than
// the emoji-only set — "ŊŲƁĮ" is ordinary letters as far as folding is concerned, yet it kept
// coming back as MK19 — and narrower than the whole roster, which at 689 entries would draw
// a sheet too dense to read.
//
// Worth knowing where this helps most: emoji are drawn by the phone's own font, so a sheet
// rendered on the phone that made the recording matches the game exactly. Exotic letterforms
// are drawn by whatever fallback font the browser picks, which may not be the font the game
// used — the shapes are still distinctive, but the match is a likeness rather than a copy.

export { openVideo, extractFrames, STRIPS };

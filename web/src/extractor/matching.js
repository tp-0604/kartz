// Name matching. Lifted verbatim from the single-file page; nothing in here touches the
// DOM, and the tests in README.md (ŊŲƁĮ → Nubi, DUBI rejected, batman in Tai Viet) all
// depend on these staying exactly as they are.
const LATIN_K = '\u00D8\u00F8\u0110\u0111\u0126\u0127\u0141\u0142\u0166\u0167\u0180\u0181\u0182\u0183\u0187\u0188\u018A\u018B\u018C\u0191\u0192\u0193\u0197\u0198\u0199\u019A\u019D\u019E\u019F\u01A4\u01A5\u01AB\u01AC\u01AD\u01AE\u01B2\u01B3\u01B4\u01B5\u01B6\u01E4\u01E5\u01FE\u01FF\u0220\u0221\u0224\u0225\u0234\u0235\u0236\u023A\u023B\u023C\u023D\u023E\u023F\u0240\u0243\u0244\u0246\u0247\u0248\u0249\u024B\u024C\u024D\u024E\u024F\u0253\u0255\u0256\u0257\u0260\u0266\u0268\u026B\u026C\u026D\u0271\u0272\u0273\u027C\u027D\u027E\u0282\u0288\u0289\u028B\u0290\u0291\u029D\u02A0\u0363\u0364\u0365\u0366\u0367\u0368\u0369\u036A\u036B\u036C\u036D\u036E\u036F\u1ABF\u1D6C\u1D6D\u1D6E\u1D6F\u1D70\u1D71\u1D72\u1D73\u1D74\u1D75\u1D76\u1D7B\u1D7D\u1D7E\u1D80\u1D81\u1D82\u1D83\u1D84\u1D85\u1D86\u1D87\u1D88\u1D89\u1D8A\u1D8C\u1D8D\u1D8E\u1D8F\u1D91\u1D92\u1D96\u1D99\u1DCA\u1DD7\u1DDA\u1DDC\u1DDD\u1DE0\u1DE3\u1DE4\u1DE6\u1DE8\u1DEB\u1DEC\u1DED\u1DEE\u1DF0\u1DF1\u1DF2\u1DF3\u1DF4\u1EFE\u1EFF\u24F5\u24F6\u24F7\u24F8\u24F9\u24FA\u24FB\u24FC\u24FD\u24FF\u2776\u2777\u2778\u2779\u277A\u277B\u277C\u277D\u277E\u2780\u2781\u2782\u2783\u2784\u2785\u2786\u2787\u2788\u278A\u278B\u278C\u278D\u278E\u278F\u2790\u2791\u2792\u2C60\u2C61\u2C62\u2C63\u2C64\u2C65\u2C66\u2C67\u2C68\u2C69\u2C6A\u2C6B\u2C6C\u2C6E\u2C71\u2C72\u2C73\u2C74\u2C78\u2C7A\u2C7E\u2C7F\uA740\uA741\uA742\uA743\uA744\uA745\uA748\uA749\uA74A\uA74B\uA74C\uA74D\uA750\uA751\uA752\uA753\uA754\uA755\uA756\uA757\uA758\uA759\uA75A\uA75B\uA75E\uA75F\uA78E\uA790\uA791\uA792\uA793\uA794\uA795\uA796\uA797\uA798\uA799\uA7A0\uA7A1\uA7A2\uA7A3\uA7A4\uA7A5\uA7A6\uA7A7\uA7A8\uA7A9\uA7AA\uA7AD\uA7B2\uA7B8\uA7B9\uA7C4\uA7C5\uA7C6\uA7C7\uA7C8\uA7C9\uA7CA\uAB31\uAB34\uAB37\uAB38\uAB39\uAB3A\uAB3B\uAB47\uAB49\uAB4E\uAB4F\uAB52\uAB56\uAB57\uAB58\uAB59\uAB5A\u{1DF09}\u{1DF11}\u{1DF13}\u{1DF16}\u{1DF1A}\u{1DF1B}\u{1DF1D}\u{1DF1E}\u{1DF25}\u{1DF26}\u{1DF27}\u{1DF28}\u{1DF29}\u{1DF2A}\u{1F10B}\u{1F10C}\u{1F150}\u{1F151}\u{1F152}\u{1F153}\u{1F154}\u{1F155}\u{1F156}\u{1F157}\u{1F158}\u{1F159}\u{1F15A}\u{1F15B}\u{1F15C}\u{1F15D}\u{1F15E}\u{1F15F}\u{1F160}\u{1F161}\u{1F162}\u{1F163}\u{1F164}\u{1F165}\u{1F166}\u{1F167}\u{1F168}\u{1F169}\u{1F170}\u{1F171}\u{1F172}\u{1F173}\u{1F174}\u{1F175}\u{1F176}\u{1F177}\u{1F178}\u{1F179}\u{1F17A}\u{1F17B}\u{1F17C}\u{1F17D}\u{1F17E}\u{1F17F}\u{1F180}\u{1F181}\u{1F182}\u{1F183}\u{1F184}\u{1F185}\u{1F186}\u{1F187}\u{1F188}\u{1F189}\u{1F18A}\u{1F1A5}';
const LATIN_V = 'OODDHHLLTTBBBBCCDDDFFGIKKLNNOPPTTTTVYYZZGGOONDZZLNTACCLTSZBUEEJJQRRYYBCDDGHILLLMNNRRRSTUVZZJQAEIOUCDHMRTVXWBDFMNPRRSTZIPUBDFGKLMNPRSVXZADEIURCGKLNRSZBFLOPUWAOUYY1234567890123456789123456789123456789LLLPRATHHKKZZMVWWVEOSZKKKKKKLLOOOOPPPPPPQQQQRRVVLNNCCCHBBFFGGKKNNRRSSHLJUUCSZDDSSAELLLMNRRUUUXXXXYTLLRIOCSDLNRST00ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZPD';
const LATIN_MAP = (() => {
  const m = {};
  const ks = [...LATIN_K], vs = [...LATIN_V];
  for (let i = 0; i < ks.length; i++) m[ks[i]] = vs[i];
  return m;
})();

// stylised-unicode tags collapse onto plain ascii; the model also gives us a plain
// reading of its own, so this only has to catch what slips through.
const FOLD = { 'Ꭱ':'R','Ꭲ':'T','Ꮮ':'L','Ꮯ':'C','Ꮋ':'H','Ꭺ':'A','Ꭼ':'E','Ꮲ':'P','Ꮪ':'S','Ꮶ':'K',
  'Ꮇ':'M','Ꮃ':'W','Ꭰ':'D','Ꮖ':'I','Ꮷ':'J','Ø':'O','Ð':'D','Þ':'P','Ł':'L','ß':'B','€':'E',
  'Δ':'A','Ć':'C','Ħ':'H','Ƥ':'P','Ñ':'N','Ɐ':'A',
  'Ŋ':'N','ŋ':'n','Ų':'U','ų':'u','Ɓ':'B','ɓ':'b','Į':'I','į':'i','Ə':'E','Ɔ':'O',
  'Ʌ':'A','Ƨ':'S','Ƽ':'S','Ʈ':'T','Ɗ':'D','Ɖ':'D','Ƙ':'K','Ɲ':'N','Ɍ':'R','Ɏ':'Y' };
function fold(s) {
  if (!s) return '';
  // [...s] iterates codepoints; split('') would cut every astral character in half and the
  // maps would never see it — which is exactly why the squared-letter names folded to
  // nothing despite being in the table.
  s = [...s.normalize('NFKD')].map(c => FOLD[c] || LATIN_MAP[c] || c).join('');
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
// Twenty-four roster names survive fold() as an empty string: pure emoji, Cherokee,
// small-caps IPA, enclosed letters, Cyrillic and CJK lookalikes. Unicode normalisation
// does not touch any of those ranges — NFKD and NFKC both rescue exactly none of them — so
// there is no clever folding to be had. What there is: the characters themselves are a
// perfectly good key, as long as the decorations that vary between renderings are dropped.
// Zero-width joiners, variation selectors and skin tones all change the bytes without
// changing what a person sees.
// fold() is aggressive, and on a heavily stylised name it can leave a single stray letter
// behind — "ΛƧƬΛ♣️" comes out as "s", because Ƨ maps to S while Λ and Ƭ do not. One letter
// then exact-matches any other player who also collapses to one letter, which is how Asta
// was resolving to angkasa. Treat a fold that kept almost nothing as no fold at all, and let
// the characters themselves do the matching instead.
// The key a remembered correction is filed under. Emoji names fold to nothing, so keying on
// the fold alone filed every one of them under the empty string — each overwriting the last,
// and none ever found again, because the lookup skips empty keys. A name made purely of
// symbols therefore could not be taught at all, which is exactly the kind that most needs
// teaching: 🐻‍❄️ is a white bear face twenty pixels across and the model calls it 🐼 about
// half the time. Folded names keep their old key, so corrections saved before this still work.
function aliasKey(s) {
  const f = fold(s);
  if (f) return f;
  const k = symKey(s);
  return k ? '\u0002' + k : '';
}
function usableFold(raw) {
  const f = fold(raw);
  if (!f) return '';
  const visible = [...String(raw || '')].filter(c => c.codePointAt(0) > 0x20).length;
  return (f.length >= 3 || f.length >= visible) ? f : '';
}

function symKey(s) {
  const out = [];
  for (const ch of String(s || '')) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200D || cp === 0xFE0E || cp === 0xFE0F) continue;   // ZWJ, variation
    if (cp >= 0x1F3FB && cp <= 0x1F3FF) continue;                    // skin tone
    if (cp <= 0x20) continue;                                        // spaces, control
    out.push(cp.toString(16));
  }
  return out.join('.');
}

function sim(a, b) {                       // levenshtein similarity
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
function buildIndex(roster) {
  const ix = [];
  for (const r of roster) {
    for (const v of new Set([usableFold(r.search), usableFold(r.ingame)]))
      if (v) ix.push({ k: v, r });
    // Every form is also indexed by its literal characters. Not only the ones that fold
    // away: improving the fold turns some of those into ordinary words, and without this
    // they would quietly stop matching by the route that used to work for them.
    for (const form of [r.search, r.ingame]) {
      if (!form) continue;
      const k = symKey(form);
      if (k) ix.push({ k: '\u0002' + k, r, sym: true, cps: symCodes(form) });
    }
  }
  return ix;
}
// Asking the model to pick from a list makes it want to pick *something*. HÊNK is not on
// the roster, but TEKN is, and the model would sometimes answer TEKN — which we then trusted
// outright because the name exists. Hence the same recording giving different answers on
// different runs.
//
// So a claim is checked before it is believed. Only when it can be: a name that survives
// folding is comparable to the roster entry and must actually resemble it, while a name made
// of emoji or heavy styling folds to nothing, cannot be judged that way, and is exactly the
// case where the model's reading is the only signal there is.
// Where to set this is settled by what the readings actually score. In a full run every
// correct claim matched an exact form and scored 1.00, while the wrong ones — "M[i]bi" filed
// as MB, "HÊNK" as LeeK — sat at exactly 0.50, and "MiniMe" as Mexi ALT at 0.75. A reading
// only half-resembling the name it is said to be is not evidence.
//
// The cost of the higher bar is that a correct claim behind a poor reading gets rejected too.
// That is the right way round: a rejected row goes to the second look, which offers it a
// shortlist and a forced choice, and failing that lands in front of you. A confident wrong
// match just quietly enters the sheet.
// How far a reading must resemble the roster entry the model claims depends on how far the
// reading itself can be trusted, and that is not constant across names.
//
// A name drawn in ordinary Latin letters is transcribed accurately, so a claim that disagrees
// with the reading is the model reaching for a roster entry that is not there: HÊNK, absent
// from the roster, filed as LeeK at 0.50. The strict bar exists for exactly that.
//
// A name drawn in stylised Unicode is the opposite case — the transcription is the unreliable
// half and the recognition is the half we asked for. ŊŲƁĮ came back as ŊŲƁĮ, Ḏṳḇị, DUBI,
// 𝓡𝓑𝓙 and ṆḶḄḶ across five runs of one recording; at the strict bar only the first two are
// believed and the same player lands in the review list on the other three runs.
//
// So the concession is made, and confined: it applies only when the drawn name and the roster
// entry are BOTH stylised, which is the situation it was reasoned about. HÊNK scores 0.25 on
// that measure and MiniMe 0.00, so neither is offered the lower bar; ṆḶḄḶ scores 1.00.
const CLAIM_MIN = 0.8, CLAIM_MIN_STYLISED = 0.45;
function claimPlausible(seen, entry) {
  const key = usableFold(seen);
  const forms = [entry.search, entry.ingame].filter(Boolean);
  if (!key) {
    // The row's name is symbols only. That cannot be compared letter by letter, but it is
    // not a free pass either. A bare 🐼 was being accepted as "Vyking" — whose names are
    // "Vyking" and "Vyking🐳", both ordinary words — purely because the panda side was
    // unjudgeable. Requiring merely that the claimed player also has a symbolic form is not
    // enough: that would let any emoji stand for any of them, so 🐼 could pass as ☁️.
    // The characters themselves have to overlap.
    const seenSym = symKey(seen), seenCps = symCodes(seen);
    return forms.some(f => {
      if (usableFold(f)) return false;                 // that form is a word, not symbols
      const s = symKey(f);
      if (s === seenSym || s.includes(seenSym) || seenSym.includes(s)) return true;
      // Not identical, but these may be letters rather than emoji, and letters drift.
      const fc = symCodes(f);
      if (seenCps.length < SYM_NEAR_MIN || fc.length < SYM_NEAR_MIN) return false;
      const cap = symCap(Math.max(seenCps.length, fc.length));
      if (seqEdits(seenCps, fc, cap) <= cap) return true;
      // Nothing in common at all. It is tempting to accept that on the model's word — the
      // roster spells batman in Tai Viet, one run read it as Thai and the next as IPA, and no
      // codepoint comparison will ever bridge those. But length agreement is not evidence:
      // matching six unreadable glyphs against six other unreadable glyphs put rank 74 down as
      // hyena on nothing but the count, and a wrong name entered quietly is the failure this
      // whole exercise exists to prevent. A unanimous claim is handled further up, where it can
      // be judged against every reading of the row rather than one at a time.
      return false;
    });
  }
  const bothStylised = exoticness(seen) >= EXOTIC
                       && forms.some(f => exoticness(f) >= EXOTIC);
  const bar = bothStylised ? CLAIM_MIN_STYLISED : CLAIM_MIN;
  for (const form of forms) {
    const f = usableFold(form);
    if (!f) continue;            // this form is symbols; judge against the other one
    if (f === key || sim(key, f) >= bar) return true;
  }
  return false;
}

// True when two keys are at most one edit apart. Cheaper than computing the distance:
// past the first mismatch the remainders either line up or they do not.
// Works on sequences rather than strings, so a name made of emoji can be compared codepoint
// by codepoint. 🐼❄️ and 🐻❄️ differ in exactly one element that way, where their UTF-16 units
// would not line up at all.
function lev1(a, b) {
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
    return true;                                          // nothing, or one substitution
  }
  const [s, t] = a.length < b.length ? [a, b] : [b, a];
  if (t.length - s.length > 1) return false;
  let i = 0;
  while (i < s.length && s[i] === t[i]) i++;
  for (let k = i; k < s.length; k++) if (s[k] !== t[k + 1]) return false;
  return true;                                            // one insertion
}
// The codepoints of a name with the joiners and modifiers taken out — the same reduction
// symKey performs, kept as numbers so one emoji counts as one element.
function symCodes(s) {
  const out = [];
  for (const ch of String(s || '')) {
    const cp = ch.codePointAt(0);
    if (cp === 0x200D || cp === 0xFE0E || cp === 0xFE0F) continue;   // ZWJ, variation
    if (cp >= 0x1F3FB && cp <= 0x1F3FF) continue;                    // skin tone
    if (cp <= 0x20) continue;                                        // spaces, control
    out.push(cp);
  }
  return out;
}
// A symbol name one codepoint away from exactly one roster player. Two elements minimum,
// which matters: a bare 🐼 is one codepoint from every single-emoji player on the roster and
// would match whichever happened to be alone in that neighbourhood, so it stays unmatched and
// goes to you. 🐼❄️ against 🐻❄️ is a different proposition — the snowflake agrees and only the
// animal is in dispute, which is exactly how the model misread it.
// How many single-codepoint edits separate two sequences, abandoning the count once it is
// past `cap` — the answer is only ever compared against a threshold.
function seqEdits(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
// A name written in letters the fold has never heard of — Tai Viet, Limbu, Osage — is read
// glyph by glyph out of a row twenty pixels tall, in a script the model has no words for, so
// some of the glyphs drift. "᥇ꪖꪻꪑꪖꪀ" is batman spelled in Tai Viet, and one or two codepoints
// off is a good reading of it, not a different player.
//
// Four codepoints is where the tolerance starts, and below it nothing is tolerated at all.
// That is the difference between a word and an emoji: in a six-glyph word two wrong glyphs
// still leave four agreeing, whereas one codepoint IS the whole of 🐼, and one substitution
// turns it into 🦊.
// Is this a word, or a picture? Emoji are Extended_Pictographic; letters, digits and marks
// from any script on earth are not. The distinction matters because one codepoint is the whole
// of 🐼, while a word survives having several of its letters misread.
const letterish = s => !/\p{Extended_Pictographic}/u.test(s || '') && /[\p{L}\p{N}]/u.test(s || '');
const SYM_NEAR_MIN = 4;
const symCap = n => Math.max(1, Math.floor(n / 3));
const SYM_MIN_LEN = 2;
function nearSymMatch(raw, ix) {
  const cps = symCodes(raw);
  if (cps.length < SYM_MIN_LEN || usableFold(raw)) return null;
  let hit = null;
  for (const e of ix) {
    if (!e.sym || !e.cps || e.cps.length < SYM_MIN_LEN) continue;
    const long = cps.length >= SYM_NEAR_MIN && e.cps.length >= SYM_NEAR_MIN;
    const cap = long ? symCap(Math.max(cps.length, e.cps.length)) : 1;
    if (seqEdits(cps, e.cps, cap) > cap) continue;
    if (hit && hit !== e.r) return null;                  // more than one player this close
    hit = e.r;
  }
  return hit;
}
// The last resort, and the one that took the longest to get right.
//
// It used to be similarity above a threshold, which cannot work here. "MiniMe" — a genuinely
// new player — scored 0.75 against Mexi ALT. "DUBI", the reading of ŊŲƁĮ, scored Nubi at
// exactly 0.75 as well. One must be rejected and the other accepted, and no threshold placed
// anywhere separates two numbers that are equal.
//
// Edit distance does separate them: dubi→nubi is a single substitution, minime→mexialt is
// five. That also matches how these readings actually fail. The model gets nearly every
// glyph and argues about one: ŊŲƁĮ came back as DUBI, ḐUBĮ, ɳUBI and กUBI on different runs,
// with UBI intact every time.
//
// Two guards keep it honest. Four characters minimum, so short names are not one edit from
// half the roster; and a sole hit, so a crowded neighbourhood goes to you rather than being
// guessed at. Measured against this roster it recovers ŊŲƁĮ and leaves all eight of the
// known new players alone.
const NEAR_MIN_LEN = 4;
function nearMatch(cand, ix, raw) {
  if (!cand || cand.length < NEAR_MIN_LEN) return null;
  // Only for names the model cannot be trusted to have transcribed. A name in ordinary
  // letters is read accurately, so a reading one edit off a roster entry is not a misreading
  // of that player — it is a different player, usually one who has just joined. Allowing it
  // regardless cost two wrong rows on a second recording: Weezy filed as Peezy and DARTH as
  // Dart, both of them plain ASCII, read cleanly, and neither on the roster at all.
  //
  // Nothing is given up by the restriction. Weezy against Peezy and ḐŲḂĮ against Nubi are the
  // same shape — one substitution — so no structural rule separates them; only the question of
  // whether the reading could be wrong in the first place does. And the stylised names this
  // was built for now arrive either exactly right or close enough for the claim to carry them.
  if (exoticness(raw === undefined ? cand : raw) < EXOTIC) return null;
  let hit = null;
  for (const e of ix) {
    if (e.sym || e.k.length < NEAR_MIN_LEN) continue;   // symbol keys are exact-match only
    if (!lev1(cand, e.k)) continue;
    if (hit && hit !== e.r) return null;                // more than one player this close
    hit = e.r;
  }
  return hit;
}
function resolve(name, plain, ix, aliases) {
  // Aliases stay keyed on the raw fold — that is how they were written — but the exact
  // match against the roster must use usableFold, or a name stylised down to one stray
  // letter exact-matches whichever player is actually called that. "ʟᴇxɪᴄᴏɴ" reduces to
  // "x" and was resolving to the player X before the symbol path ever got a look in.
  for (const cand of [aliasKey(name), aliasKey(plain)]) {
    if (!cand) continue;
    if (aliases[cand]) {
      const al = aliases[cand];
      const nm = typeof al === 'string' ? al : al.name;          // older entries were plain strings
      const alliance = typeof al === 'string' ? '' : (al.alliance || '');
      const hit = ix.find(e => e.k === fold(nm));
      return hit ? { r: hit.r, score: 1 }
                 : { r: { search: nm, ingame: nm, alliance }, score: 1 };
    }
  }
  for (const cand of [usableFold(name), usableFold(plain)]) {
    if (!cand) continue;
    const exact = ix.find(e => e.k === cand);
    if (exact) return { r: exact.r, score: 1 };
  }
  // exact character match — an identical string is an identical string, however it folds
  for (const raw of [name, plain]) {
    if (!raw) continue;
    const k = '\u0002' + symKey(raw);
    const hit = ix.find(e => e.k === k);
    if (hit) return { r: hit.r, score: 1 };
  }
  for (const raw of [name, plain]) {
    const hit = nearMatch(usableFold(raw), ix, raw);
    if (hit) return { r: hit, score: 1, near1: true };
  }
  for (const raw of [name, plain]) {
    const hit = nearSymMatch(raw, ix);
    if (hit) return { r: hit, score: 1, near1: true };
  }
  // Nothing matched. Find the closest name anyway, but only to show as a suggestion: it
  // decides nothing now, so a poor guess costs a hint rather than a wrong row in the sheet.
  let best = null, score = 0;
  for (const cand of [usableFold(name), usableFold(plain)]) {
    if (!cand) continue;
    for (const e of ix) {
      if (e.sym) continue;                 // symbol keys are exact-match only
      const s = sim(cand, e.k); if (s > score) { score = s; best = e.r; }
    }
  }
  return { r: null, score, near: best };
}

// How much of a name is outside printable ASCII. Names past this threshold are the ones the
// model reads unreliably, and the ones the reference sheet is drawn for.
const EXOTIC = 0.5;
function exoticness(str) {
  const ch = [...String(str || '')].filter(c => c.codePointAt(0) > 0x20);
  if (!ch.length) return 0;
  return ch.filter(c => c.codePointAt(0) > 0x7E).length / ch.length;
}

export { EXOTIC, exoticness, fold, aliasKey, usableFold, symKey, sim, buildIndex, claimPlausible, lev1, symCodes,
         seqEdits, nearSymMatch, nearMatch, resolve, letterish };

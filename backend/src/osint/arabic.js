// ═══ ARABIC-AWARE ANALYSIS (Wave 2·E · P2) ═══════════════════════════
// Arabic is written many ways for the same word: with or without
// diacritics, with any of four alef forms, ta-marbuta or ha at the end.
// Without normalisation, "سارية" and "ساريه" are different strings and
// half the mentions are missed.

const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;

/** Fold Arabic (and Arabic-Indic digits) to one comparable form. */
export function normalizeAr(text = "") {
  return String(text)
    .replace(DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s@#_]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const tokensAr = (text) => normalizeAr(text).split(" ").filter(Boolean);

// Arabic glues the conjunction, the article and prepositions onto the
// front of a word, and inflects the end for gender and number. Comparing
// raw strings therefore misses most real matches: "ممتاز" never equals
// "ممتازة", and "مشاكل" hides inside "ومشاكل".
const PREFIXES = ["وال", "بال", "فال", "كال", "لل", "ال", "و", "ف", "ب", "ك", "ل"];
const SUFFIXES = ["ات", "ون", "ين", "ها", "هم", "هن", "كم", "نا", "ه", "ي", "ا"];

export function stemAr(word = "") {
  let w = word;
  for (const p of PREFIXES) {
    if (w.length - p.length >= 3 && w.startsWith(p)) { w = w.slice(p.length); break; }
  }
  for (const sfx of SUFFIXES) {
    if (w.length - sfx.length >= 3 && w.endsWith(sfx)) { w = w.slice(0, -sfx.length); break; }
  }
  return w;
}

/** Does this token carry that lexicon entry, allowing for inflection? */
function carries(token, entry) {
  if (token === entry) return true;
  const t = stemAr(token), e = stemAr(entry);
  if (t === e) return true;
  // a long stem contained in the token is still that word (بجودة → جود)
  return e.length >= 4 && (t.startsWith(e) || token.includes(e));
}

const lexHit = (token, set) => {
  if (set.has(token)) return true;
  for (const entry of set) if (carries(token, entry)) return true;
  return false;
};

// ── Sudanese market vocabulary ───────────────────────────────────────
// Standard Arabic lexicons miss how people here actually write about
// power, fuel and prices — the words that carry the sentiment locally.
const POS_AR = `نجاح نجح ممتاز رائع تمام كويس زين حلو مميز موثوق جودة سريع رخيص مناسب
  متوفر توفر افتتاح توسع شراكة استثمار اتفاقية جائزة إنجاز تطور تحسن ارتفاع دعم تمويل
  شكرا شكرًا ماشاءالله مبروك موفق نوصي انصح احسن افضل خدمة_ممتازة استقرار انتظام`
  .split(/\s+/).filter(Boolean).map(normalizeAr);

const NEG_AR = `سيء سيئة رديء زفت مشكلة مشاكل عطل تعطل خربان مكسور تأخير تأخر بطيء غالي
  غلاء نصب احتيال زعلان زهجت مقاطعة شكوى شكاوى انقطاع قطوعات تقطع ظلام عتمة نقص شح
  ازمة أزمة طوابير طابور فشل خسارة تسريح إفلاس اضراب احتجاج تضخم مفقود مغشوش تقليد`
  .split(/\s+/).filter(Boolean).map(normalizeAr);

const NEGATORS = new Set(["لا","لم","لن","ليس","ليست","غير","بدون","دون","ما","مافي","مو","مش",
  "not","no","never","without","lacks","lack","neither","nor","hardly","barely"].map(normalizeAr));

const INTENSIFIERS = new Set(["جدا","جداً","للغاية","كتير","كثير","بشدة","تماما","خالص","مرة",
  "very","extremely","highly","deeply","totally","really"].map(normalizeAr));

const DIMINISHERS = new Set(["شوية","قليلا","نوعا","تقريبا","بعض","slightly","somewhat","fairly","a"]
  .map(normalizeAr));

const POS_EMOJI = /[\u{1F600}-\u{1F60F}\u{1F44D}\u{2764}\u{1F525}\u{1F44F}\u{1F389}]/u;
const NEG_EMOJI = /[\u{1F620}-\u{1F62F}\u{1F44E}\u{1F621}\u{1F926}\u{1F92C}]/u;

/**
 * Sentiment with the right to abstain.
 *
 * Returns a confidence alongside the score. A single ambiguous word in a
 * long headline is not evidence, and saying "unclear" is worth more to a
 * GM than a confident wrong sign in a board pack.
 */
export function analyzeSentiment(text = "", { extraPos = [], extraNeg = [] } = {}) {
  const toks = tokensAr(text);
  if (!toks.length) return { score: 0, label: "NEU", confidence: 0, hits: [] };

  const pos = new Set([...POS_AR, ...extraPos.map(normalizeAr)]);
  const neg = new Set([...NEG_AR, ...extraNeg.map(normalizeAr)]);

  let p = 0, n = 0;
  const hits = [];
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    let polarity = lexHit(w, pos) ? 1 : lexHit(w, neg) ? -1 : 0;
    if (!polarity) continue;

    // negation flips, within a two-token window on either side
    const window = [toks[i - 2], toks[i - 1], toks[i + 1]].filter(Boolean);
    if (window.some((t) => NEGATORS.has(t) || NEGATORS.has(stemAr(t)))) polarity *= -1;

    // intensity shifts magnitude, not direction
    let weight = 1;
    const near = [toks[i - 1], toks[i + 1]].filter(Boolean);
    if (near.some((t) => INTENSIFIERS.has(t))) weight = 1.6;
    else if (near.some((t) => DIMINISHERS.has(t))) weight = 0.5;

    if (polarity > 0) p += weight; else n += weight;
    hits.push({ token: w, polarity, weight });
  }

  if (POS_EMOJI.test(text)) { p += 0.8; hits.push({ token: "emoji", polarity: 1, weight: 0.8 }); }
  if (NEG_EMOJI.test(text)) { n += 0.8; hits.push({ token: "emoji", polarity: -1, weight: 0.8 }); }

  const total = p + n;
  if (!total) return { score: 0, label: "NEU", confidence: 0, hits: [] };

  const score = (p - n) / (total + 1);
  // confidence rises with evidence and with one-sidedness, and falls when
  // a couple of words are asked to speak for a long passage
  const agreement = Math.abs(p - n) / total;
  const density = Math.min(1, total / Math.max(4, toks.length / 6));
  const confidence = Number(Math.min(1, 0.35 * agreement + 0.45 * density + 0.2 * Math.min(1, total / 3)).toFixed(2));

  const label = confidence < 0.4 ? "NEU" : score > 0.12 ? "POS" : score < -0.12 ? "NEG" : "NEU";
  return { score: Number(score.toFixed(3)), label, confidence, hits };
}

/**
 * Sentiment about one entity.
 *
 * A window of N tokens cannot respect a sentence that turns: "we opened a
 * plant, *whereas* they face complaints" is two verdicts, not one average.
 * Arabic marks that turn explicitly, so we split on it and read only the
 * clause the entity actually stands in — and abstain when its clause says
 * nothing, rather than borrowing the other one's mood.
 */
// NB: \b is useless here — Arabic letters are not \w in JS regex, so word
// boundaries silently never match. Split on whitespace-delimited markers.
const CONTRAST = /\s(?:وفي المقابل|في المقابل|ولكن|لكنها|لكن|بينما|اما|غير ان|الا ان|however|whereas|but|meanwhile)\s/g;

export function clausesOf(text = "") {
  const norm = normalizeAr(text);
  const parts = norm.split(CONTRAST).map((c) => c.trim()).filter(Boolean);
  return parts.length ? parts : [norm];
}

export function sentimentToward(text = "", surfaceNorm = "") {
  const target = surfaceNorm.split(" ").filter(Boolean);
  if (!target.length) return analyzeSentiment(text);

  // the clause this entity stands in
  const clauses = clausesOf(text);
  const own = clauses.filter((c) => c.includes(target[0]));
  if (!own.length) return analyzeSentiment(text);

  const near = analyzeSentiment(own.join(" "));
  if (near.hits.length) return near;

  // its own clause is silent about it — say so instead of importing a
  // verdict formed about somebody else
  return { score: 0, label: "NEU", confidence: 0, hits: [] };
}

import { all, get, run } from "./db.js";

// ═══ MEDIA-MIX MODELLING (Wave 3·G) ══════════════════════════════════
//
// MMM's failure mode is not being unavailable. It is being *available and
// wrong* — quoted in a board meeting and moving a quarter of the budget
// on twenty weeks of data. So the floor below is enforced, not advisory,
// and everything the model cannot separate it reports as inseparable
// rather than silently splitting the credit.

// The literature is consistent: a stable fit needs roughly two years of
// weekly observations, plus real variance in per-channel spend.
export const MIN_WEEKS = 80;
export const MIN_CV = 0.1;                          // a channel that never varies teaches nothing

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const corr = (a, b) => {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2;
  }
  return da && dbb ? num / Math.sqrt(da * dbb) : 0;
};

/**
 * Adstock — advertising seen this week still works next week.
 *
 * Geometric carryover, kept as an inspectable transform rather than
 * hidden inside a fit: the decay rate is a claim about the business, and
 * someone should be able to disagree with it.
 */
export function adstock(x, decay = 0.4) {
  const out = [];
  let carry = 0;
  for (const v of x) { carry = v + decay * carry; out.push(carry); }
  return out;
}

/**
 * Saturation — the tenth thousand dollars does less than the first.
 *
 * Hill curve around a half-saturation point. Useful on its own, before
 * any full model exists: "Meta saturates around $X a week" is actionable.
 */
export function saturate(x, half = null, shape = 1.5) {
  const k = half ?? (mean(x.filter((v) => v > 0)) || 1);
  return x.map((v) => (v <= 0 ? 0 : Math.pow(v, shape) / (Math.pow(v, shape) + Math.pow(k, shape))));
}

/**
 * Ridge with non-negative coefficients, by projected gradient descent.
 *
 * Negative media coefficients are almost always an artefact of collinear
 * channels, not evidence that advertising destroys demand — so the
 * constraint is part of the model, not a post-hoc clip.
 */
export function ridgeNonNeg(X, y, { lambda = 1, iters = 4000, lr = null } = {}) {
  const n = X.length, p = X[0]?.length || 0;
  if (!n || !p) return { coef: [], intercept: 0 };

  const yMean = mean(y);
  const yc = y.map((v) => v - yMean);
  const colMean = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])));
  const colStd = Array.from({ length: p }, (_, j) => std(X.map((r) => r[j])) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - colMean[j]) / colStd[j]));

  let beta = new Array(p).fill(0);
  const step = lr ?? 1 / (n * 2);
  for (let it = 0; it < iters; it++) {
    const grad = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      let pred = 0;
      for (let j = 0; j < p; j++) pred += Z[i][j] * beta[j];
      const err = pred - yc[i];
      for (let j = 0; j < p; j++) grad[j] += err * Z[i][j];
    }
    for (let j = 0; j < p; j++) {
      beta[j] -= step * (grad[j] + lambda * beta[j]);
      if (beta[j] < 0) beta[j] = 0;                 // the projection
    }
  }

  // back out to original units
  const coef = beta.map((b, j) => b / colStd[j]);
  const intercept = yMean - coef.reduce((s, c, j) => s + c * colMean[j], 0);
  return { coef, intercept };
}

const predict = (X, coef, intercept) =>
  X.map((r) => intercept + r.reduce((s, v, j) => s + v * coef[j], 0));

const r2Of = (y, yhat) => {
  const m = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - m) ** 2, 0);
  const ssRes = y.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0);
  return ssTot ? Number((1 - ssRes / ssTot).toFixed(3)) : 0;
};

// ═══ STAGE 2 (W3·G2) — earned numbers above the floor ════════════════
// Full laws in MMM-STAGE2-BRIEF.md. In one line each: the optimiser only
// speaks when the fit beats a naive baseline; intervals come from a
// seeded moving-block bootstrap, never from a shape; a channel whose
// sign is unstable abstains from ROI even above the floor; reallocation
// walks the fitted saturation curves under a ±25% cap and conserves the
// budget to the cent.

/** Deterministic PRNG — the seed is stored with the run, so every interval is reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hill = (x, half, shape = 1.5) =>
  x <= 0 ? 0 : Math.pow(x, shape) / (Math.pow(x, shape) + Math.pow(half, shape));
const hillPrime = (x, half, shape = 1.5) => {
  if (x <= 0) return shape * Math.pow(1e-6, shape - 1) / Math.pow(half, shape); // finite slope at zero
  const xs = Math.pow(x, shape), hs = Math.pow(half, shape);
  return (shape * Math.pow(x, shape - 1) * hs) / Math.pow(xs + hs, 2);
};

const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
};

/**
 * Moving-block bootstrap over the weekly panel. Weeks are autocorrelated,
 * so resampling blocks — not rows — is what keeps the intervals honest.
 * Returns one coefficient vector per resample, fit with the same
 * non-negative ridge (fewer iterations; the draws need shape, not polish).
 */
export function bootstrapCoefs(X, y, { B = 120, blockLen = 8, rng = mulberry32(42) } = {}) {
  const n = X.length;
  if (n < blockLen * 2) return [];
  const draws = [];
  const nBlocks = Math.ceil(n / blockLen);
  for (let b = 0; b < B; b++) {
    const Xi = [], yi = [];
    for (let k = 0; k < nBlocks; k++) {
      const start = Math.floor(rng() * (n - blockLen + 1));
      for (let t = 0; t < blockLen && Xi.length < n; t++) { Xi.push(X[start + t]); yi.push(y[start + t]); }
    }
    draws.push(ridgeNonNeg(Xi, yi, { iters: 1200 }).coef);
  }
  return draws;
}

/** Build (and store) the weekly panel from real spend and outcomes. */
export async function buildPanel({ outcomeKey = "leads_new_30d", weeks = 156 } = {}) {
  const spend = await all(
    `SELECT date_trunc('week', date)::date AS "weekStart", platform,
            SUM("amountUsd")::float8 AS spend, COUNT(*)::int AS days
     FROM ad_spend WHERE date >= CURRENT_DATE - ($1::int * 7)
     GROUP BY 1, 2 ORDER BY 1`, [weeks]);
  if (!spend.length) return { ok: false, refused: true, reason: "No paid spend recorded yet — there is nothing to model." };

  const outcomes = await all(
    `SELECT date_trunc('week', date)::date AS "weekStart", SUM(value)::float8 AS v, COUNT(*)::int AS days
     FROM metric_snapshots WHERE "metricKey" = $1 AND dims = '{}'::jsonb
       AND date >= CURRENT_DATE - ($2::int * 7)
     GROUP BY 1`, [outcomeKey, weeks]);
  const outMap = Object.fromEntries(outcomes.map((r) => [String(r.weekStart), r]));

  const promos = await all(
    `SELECT date_trunc('week', "startsAt")::date AS "weekStart", COUNT(*)::int c
     FROM promotions GROUP BY 1`).catch(() => []);
  const promoMap = Object.fromEntries(promos.map((r) => [String(r.weekStart), r.c]));

  const byWeek = {};
  for (const r of spend) {
    const k = String(r.weekStart);
    byWeek[k] ||= { weekStart: r.weekStart, spend: {}, days: 0 };
    byWeek[k].spend[r.platform] = Number(r.spend);
    byWeek[k].days = Math.max(byWeek[k].days, r.days);
  }

  const rows = [];
  for (const k of Object.keys(byWeek).sort()) {
    const w = byWeek[k];
    const o = outMap[k];
    const month = new Date(k).getUTCMonth() + 1;
    // Completeness asks the question that matters: does this week have
    // both spend and an outcome to relate it to? Spend is often booked as
    // one weekly total, so counting its rows would punish tidy data —
    // but a week with no outcome is genuinely unusable, and says so.
    const outcomePart = o ? Math.max(0.6, Math.min(1, o.days / 7)) : 0.2;
    const spendPart = Object.keys(w.spend).length ? 1 : 0;
    const completeness = Number((spendPart * outcomePart).toFixed(2));
    rows.push({
      weekStart: w.weekStart,
      outcome: Number(o?.v || 0),
      spend: w.spend,
      controls: { month, promotions: promoMap[k] || 0 },
      completeness,
    });
    await run(
      `INSERT INTO mmm_weeks ("weekStart", "outcomeKey", outcome, spend, controls, completeness)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ("weekStart", "outcomeKey") DO UPDATE SET
         outcome = EXCLUDED.outcome, spend = EXCLUDED.spend,
         controls = EXCLUDED.controls, completeness = EXCLUDED.completeness`,
      [w.weekStart, outcomeKey, Number(o?.v || 0), JSON.stringify(w.spend),
       JSON.stringify({ month, promotions: promoMap[k] || 0 }), completeness]).catch(() => {});
  }
  return { ok: true, weeks: rows.length, rows, outcomeKey };
}

/**
 * Readiness — the deliverable that actually matters right now.
 *
 * Says plainly how far off a trustworthy model is, instead of producing
 * an untrustworthy one and letting the caveat get lost.
 */
export async function readiness({ outcomeKey = "leads_new_30d" } = {}) {
  const rows = await all(
    `SELECT "weekStart", outcome, spend, completeness FROM mmm_weeks
     WHERE "outcomeKey" = $1 ORDER BY "weekStart"`, [outcomeKey]);
  const usable = rows.filter((r) => Number(r.completeness) >= 0.5);

  const channels = {};
  for (const r of rows) {
    const sp = typeof r.spend === "string" ? JSON.parse(r.spend) : r.spend;
    for (const [k, v] of Object.entries(sp || {})) (channels[k] ||= []).push(Number(v) || 0);
  }
  const channelStats = Object.entries(channels).map(([platform, xs]) => {
    const m = mean(xs), sd = std(xs);
    return { platform, weeks: xs.length, meanSpend: Number(m.toFixed(2)),
             cv: Number((m ? sd / m : 0).toFixed(2)), usable: m > 0 && (sd / m) >= MIN_CV };
  });

  const have = usable.length;
  const short = Math.max(0, MIN_WEEKS - have);
  const readyAt = short > 0 ? new Date(Date.now() + short * 7 * 864e5).toISOString().slice(0, 10) : null;

  return {
    outcomeKey,
    weeksCollected: rows.length,
    weeksUsable: have,
    weeksNeeded: MIN_WEEKS,
    shortBy: short,
    aboveFloor: have >= MIN_WEEKS && channelStats.filter((c) => c.usable).length >= 2,
    readinessPct: Math.min(100, Math.round((have / MIN_WEEKS) * 100)),
    estimatedReady: readyAt,
    channels: channelStats,
    avgCompleteness: Number(mean(rows.map((r) => Number(r.completeness))).toFixed(2)) || 0,
    note: have >= MIN_WEEKS
      ? "Enough history for a full model."
      : `A trustworthy media-mix model needs about ${MIN_WEEKS} usable weekly observations; there are ${have}.`,
  };
}

/**
 * Fit the model.
 *
 * Below the floor this still runs — but returns **directional** results
 * with no ROI figure and no optimiser, and says so in the payload rather
 * than in a footnote somebody will crop out of the slide.
 */
export async function fitModel({ outcomeKey = "leads_new_30d", decay = 0.4, userId = null, seed = 42 } = {}) {
  const ready = await readiness({ outcomeKey });
  const rows = await all(
    `SELECT "weekStart", outcome, spend, controls, completeness FROM mmm_weeks
     WHERE "outcomeKey" = $1 AND completeness >= 0.5 ORDER BY "weekStart"`, [outcomeKey]);
  if (rows.length < 8) {
    return { ok: false, refused: true, readiness: ready,
             reason: `Even a directional read needs 8 usable weeks; there are ${rows.length}.` };
  }

  const platforms = ready.channels.map((c) => c.platform);
  const rawCols = platforms.map((p) => rows.map((r) => {
    const sp = typeof r.spend === "string" ? JSON.parse(r.spend) : r.spend;
    return Number(sp?.[p] || 0);
  }));

  // the two transforms that make this more than regression
  const transformed = rawCols.map((col) => {
    const carried = adstock(col, decay);
    const half = mean(carried.filter((v) => v > 0)) || 1;
    return { half: Number(half.toFixed(2)), values: saturate(carried, half) };
  });

  const promo = rows.map((r) => {
    const c = typeof r.controls === "string" ? JSON.parse(r.controls) : r.controls;
    return Number(c?.promotions || 0);
  });
  const X = rows.map((_, i) => [...transformed.map((t) => t.values[i]), promo[i]]);
  const y = rows.map((r) => Number(r.outcome));

  // collinearity: report it as inseparable rather than splitting credit
  const collinear = [];
  for (let a = 0; a < platforms.length; a++) {
    for (let b = a + 1; b < platforms.length; b++) {
      const c = corr(transformed[a].values, transformed[b].values);
      if (Math.abs(c) >= 0.9) {
        collinear.push({ a: platforms[a], b: platforms[b], corr: Number(c.toFixed(2)) });
      }
    }
  }

  const cut = Math.max(4, Math.floor(rows.length * 0.8));
  const { coef, intercept } = ridgeNonNeg(X.slice(0, cut), y.slice(0, cut));
  const fitted = predict(X, coef, intercept);
  const holdoutActual = y.slice(cut), holdoutPred = fitted.slice(cut);
  const scale = mean(holdoutActual.map(Math.abs)) || 1;
  const holdoutMape = holdoutActual.length
    ? Number((mean(holdoutActual.map((a, i) => Math.abs(a - holdoutPred[i]))) / scale * 100).toFixed(1))
    : null;

  // W3·G2 — the skill gate: a model that cannot out-predict the mean of
  // its own training window has not earned a budget recommendation.
  const trainMean = mean(y.slice(0, cut));
  const naiveMape = holdoutActual.length
    ? Number((mean(holdoutActual.map((a) => Math.abs(a - trainMean))) / scale * 100).toFixed(1))
    : null;
  const skill = holdoutMape !== null && naiveMape !== null && holdoutMape < naiveMape;

  // W3·G2 — intervals are earned by resampling, never asserted. Bootstrap
  // only runs above the data floor: below it there is no number to bound.
  const B = 120, blockLen = 8;
  const coefDraws = ready.aboveFloor
    ? bootstrapCoefs(X, y, { B, blockLen, rng: mulberry32(seed) })
    : [];

  const totalOutcome = y.reduce((a, b) => a + b, 0) || 1;
  // W3·G2 — survival under resampling is a materiality test, not a
  // floating-point one: the non-negative projection often leaves tiny
  // positive residue on a channel with no real signal, so a draw counts
  // only when the coefficient is at least 5% of that draw's largest
  // media coefficient. (Calibrated against planted ground truth: a
  // channel at 18% of the leader's strength keeps share 1.00; a
  // planted-zero channel falls to ~0.38.)
  const nMedia = platforms.length;
  const drawMax = coefDraws.map((d) => Math.max(...d.slice(0, nMedia), 0));
  const contributions = platforms.map((p, j) => {
    const contrib = transformed[j].values.reduce((s, v) => s + v * coef[j], 0);
    const spendTotal = rawCols[j].reduce((a, b) => a + b, 0);
    const blocked = collinear.some((c) => c.a === p || c.b === p);
    // Per-channel stability under resampling: the share of draws in which
    // the coefficient survives the non-negativity projection.
    const draws = coefDraws.map((d) => d[j] || 0);
    const signalShare = draws.length
      ? Number((draws.filter((v, i) => drawMax[i] > 0 && v >= 0.05 * drawMax[i]).length / draws.length).toFixed(2))
      : null;
    const roiDraws = draws
      .map((cj) => {
        const cb = transformed[j].values.reduce((s, v) => s + v * cj, 0);
        return cb > 0 ? spendTotal / cb : null;
      })
      .filter((v) => v !== null && Number.isFinite(v));
    const stable = signalShare !== null && signalShare >= 0.7 && !blocked;
    return {
      platform: p,
      coefficient: Number(coef[j].toFixed(4)),
      contribution: Number(contrib.toFixed(1)),
      sharePct: Number(((contrib / totalOutcome) * 100).toFixed(1)),
      spendUsd: Number(spendTotal.toFixed(2)),
      saturationPoint: transformed[j].half,
      // ROI is the number that moves budget, so it is withheld unless the
      // model is genuinely entitled to state one
      costPerOutcome: ready.aboveFloor && !blocked && contrib > 0
        ? Number((spendTotal / contrib).toFixed(2)) : null,
      // W3·G2 — the range carries the authority; abstention is per-channel.
      roi: stable && roiDraws.length >= 20
        ? { lo: Number(quantile(roiDraws, 0.1).toFixed(2)), hi: Number(quantile(roiDraws, 0.9).toFixed(2)) }
        : null,
      signalShare,
      inseparable: blocked,
    };
  });

  const optNote = !ready.aboveFloor ? null
    : !skill ? `Optimiser withheld: the model does not beat the naive baseline on the holdout (model ${holdoutMape}% vs naive ${naiveMape}% MAPE).`
    : null;
  const optimiser = ready.aboveFloor && skill
    ? optimiseCurves({ platforms, coef, transformed, decay, rawCols, weeksN: rows.length, coefDraws, contributions, holdoutMape, naiveMape })
    : null;

  const diagnostics = {
    r2: r2Of(y, fitted),
    holdoutMape,
    naiveMape,
    skill,
    weeks: rows.length,
    avgCompleteness: ready.avgCompleteness,
    collinear,
    adstockDecay: decay,
    bootstrap: ready.aboveFloor ? { B, blockLen, seed } : null,
    optimiserNote: optNote ?? (ready.aboveFloor && skill && !optimiser
      ? "Optimiser withheld: no reallocation the model is entitled to recommend (too few stable channels, or the current split is already near its optimum)."
      : optNote),
    optimiser,
  };

  const stored = await get(
    `INSERT INTO mmm_runs ("outcomeKey", weeks, "aboveFloor", params, coefficients, contributions, diagnostics, "runById")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, "createdAt"`,
    [outcomeKey, rows.length, ready.aboveFloor,
     JSON.stringify({ decay, seed, saturation: Object.fromEntries(platforms.map((p, j) => [p, transformed[j].half])) }),
     JSON.stringify(Object.fromEntries(platforms.map((p, j) => [p, coef[j]]))),
     JSON.stringify(contributions), JSON.stringify(diagnostics), userId]);

  return {
    ok: true,
    id: stored.id,
    directional: !ready.aboveFloor,
    readiness: ready,
    contributions,
    diagnostics,
    optimiser,
    caveat: ready.aboveFloor
      ? null
      : `Directional only — ${ready.weeksUsable} usable weeks against about ${MIN_WEEKS} needed. No cost-per-outcome and no budget recommendation are offered at this sample size.`,
  };
}

/**
 * W3·G2 — the optimiser walks its own curves.
 *
 * Equal-marginal coordinate transfers of the SAME weekly budget across
 * channels the bootstrap deemed stable, each bounded to ±25% of its
 * current weekly spend — the model is only trusted near where it was
 * fit. The projected lift is evaluated per bootstrap draw, so the band
 * is a resampled percentile, never a shape. Total spend is conserved by
 * construction. Only reachable above the data floor AND the skill gate.
 */
function optimiseCurves({ platforms, coef, transformed, decay, rawCols, weeksN, coefDraws, contributions }) {
  const CAP = 0.25, HORIZON = 12;
  const A = 1 / (1 - decay);                        // steady-state adstock multiplier
  const idx = platforms
    .map((_, j) => j)
    .filter((j) => {
      const c = contributions[j];
      return c.roi && !c.inseparable && coef[j] > 0;
    });
  if (idx.length < 2) return null;

  const s0 = idx.map((j) => rawCols[j].reduce((a, b) => a + b, 0) / weeksN);
  if (s0.some((v) => v <= 0)) return null;
  const lob = s0.map((v) => v * (1 - CAP)), hib = s0.map((v) => v * (1 + CAP));
  const halves = idx.map((j) => transformed[j].half);
  const betas = idx.map((j) => coef[j]);

  const resp = (k, s) => betas[k] * hill(A * s, halves[k]);
  const marg = (k, s) => betas[k] * hillPrime(A * s, halves[k]) * A;

  const s = [...s0];
  const total = s0.reduce((a, b) => a + b, 0);
  const step = Math.max(total * 0.004, 0.01);
  for (let it = 0; it < 600; it++) {
    let gi = -1, si = -1, gBest = -Infinity, sBest = Infinity;
    for (let k = 0; k < s.length; k++) {
      const m = marg(k, s[k]);
      if (s[k] + step <= hib[k] && m > gBest) { gBest = m; gi = k; }
      if (s[k] - step >= lob[k] && m < sBest) { sBest = m; si = k; }
    }
    if (gi < 0 || si < 0 || gi === si || gBest - sBest <= 1e-12) break;
    s[gi] += step; s[si] -= step;
  }

  const liftWith = (bvec) => idx.reduce((acc, j, k) =>
    acc + (bvec[j] || 0) * (hill(A * s[k], halves[k]) - hill(A * s0[k], halves[k])), 0);
  const mid = liftWith(coef);
  const moved = s.some((v, k) => Math.abs(v - s0[k]) / s0[k] > 0.01);
  if (!moved || mid <= 0) return null;

  const liftDraws = coefDraws.map((d) => liftWith(d));
  const lo = Math.min(quantile(liftDraws, 0.1) ?? mid, mid);
  const hi = Math.max(quantile(liftDraws, 0.9) ?? mid, mid);
  // A band that cannot strictly bracket its own point estimate is not a
  // band — decline rather than assert one.
  if (!(lo < mid && mid < hi)) return null;

  return {
    kind: "curve",
    cap: CAP,
    horizonWeeks: HORIZON,
    budgetWeeklyUsd: Number(total.toFixed(2)),
    channels: idx.map((j, k) => ({
      platform: platforms[j],
      currentWeeklyUsd: Number(s0[k].toFixed(2)),
      proposedWeeklyUsd: Number(s[k].toFixed(2)),
      deltaPct: Number((((s[k] - s0[k]) / s0[k]) * 100).toFixed(1)),
    })),
    projectedGain: {
      lo: Number(lo.toFixed(1)), mid: Number(mid.toFixed(1)), hi: Number(hi.toFixed(1)),
    },
    projectedGainHorizon: {
      lo: Number((lo * HORIZON).toFixed(1)), mid: Number((mid * HORIZON).toFixed(1)), hi: Number((hi * HORIZON).toFixed(1)),
    },
    assumptions: [
      "Each channel keeps the response curve the model fit over this period.",
      "Shifts are capped at ±25% of current weekly spend — the model is only trusted near where it was fit.",
      "Projected gain is a resampled 10th–90th percentile band, in units of the outcome, per week.",
      "This is a suggestion for a human to weigh, not an instruction — no budget is changed.",
    ],
  };
}

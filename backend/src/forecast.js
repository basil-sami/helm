import { all, get } from "./db.js";

// ═══ FORECASTING (Wave 3·F) ══════════════════════════════════════════
// Deliberately simple and explainable. These series are short, weekly-
// seasonal and shock-prone; a sophisticated model would overfit them and
// be impossible to defend in a board meeting. No ML dependency, and
// nothing is stored — a forecast is derived, never a fact.

// Below this there is nothing honest to say. A forecast from two weeks of
// data is a guess wearing a chart.
export const MIN_OBSERVATIONS = 21;
const SEASON = 7;                                  // marketing series are weekly

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const std = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

/**
 * Holt's linear trend with damping, plus an additive weekly profile.
 *
 * Damping (phi < 1) is the important part: an undamped trend extrapolated
 * a month out produces the confident nonsense that gets quoted in
 * meetings. A flattening trend is the honest default.
 */
function fitDamped(values, { alpha = 0.4, beta = 0.15, phi = 0.85 } = {}) {
  let level = values[0], trend = values[1] - values[0];
  const fitted = [values[0]];
  for (let i = 1; i < values.length; i++) {
    const prevLevel = level, prevTrend = trend;
    const f = prevLevel + phi * prevTrend;
    fitted.push(f);
    level = alpha * values[i] + (1 - alpha) * f;
    trend = beta * (level - prevLevel) + (1 - beta) * phi * prevTrend;
  }
  return { level, trend, fitted, phi };
}

/** The average deviation of each weekday from its local level. */
function weeklyProfile(values) {
  if (values.length < SEASON * 2) return new Array(SEASON).fill(0);
  const base = mean(values.slice(-SEASON * 3));
  const buckets = Array.from({ length: SEASON }, () => []);
  values.slice(-SEASON * 3).forEach((v, i) => buckets[i % SEASON].push(v - base));
  return buckets.map((b) => (b.length ? mean(b) : 0));
}

/**
 * Forecast a series.
 *
 * Always returns an interval. A single number gets quoted as a promise,
 * and the whole point of a forecast on data this thin is the width of the
 * band, not the middle of it.
 */
export function forecastSeries(values, horizon = 14) {
  const n = values.length;
  if (n < MIN_OBSERVATIONS) {
    return {
      ok: false, refused: true, observations: n, needed: MIN_OBSERVATIONS,
      reason: `A forecast needs at least ${MIN_OBSERVATIONS} days of history; there are ${n}.`,
    };
  }

  const { level, trend, fitted, phi } = fitDamped(values);
  const profile = weeklyProfile(values);

  // one-step-ahead residuals tell us how wrong this method has been on
  // this particular series — the band is earned, not assumed
  const residuals = values.slice(1).map((v, i) => v - fitted[i + 1]);
  const sigma = std(residuals);

  // If the residuals are nearly as large as the series' own variance, the
  // model has explained essentially nothing — and a chart drawn through
  // pure noise is the most confidently misleading thing we could ship.
  const spread = std(values);
  if (spread > 0 && sigma > spread * 0.9) {
    return {
      ok: false, refused: true, observations: n, reason: "This series is too volatile to forecast — the noise is larger than any trend.",
      volatility: Number((sigma / spread).toFixed(2)),
    };
  }

  const points = [];
  let damp = 0;
  for (let h = 1; h <= horizon; h++) {
    damp += Math.pow(phi, h);
    const mid = level + damp * trend + profile[(n + h - 1) % SEASON];
    // uncertainty widens with distance, as it genuinely does
    const band = 1.28 * sigma * Math.sqrt(h);       // ~80%
    points.push({
      ahead: h,
      mid: Number(mid.toFixed(2)),
      lo: Number(Math.max(0, mid - band).toFixed(2)),
      hi: Number((mid + band).toFixed(2)),
    });
  }

  return {
    ok: true,
    method: "damped trend + weekly profile",
    observations: n,
    sigma: Number(sigma.toFixed(2)),
    confidence: 0.8,
    points,
  };
}

async function seriesFor(metricKey, days = 90) {
  const rows = await all(
    `SELECT date, value FROM metric_snapshots
     WHERE "metricKey" = $1 AND dims = '{}'::jsonb AND date >= CURRENT_DATE - $2::int
     ORDER BY date ASC`, [metricKey, days]);
  return rows.map((r) => Number(r.value));
}

export async function forecastMetric(metricKey, { horizon = 14, days = 90 } = {}) {
  const metric = await get(`SELECT key, name, "nameAr", unit, direction FROM metrics WHERE key = $1`, [metricKey]);
  if (!metric) return { ok: false, error: "Unknown metric" };
  const values = await seriesFor(metricKey, days);
  return { metric, ...forecastSeries(values, horizon) };
}

/**
 * Will this target land?
 *
 * Answers with a probability and the range, not a yes — and refuses when
 * the history is too thin to say anything, rather than guessing at the
 * one question people most want a confident answer to.
 */
export async function targetArrival(targetId) {
  const t = await get(
    `SELECT t.*, m.name, m."nameAr", m.unit, m.direction FROM metric_targets t
     JOIN metrics m ON m.key = t."metricKey" WHERE t.id = $1`, [targetId]);
  if (!t) return { ok: false, error: "Target not found" };

  const end = new Date(t.periodEnd);
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 864e5));
  const actual = await get(
    `SELECT COALESCE(SUM(value),0)::float8 v FROM metric_snapshots
     WHERE "metricKey" = $1 AND dims = '{}'::jsonb AND date BETWEEN $2 AND $3`,
    [t.metricKey, t.periodStart, t.periodEnd]);
  const soFar = Number(actual?.v || 0);

  if (daysLeft === 0) {
    return { ok: true, finished: true, target: t.target, actual: soFar, metric: t.name };
  }

  const f = await forecastMetric(t.metricKey, { horizon: daysLeft });
  if (!f.ok) return { ok: false, refused: true, reason: f.reason, daysLeft, actual: soFar, target: t.target };

  const sum = (k) => f.points.reduce((a, p) => a + p[k], 0);
  const projected = { lo: soFar + sum("lo"), mid: soFar + sum("mid"), hi: soFar + sum("hi") };

  // where the target sits inside the projected band, read as a rough chance
  const span = projected.hi - projected.lo;
  const pct = span <= 0 ? (projected.mid >= t.target ? 100 : 0)
    : Math.round(Math.min(100, Math.max(0, ((projected.hi - t.target) / span) * 100)));
  const probability = t.direction === "LOWER" ? 100 - pct : pct;

  return {
    ok: true, metric: t.name, metricAr: t.nameAr, unit: t.unit, target: t.target,
    actual: Number(soFar.toFixed(2)), daysLeft,
    projected: {
      lo: Number(projected.lo.toFixed(2)), mid: Number(projected.mid.toFixed(2)), hi: Number(projected.hi.toFixed(2)),
    },
    probability: Math.round(probability),
    method: f.method, observations: f.observations,
  };
}

/**
 * A budget scenario — explicitly a scenario, not a prophecy.
 *
 * Replays a spend shift against the cost-per-outcome each channel has
 * actually delivered, and says the assumption out loud, because the
 * assumption is the whole risk: past efficiency need not hold, and a
 * channel that looks cheap may simply not scale.
 */
export async function budgetScenario({ shifts = [], days = 90 } = {}) {
  const rows = await all(
    `SELECT platform, SUM("amountUsd")::float8 AS spend, SUM(COALESCE(clicks,0))::float8 AS clicks
     FROM ad_spend WHERE date >= CURRENT_DATE - $1::int GROUP BY platform`, [days]);
  if (!rows.length) return { ok: false, refused: true, reason: "No paid spend recorded in this period." };

  const leads = await get(
    `SELECT COUNT(*)::float8 v FROM leads WHERE "createdAt" >= now() - ($1 || ' days')::interval`, [String(days)]);
  const totalSpend = rows.reduce((a, r) => a + Number(r.spend), 0);
  const totalLeads = Number(leads?.v || 0);
  if (totalSpend <= 0 || totalLeads <= 0) {
    return { ok: false, refused: true, reason: "Not enough spend and outcome history to model a shift." };
  }

  // attribute leads to channels by spend share — stated plainly, because
  // it is the weakest link in the whole calculation
  const channels = rows.map((r) => {
    const share = Number(r.spend) / totalSpend;
    const attributed = totalLeads * share;
    return {
      platform: r.platform,
      spend: Number(Number(r.spend).toFixed(2)),
      leads: Number(attributed.toFixed(1)),
      costPerLead: attributed > 0 ? Number((Number(r.spend) / attributed).toFixed(2)) : null,
    };
  });

  const byPlatform = Object.fromEntries(channels.map((c) => [c.platform, c]));
  const moved = [];
  let delta = 0;
  for (const s of shifts) {
    const from = byPlatform[s.from], to = byPlatform[s.to];
    if (!from || !to || !from.costPerLead || !to.costPerLead) continue;
    const amount = s.amountUsd != null ? Number(s.amountUsd) : from.spend * (Number(s.pct || 0) / 100);
    if (!(amount > 0) || amount > from.spend) continue;
    const lost = amount / from.costPerLead;
    const gained = amount / to.costPerLead;
    delta += gained - lost;
    moved.push({ from: s.from, to: s.to, amountUsd: Number(amount.toFixed(2)),
                 leadsLost: Number(lost.toFixed(1)), leadsGained: Number(gained.toFixed(1)) });
  }
  if (!moved.length) {
    // still hand back the channels, so a caller can offer real choices
    return { ok: false, refused: true, channels,
             reason: "No shift could be modelled from the channels available." };
  }

  // ±35% band: efficiency does not transfer cleanly, and pretending to a
  // point estimate here would be the dishonest part
  const band = Math.abs(delta) * 0.35 + 1;
  return {
    ok: true,
    channels, moved,
    projectedLeadChange: {
      lo: Number((delta - band).toFixed(1)),
      mid: Number(delta.toFixed(1)),
      hi: Number((delta + band).toFixed(1)),
    },
    assumptions: [
      "Each channel keeps the cost per lead it has actually delivered over this period.",
      "Leads are attributed to channels by share of spend, not by tracked source.",
      "A channel that is cheap at its current size may not stay cheap at a larger one.",
    ],
    basedOn: { days, totalSpend: Number(totalSpend.toFixed(2)), totalLeads },
  };
}

/**
 * Back-test: how wrong were we? Forecast from a week ago against what
 * actually happened. The system measuring itself, as with threshold
 * tuning and AI agreement.
 */
export async function backtestAccuracy(metricKey, { holdout = 7 } = {}) {
  const values = await seriesFor(metricKey, 120);
  if (values.length < MIN_OBSERVATIONS + holdout) return { ok: false, refused: true, observations: values.length };
  const train = values.slice(0, -holdout), actual = values.slice(-holdout);
  const f = forecastSeries(train, holdout);
  if (!f.ok) return { ok: false, refused: true, reason: f.reason };

  const errs = actual.map((a, i) => Math.abs(a - f.points[i].mid));
  const scale = mean(actual.map(Math.abs)) || 1;
  const inBand = actual.filter((a, i) => a >= f.points[i].lo && a <= f.points[i].hi).length;
  return {
    ok: true,
    mape: Number(((mean(errs) / scale) * 100).toFixed(1)),
    coverage: Math.round((inBand / actual.length) * 100),   // did the band contain reality?
    holdout,
  };
}

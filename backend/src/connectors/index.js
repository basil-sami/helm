import { all, get, run } from "../db.js";
import { notify, usersWithModuleWrite } from "../notify.js";
import waba from "./waba.js";
import meta from "./meta.js";
import tiktok from "./tiktok.js";
import googleads from "./googleads.js";

// ═══ THE CONNECTOR LAYER (Wave 2·B/D) ════════════════════════════════
// One contract, many platforms. Nothing platform-specific ever reaches
// the product tables: adapters translate, the product stays itself.

// One Meta adapter serves both Page and Instagram accounts; the platform
// on the account row decides which publishing path it takes.
const ADAPTERS = {
  WA: waba, FACEBOOK: meta, INSTAGRAM: meta, TIKTOK: tiktok, GOOGLE: googleads,
};

export const adapterFor = (platform) => ADAPTERS[platform] || null;
export const capsFor = (platform) => ADAPTERS[platform]?.caps || {};
export const platformCaps = () =>
  Object.fromEntries(Object.entries(ADAPTERS).map(([k, a]) => [k, a.caps]));

/** App-level integration config (secrets live here, masked on read). */
export async function integrationCfg(key) {
  const s = await get(`SELECT integrations FROM settings WHERE id = 1`);
  const all_ = typeof s?.integrations === "string" ? JSON.parse(s.integrations || "{}") : (s?.integrations || {});
  return all_[key] || {};
}

/** Every platform call is timed, and its outcome is recorded. */
export async function platformFetch(url, { method = "POST", headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000), // a wedged platform never holds the night hostage
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`.trim());
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

export async function logRun(platform, kind, status, detail, accountId = null) {
  await run(
    `INSERT INTO integration_runs (platform, "accountId", kind, status, detail) VALUES ($1,$2,$3,$4,$5)`,
    [platform, accountId, kind, status, detail ? String(detail).slice(0, 500) : null]).catch(() => {});
}

/** Run an adapter capability with logging and without ever throwing. */
export async function callAdapter(account, kind, fn) {
  const adapter = adapterFor(account.platform);
  if (!adapter) return { ok: false, error: "No connector for this platform" };
  try {
    const cfg = await integrationCfg(adapter.cfgKey);
    const out = await fn(adapter, cfg);
    await logRun(account.platform, kind, "OK", null, account.id);
    return { ok: true, ...out };
  } catch (e) {
    const error = String(e?.message || e).slice(0, 300);
    await logRun(account.platform, kind, "FAILED", error, account.id);
    return { ok: false, error };
  }
}

/** Nightly pull: metrics and paid spend, per connected account. */
export async function syncConnectors() {
  const accounts = await all(
    `SELECT * FROM social_accounts WHERE status = 'CONNECTED' AND "accessToken" IS NOT NULL`);
  let metrics = 0, spend = 0;

  for (const acc of accounts) {
    const adapter = adapterFor(acc.platform);
    if (!adapter) continue;

    if (adapter.caps.metrics) {
      const r = await callAdapter(acc, "METRICS", (a, cfg) => a.pullMetrics(acc, cfg));
      if (r.ok) {
        const has = await get(
          `SELECT id FROM social_metrics WHERE "accountId" = $1 AND date = CURRENT_DATE`, [acc.id]);
        const v = [r.followers || 0, r.posts || 0, r.impressions || 0, r.reach || 0, r.engagement || 0, r.clicks || 0];
        if (has) {
          await run(`UPDATE social_metrics SET followers=$2, posts=$3, impressions=$4, reach=$5,
                     engagement=$6, clicks=$7, source='API' WHERE id=$1`, [has.id, ...v]);
        } else {
          await run(`INSERT INTO social_metrics ("accountId", date, followers, posts, impressions,
                     reach, engagement, clicks, source)
                     VALUES ($1, CURRENT_DATE, $2,$3,$4,$5,$6,$7,'API')`, [acc.id, ...v]);
        }
        metrics++;
      }
    }

    if (adapter.caps.adspend) {
      const r = await callAdapter(acc, "ADSPEND", (a, cfg) => a.pullAdSpend(acc, cfg));
      if (r.ok && Array.isArray(r.rows)) {
        for (const row of r.rows) spend += await upsertSyncedSpend(adapter.key === "GOOGLE" ? "GOOGLE" : acc.platform, row);
      }
    }
  }
  return { metrics, spend };
}

/**
 * Upsert one synced spend row. The budget ledger is written **only on
 * first insert** — a re-sync corrects the numbers without paying twice.
 */
export async function upsertSyncedSpend(platform, row) {
  const plat = ["META", "TIKTOK", "GOOGLE"].includes(platform)
    ? platform
    : platform === "FACEBOOK" || platform === "INSTAGRAM" ? "META" : "OTHER";
  const date = row.date || new Date().toISOString().slice(0, 10);
  const ref = row.campaignRef || null;
  const usd = Number(row.amountUsd) || 0;

  const existing = await get(
    `SELECT id FROM ad_spend WHERE source = 'SYNC' AND platform = $1 AND date = $2
       AND ("campaignRef" IS NOT DISTINCT FROM $3)`, [plat, date, ref]);

  // match the platform's campaign name to a Pulse campaign, if we can
  const camp = ref
    ? await get(`SELECT id FROM campaigns WHERE lower(name) = lower($1) LIMIT 1`, [ref])
    : null;

  if (existing) {
    await run(`UPDATE ad_spend SET "amountUsd" = $2, impressions = $3, clicks = $4,
               "campaignId" = COALESCE($5, "campaignId") WHERE id = $1`,
      [existing.id, usd, row.impressions ?? null, row.clicks ?? null, camp?.id || null]);
    return 0;
  }

  await run(
    `INSERT INTO ad_spend (platform, "campaignId", date, "amountUsd", impressions, clicks, source, "campaignRef")
     VALUES ($1,$2,$3,$4,$5,$6,'SYNC',$7)`,
    [plat, camp?.id || null, date, usd, row.impressions ?? null, row.clicks ?? null, ref]);
  await run(
    `INSERT INTO budget_entries (label, kind, channel, "campaignId", "amountUsd", "amountSdg", date)
     VALUES ($1,'SPENT','PAID',$2,$3,0,$4)`,
    [`Ad spend — ${plat} (synced)`, camp?.id || null, usd, date]).catch(() => {});
  return 1;
}

/** Daily Pulse step: warn before tokens die, quietly. */
export async function connectorSweep() {
  const soon = await all(
    `SELECT id, platform, handle FROM social_accounts
     WHERE status = 'CONNECTED' AND "tokenExpiresAt" IS NOT NULL
       AND "tokenExpiresAt" < now() + interval '7 days'`);
  for (const a of soon) {
    const dup = await get(
      `SELECT 1 FROM notifications WHERE type = 'TOKEN_EXPIRING' AND link = '/social'
         AND "createdAt" > now() - interval '20 hours' LIMIT 1`);
    if (dup) break;
    await notify(await usersWithModuleWrite("social"), "TOKEN_EXPIRING",
      { platform: a.platform, handle: a.handle }, "/social");
  }
  return soon.length;
}

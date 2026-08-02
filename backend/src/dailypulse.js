import { snapshotAll, evaluateAlerts, ensureCatalog, ensureDefaultDashboard } from "./metrics-engine.js";
import { runOsintDaily, hygieneSweep } from "./routes/osint.js";
import { notifyPublishDue } from "./routes/publish.js";
import { recomputeAllScores, hotLeadSweep } from "./automate-engine.js";
import { referralSweep, refreshKeyResults } from "./routes/connect.js";
import { writeMorningDigest } from "./digest.js";
import { emailMorningDigest } from "./mail.js";
import { connectorSweep, syncConnectors } from "./connectors/index.js";
import { runPublishTick } from "./publishtick.js";
import { outreachDueSweep, coldMediaSweep } from "./routes/reach.js";

// ═══ THE DAILY PULSE ═════════════════════════════════════════════════
// One nightly heartbeat for the whole platform:
//   1. metrics — materialize every active catalog metric (core, always)
//   2. alerts  — anomaly checks against trailing baselines
//   3. publish — assisted publishing pings for READY slots ([publish]-gated)
//   4. sweeps  — hygiene nudges (each sweep respects its own module flag)
//   5. intel   — OSINT ingestion + listening alerts (intel-gated inside)
// Sweeps used to live behind the intel gate; the orchestrator freed them.

export async function runDailyPulse() {
  const out = { at: new Date().toISOString() };
  try { out.snapshots = await snapshotAll(); } catch (e) { out.snapshots = 0; out.snapshotsError = e.message; }
  try { out.alertsFired = await evaluateAlerts(); } catch (e) { out.alertsFired = 0; out.alertsError = e.message; }
  try { out.publishDue = await notifyPublishDue(); } catch (e) { out.publishDue = 0; out.publishError = e.message; }
  try { out.rescored = await recomputeAllScores(); } catch (e) { out.rescored = 0; out.rescoreError = e.message; }
  try { out.hotLeads = await hotLeadSweep(); } catch (e) { out.hotLeads = 0; out.hotError = e.message; }
  try { out.keyResults = await refreshKeyResults(); } catch (e) { out.keyResults = 0; out.krError = e.message; }
  try { out.referralsEarned = await referralSweep(); } catch (e) { out.referralsEarned = 0; out.refError = e.message; }
  try { out.outreachDue = await outreachDueSweep(); } catch (e) { out.outreachDue = 0; out.outreachError = e.message; }
  try { out.coldContacts = await coldMediaSweep(); } catch (e) { out.coldContacts = 0; out.coldError = e.message; }
  try { out.sweepPushed = await hygieneSweep(); } catch (e) { out.sweepPushed = 0; out.sweepError = e.message; }
  try { out.intel = await runOsintDaily(); } catch (e) { out.intel = { error: e.message }; }
  try { out.digest = await writeMorningDigest(); } catch (e) { out.digest = 0; out.digestError = e.message; }
  try { out.emails = await emailMorningDigest(); } catch (e) { out.emails = 0; out.emailError = e.message; }
  try { out.tokens = await connectorSweep(); } catch (e) { out.tokens = 0; out.tokenError = e.message; }
  try {
    const { pruneErrors } = await import("./observability.js");
    out.errorsPruned = await pruneErrors();
  } catch { out.errorsPruned = 0; }
  try {
    const { corroborationSweep } = await import("./osint/corroborate.js");
    out.corroboration = await corroborationSweep();
  } catch (e) { out.corroboration = null; out.corrError = e.message; }
  try { out.sync = await syncConnectors(); } catch (e) { out.sync = null; out.syncError = e.message; }
  // also tick here so hobby-tier hosts without a 15-minute cron still publish
  try { out.publishTick = await runPublishTick(); } catch (e) { out.publishTick = null; out.tickError = e.message; }
  return out;
}

// Vercel Cron entrypoint (CRON_SECRET-guarded; Vercel sends the Bearer).
export async function dailyPulseCronHandler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  if (secret) {
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: "Invalid cron secret" });
  } else if (process.env.NODE_ENV === "production") {
    return res.status(401).json({ error: "Set CRON_SECRET to enable the Daily Pulse" });
  }
  res.json({ ok: true, ...(await runDailyPulse()) });
}

// Idempotent seeding used lazily by routes (catalog + default board).
export async function bootAnalytics() {
  try { await ensureCatalog(); await ensureDefaultDashboard(); } catch { /* schema may not exist yet */ }
}

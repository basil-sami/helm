import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { syncAccount, PLATFORMS } from "../integrations/social.js";

export const socialRouter = Router();
socialRouter.use(requireAuth);

const num = (v) => Number(v || 0);

// ── Accounts ─────────────────────────────────────────────────────────
socialRouter.get("/accounts", requirePerm("social", "read"), async (_req, res, next) => {
  try {
    const rows = await all(`
      SELECT a.id, a.platform, a.handle, a."displayName", a.status, a."externalId",
        a."connectedAt", a."createdAt",
        (a."accessToken" IS NOT NULL) AS "hasToken",
        (SELECT followers FROM social_metrics m WHERE m."accountId" = a.id ORDER BY m.date DESC LIMIT 1) AS "latestFollowers",
        (SELECT COUNT(*)::int FROM social_metrics m WHERE m."accountId" = a.id) AS "metricCount"
      FROM social_accounts a ORDER BY a."createdAt" DESC`);
    res.json(rows);
  } catch (e) { next(e); }
});

// Never return the stored access token to clients.
const ACCOUNT_PUBLIC = `id, platform, handle, "displayName", status, "externalId", "connectedAt", "createdAt", ("accessToken" IS NOT NULL) AS "hasToken"`;

// Connect / add an account. Storing a token marks it CONNECTED.
socialRouter.post("/accounts", requirePerm("social"), async (req, res, next) => {
  const { platform, handle, displayName, accessToken, externalId } = req.body;
  if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: "Unsupported platform" });
  if (!handle) return res.status(400).json({ error: "Handle is required" });
  try {
    const status = accessToken ? "CONNECTED" : "PENDING";
    const connectedAt = accessToken ? new Date().toISOString() : null;
    const row = await get(
      `INSERT INTO social_accounts (platform, handle, "displayName", "accessToken", "externalId", status, "connectedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${ACCOUNT_PUBLIC}`,
      [platform, handle, displayName || null, accessToken || null, externalId || null, status, connectedAt]
    );
    res.status(201).json(row);
  } catch (e) { next(e); }
});

socialRouter.patch("/accounts/:id", requirePerm("social"), async (req, res, next) => {
  const sets = [], params = [];
  const push = (col, val) => { params.push(val); sets.push(`"${col}" = $${params.length}`); };
  if (req.body.handle !== undefined) push("handle", req.body.handle);
  if (req.body.displayName !== undefined) push("displayName", req.body.displayName);
  if (req.body.status !== undefined) push("status", req.body.status);
  if (req.body.accessToken !== undefined) {
    push("accessToken", req.body.accessToken || null);
    push("status", req.body.accessToken ? "CONNECTED" : "DISCONNECTED");
    push("connectedAt", req.body.accessToken ? new Date().toISOString() : null);
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields" });
  try {
    params.push(req.params.id);
    await run(`UPDATE social_accounts SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    res.json(await get(`SELECT ${ACCOUNT_PUBLIC} FROM social_accounts WHERE id = $1`, [req.params.id]));
  } catch (e) { next(e); }
});

socialRouter.delete("/accounts/:id", requirePerm("social"), async (req, res, next) => {
  try { await run("DELETE FROM social_accounts WHERE id = $1", [req.params.id]); res.status(204).end(); }
  catch (e) { next(e); }
});

// ── Metrics (the data fed in) ────────────────────────────────────────
socialRouter.get("/metrics", requirePerm("social", "read"), async (req, res, next) => {
  try {
    const { accountId } = req.query;
    const rows = accountId
      ? await all(`SELECT * FROM social_metrics WHERE "accountId" = $1 ORDER BY date DESC LIMIT 365`, [accountId])
      : await all(`SELECT m.*, a.platform, a.handle FROM social_metrics m JOIN social_accounts a ON a.id = m."accountId" ORDER BY m.date DESC LIMIT 500`);
    res.json(rows);
  } catch (e) { next(e); }
});

const METRIC_COLS = ["followers", "posts", "impressions", "reach", "engagement", "clicks", "spendUsd"];

// Add a single metric row (manual entry).
socialRouter.post("/metrics", requirePerm("social"), async (req, res, next) => {
  const { accountId, date, source } = req.body;
  if (!accountId) return res.status(400).json({ error: "accountId is required" });
  try {
    const cols = ['"accountId"', "date", "source"];
    const vals = [accountId, date || new Date().toISOString().slice(0, 10), source || "MANUAL"];
    for (const c of METRIC_COLS) { cols.push(`"${c}"`); vals.push(num(req.body[c])); }
    const ph = vals.map((_, i) => `$${i + 1}`).join(",");
    const row = await get(`INSERT INTO social_metrics (${cols.join(",")}) VALUES (${ph}) RETURNING *`, vals);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// Bulk import (CSV parsed client-side or pasted rows). Body: { accountId, rows:[...], source }
socialRouter.post("/metrics/import", requirePerm("social"), async (req, res, next) => {
  const { accountId, rows, source } = req.body;
  if (!accountId || !Array.isArray(rows)) return res.status(400).json({ error: "accountId and rows[] required" });
  try {
    let inserted = 0;
    for (const r of rows) {
      const cols = ['"accountId"', "date", "source"];
      const vals = [accountId, r.date || new Date().toISOString().slice(0, 10), source || "CSV"];
      for (const c of METRIC_COLS) { cols.push(`"${c}"`); vals.push(num(r[c])); }
      const ph = vals.map((_, i) => `$${i + 1}`).join(",");
      await run(`INSERT INTO social_metrics (${cols.join(",")}) VALUES (${ph})`, vals);
      inserted++;
    }
    res.json({ inserted });
  } catch (e) { next(e); }
});

socialRouter.delete("/metrics/:id", requirePerm("social"), async (req, res, next) => {
  try { await run("DELETE FROM social_metrics WHERE id = $1", [req.params.id]); res.status(204).end(); }
  catch (e) { next(e); }
});

// ── Live sync via platform adapter (requires the account's accessToken) ─
socialRouter.post("/accounts/:id/sync", requirePerm("social"), async (req, res, next) => {
  try {
    const account = await get("SELECT * FROM social_accounts WHERE id = $1", [req.params.id]);
    if (!account) return res.status(404).json({ error: "Account not found" });
    const result = await syncAccount(account); // throws NotConfigured if no adapter/token
    // Persist the returned snapshot as today's metric row.
    const cols = ['"accountId"', "date", "source"];
    const vals = [account.id, new Date().toISOString().slice(0, 10), "API"];
    for (const c of METRIC_COLS) { cols.push(`"${c}"`); vals.push(num(result[c])); }
    const ph = vals.map((_, i) => `$${i + 1}`).join(",");
    const row = await get(`INSERT INTO social_metrics (${cols.join(",")}) VALUES (${ph}) RETURNING *`, vals);
    res.json({ synced: true, metric: row });
  } catch (e) {
    if (e.code === "NOT_CONFIGURED") return res.status(422).json({ error: e.message, code: e.code });
    if (e.code === "SYNC_FAILED") return res.status(502).json({ error: e.message, code: e.code });
    next(e);
  }
});

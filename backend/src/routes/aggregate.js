import { Router } from "express";
import { all, get, run } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { logAudit } from "../audit.js";
import { MODULE_KEYS, invalidateModulesCache } from "../flags.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (_req, res, next) => {
  try {
    const num = (v) => Number(v || 0);
    const [
      activeCampaigns, totalCampaigns, openTasks,
      upcomingEvents, contentDue, spent, planned, byChannel,
      byStage, won, openPipe, setting,
    ] = await Promise.all([
      get("SELECT COUNT(*)::int AS n FROM campaigns WHERE status = 'ACTIVE'"),
      get("SELECT COUNT(*)::int AS n FROM campaigns"),
      get("SELECT COUNT(*)::int AS n FROM tasks WHERE status <> 'DONE'"),
      all(`SELECT e.*, u.name AS "ownerName" FROM events e LEFT JOIN users u ON u.id = e."ownerId"
           WHERE e.status IN ('PLANNED','CONFIRMED','RUNNING') ORDER BY e."startDate" ASC NULLS LAST LIMIT 5`),
      all(`SELECT ci.*, c.name AS "campaignName" FROM content_items ci LEFT JOIN campaigns c ON c.id = ci."campaignId"
           WHERE ci.status IN ('IDEA','IN_PROGRESS','REVIEW') ORDER BY ci."scheduledAt" ASC NULLS LAST LIMIT 6`),
      get(`SELECT COALESCE(SUM("amountUsd"),0) AS usd, COALESCE(SUM("amountSdg"),0) AS sdg FROM budget_entries WHERE kind = 'SPENT'`),
      get(`SELECT COALESCE(SUM("amountUsd"),0) AS usd, COALESCE(SUM("amountSdg"),0) AS sdg FROM budget_entries WHERE kind = 'PLANNED'`),
      all(`SELECT channel, COALESCE(SUM("amountUsd"),0) AS usd, COALESCE(SUM("amountSdg"),0) AS sdg
           FROM budget_entries WHERE kind = 'SPENT' GROUP BY channel ORDER BY usd DESC`),
      all(`SELECT stage, COUNT(*)::int AS count, COALESCE(SUM("valueUsd"),0) AS usd, COALESCE(SUM("valueSdg"),0) AS sdg
           FROM leads GROUP BY stage`),
      get(`SELECT COALESCE(SUM("valueUsd"),0) AS usd, COALESCE(SUM("valueSdg"),0) AS sdg FROM leads WHERE stage = 'WON'`),
      get(`SELECT COALESCE(SUM("valueUsd"),0) AS usd, COALESCE(SUM("valueSdg"),0) AS sdg
           FROM leads WHERE stage IN ('NEW','QUALIFIED','PROPOSAL','NEGOTIATION')`),
      get("SELECT * FROM settings WHERE id = 1"),
    ]);

    res.json({
      kpis: {
        activeCampaigns: activeCampaigns.n, totalCampaigns: totalCampaigns.n,
        openTasks: openTasks.n, upcomingEventCount: upcomingEvents.length,
      },
      budget: {
        spentUsd: num(spent.usd), spentSdg: num(spent.sdg),
        plannedUsd: num(planned.usd), plannedSdg: num(planned.sdg),
        byChannel: byChannel.map((r) => ({ channel: r.channel, usd: num(r.usd), sdg: num(r.sdg) })),
      },
      pipeline: {
        byStage: byStage.map((r) => ({ stage: r.stage, count: r.count, usd: num(r.usd), sdg: num(r.sdg) })),
        wonUsd: num(won.usd), wonSdg: num(won.sdg), openUsd: num(openPipe.usd), openSdg: num(openPipe.sdg),
      },
      upcomingEvents, contentDue,
      setting: { ...(setting || {}), usdToSdgRate: num(setting?.usdToSdgRate) },
    });
  } catch (e) { next(e); }
});

export const settingsRouter = Router();
settingsRouter.use(requireAuth);
// The SMTP password never leaves the server — callers get `hasPass`.
export function maskMail(row) {
  if (!row) return row;
  const m = typeof row.mail === "string" ? JSON.parse(row.mail || "{}") : (row.mail || {});
  const { pass, apiKey, ...rest } = m;
  const ints = typeof row.integrations === "string" ? JSON.parse(row.integrations || "{}") : (row.integrations || {});
  const SECRETS = ["appSecret", "verifyToken", "developerToken", "refreshToken", "clientSecret", "token", "apiKey", "youtubeApiKey"];
  const safeInts = {};
  for (const [k, v] of Object.entries(ints)) {
    const cleaned = { ...(v || {}) };
    for (const sec of SECRETS) if (cleaned[sec] !== undefined) {
      cleaned[`has${sec[0].toUpperCase()}${sec.slice(1)}`] = !!cleaned[sec];
      delete cleaned[sec];
    }
    // any key that smells like a credential (…Key, …Secret, …Token) is masked too
    for (const key of Object.keys(cleaned)) {
      if (/(key|secret|token|pass)/i.test(key)) {
        cleaned[`has${key[0].toUpperCase()}${key.slice(1)}`] = !!cleaned[key];
        delete cleaned[key];
      }
    }
    safeInts[k] = cleaned;
  }
  return { ...row, mail: { ...rest, hasPass: !!pass, hasKey: !!apiKey }, integrations: safeInts };
}
settingsRouter.get("/", async (req, res, next) => {
  try {
    const row = await get("SELECT * FROM settings WHERE id = 1");
    const masked = maskMail(row);
    if (!req.user?.permissions?.admin) {
      // Non-admins get branding + flags only — never connection details
      // (SMTP endpoints, provider URLs, or any integration config).
      const { mail, integrations, ...safe } = masked;
      res.json(safe);
      return;
    }
    res.json(masked);
  } catch (e) { next(e); }
});
settingsRouter.patch("/", requireAdmin, async (req, res, next) => {
  const sets = [], params = [];
  if (req.body.usdToSdgRate !== undefined) { params.push(Number(req.body.usdToSdgRate)); sets.push(`"usdToSdgRate" = $${params.length}`); }
  if (req.body.orgName !== undefined) { params.push(req.body.orgName); sets.push(`"orgName" = $${params.length}`); }
  if (req.body.orgNameAr !== undefined) { params.push(req.body.orgNameAr); sets.push(`"orgNameAr" = $${params.length}`); }
  if (req.body.staleLeadDays !== undefined) { params.push(Math.max(1, parseInt(req.body.staleLeadDays, 10) || 3)); sets.push(`"staleLeadDays" = $${params.length}`); }
  if (req.body.customerReviewDays !== undefined) { params.push(Math.max(7, parseInt(req.body.customerReviewDays, 10) || 90)); sets.push(`"customerReviewDays" = $${params.length}`); }
  // ── Wave 0 · per-client branding & configuration ──────────────────
  if (req.body.logoUrl !== undefined) { params.push(req.body.logoUrl || null); sets.push(`"logoUrl" = $${params.length}`); }
  if (req.body.accentColor !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(req.body.accentColor))) return res.status(400).json({ error: "accentColor must be a #RRGGBB hex color" });
    params.push(String(req.body.accentColor).toUpperCase()); sets.push(`"accentColor" = $${params.length}`);
  }
  if (req.body.localCurrency !== undefined) {
    const code = String(req.body.localCurrency).trim().toUpperCase();
    if (!/^[A-Z]{2,5}$/.test(code)) return res.status(400).json({ error: "localCurrency must be a 2–5 letter code" });
    params.push(code); sets.push(`"localCurrency" = $${params.length}`);
  }
  if (req.body.localCurrencyAr !== undefined) { params.push(String(req.body.localCurrencyAr).trim() || "ج.س"); sets.push(`"localCurrencyAr" = $${params.length}`); }
  if (req.body.businessUnits !== undefined) {
    if (!Array.isArray(req.body.businessUnits)) return res.status(400).json({ error: "businessUnits must be an array of strings" });
    const units = req.body.businessUnits.map((u) => String(u).trim()).filter(Boolean).slice(0, 30);
    params.push(JSON.stringify(units)); sets.push(`"businessUnits" = $${params.length}`);
  }
  if (req.body.modules !== undefined) {
    const m = req.body.modules;
    if (!m || typeof m !== "object" || Array.isArray(m)) return res.status(400).json({ error: "modules must be an object of booleans" });
    const clean = {};
    for (const k of MODULE_KEYS) if (m[k] !== undefined) clean[k] = !!m[k];
    params.push(JSON.stringify(clean)); sets.push(`"modules" = $${params.length}`);
  }
  if (req.body.onboarded !== undefined) { params.push(!!req.body.onboarded); sets.push(`"onboarded" = $${params.length}`); }
  // ── Wave 2·B/D · integration secrets; blank values keep what's stored ──
  if (req.body.integrations !== undefined) {
    const inc = req.body.integrations;
    if (!inc || typeof inc !== "object" || Array.isArray(inc)) return res.status(400).json({ error: "integrations must be an object" });
    const cur = await get(`SELECT integrations FROM settings WHERE id = 1`);
    const prev = typeof cur?.integrations === "string" ? JSON.parse(cur.integrations || "{}") : (cur?.integrations || {});
    const SECRETS = ["appSecret", "verifyToken", "developerToken", "refreshToken", "clientSecret", "token", "apiKey"];
    const merged = { ...prev };
    for (const [plat, vals] of Object.entries(inc)) {
      if (!vals || typeof vals !== "object") continue;
      const before = merged[plat] || {};
      const after = { ...before };
      for (const [k, v] of Object.entries(vals)) {
        if (k.startsWith("has")) continue;                       // never write back a mask
        if (SECRETS.includes(k) && !v) continue;                  // empty secret = keep
        after[k] = typeof v === "string" ? v.trim() : v;
      }
      merged[plat] = after;
    }
    params.push(JSON.stringify(merged)); sets.push(`"integrations" = $${params.length}`);
  }
  // ── Wave 2·A · SMTP config; an empty pass means "keep the stored one" ──
  if (req.body.mail !== undefined) {
    const m = req.body.mail;
    if (!m || typeof m !== "object" || Array.isArray(m)) return res.status(400).json({ error: "mail must be an object" });
    const cur = await get(`SELECT mail FROM settings WHERE id = 1`);
    const prev = typeof cur?.mail === "string" ? JSON.parse(cur.mail || "{}") : (cur?.mail || {});
    const next = {
      host: m.host !== undefined ? String(m.host || "").trim() : prev.host || "",
      port: m.port !== undefined ? Number(m.port) || 587 : prev.port || 587,
      secure: m.secure !== undefined ? !!m.secure : !!prev.secure,
      user: m.user !== undefined ? String(m.user || "").trim() : prev.user || "",
      from: m.from !== undefined ? String(m.from || "").trim() : prev.from || "",
      fromName: m.fromName !== undefined ? String(m.fromName || "").trim() : prev.fromName || "",
      pass: m.pass ? String(m.pass) : prev.pass || "",
      // ── HTTP provider rail (Resend & compatible) ──
      provider: m.provider !== undefined
        ? (["SMTP", "RESEND"].includes(String(m.provider)) ? String(m.provider) : "")
        : prev.provider || "",
      apiUrl: m.apiUrl !== undefined ? String(m.apiUrl || "").trim() : prev.apiUrl || "",
      apiKey: m.apiKey ? String(m.apiKey) : prev.apiKey || "",
    };
    params.push(JSON.stringify(next)); sets.push(`"mail" = $${params.length}`);
  }
  try {
    if (sets.length) await run(`UPDATE settings SET ${sets.join(", ")} WHERE id = 1`, params);
    invalidateModulesCache();
    logAudit(req, "settings.update", "settings");
    res.json(maskMail(await get("SELECT * FROM settings WHERE id = 1")));
  } catch (e) { next(e); }
});

// ── Wave 2·A · mail: admin test-send + delivery log ──────────────────
export const mailRouter = Router();
mailRouter.use(requireAuth);

mailRouter.get("/log", requireAdmin, async (_req, res, next) => {
  try {
    res.json(await all(`SELECT id, kind, "to", subject, status, error, "sentAt" FROM mail_log ORDER BY "sentAt" DESC LIMIT 50`));
  } catch (e) { next(e); }
});

mailRouter.post("/test", requireAdmin, async (req, res, next) => {
  try {
    const { sendMail, getMailCfg, renderMorningHtml } = await import("../mail.js");
    const configured = !!(await getMailCfg());
    const r = await sendMail({
      to: req.user.email,
      subject: "نبض — رسالة تجريبية",
      html: renderMorningHtml({ date: new Date().toISOString().slice(0, 10), pulse: { value: null, delta: 0 } }),
      kind: "TEST",
    });
    logAudit(req, "mail.test", "mail_log", null, { status: r.status });
    res.json({ ...r, configured, to: req.user.email });
  } catch (e) { next(e); }
});

// ── Wave 2·B · integration activity feed ─────────────────────────────
export const integrationRunsRouter = Router();
integrationRunsRouter.use(requireAuth, requireAdmin);
integrationRunsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await all(`SELECT id, platform, "accountId", kind, status, detail, at
                        FROM integration_runs ORDER BY at DESC LIMIT 50`));
  } catch (e) { next(e); }
});

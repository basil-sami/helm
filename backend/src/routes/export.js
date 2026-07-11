import { Router } from "express";
import { all } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { run } from "../db.js";
import { logAudit } from "../audit.js";

export const exportRouter = Router();
exportRouter.use(requireAuth);

// ── Data sovereignty: full JSON backup of every table (admin only) ─────
// Your data lives in YOUR database; this proves you can take all of it
// out at any time. Password hashes are excluded by design.
const BACKUP_TABLES = [
  "users", "roles", "settings",
  "campaigns", "products", "segments", "personas", "campaign_briefs",
  "content_items", "posts", "assets",
  "leads", "lead_activities", "customers", "feedback",
  "events", "event_registrations",
  "budget_entries", "tasks", "objectives", "process_templates",
  "tracked_links", "media_contacts", "press_items", "influencers", "influencer_collabs",
  "social_accounts", "social_metrics", "osint_topics", "osint_signals",
  "audit_log",
].map((t) => [
  t,
  t === "users"
    ? `SELECT id, name, email, role, "titleAr", active, "createdAt" FROM users ORDER BY "createdAt"`
    : t === "social_accounts"
      ? `SELECT id, platform, handle, "displayName", status, "createdAt" FROM social_accounts ORDER BY "createdAt"`
      : `SELECT * FROM ${t} ORDER BY "createdAt"`,
]);

exportRouter.get("/backup", requireAdmin, async (_req, res, next) => {
  try {
    const tables = {};
    for (const [name, sql] of BACKUP_TABLES) {
      try { tables[name] = await all(sql); }
      catch { tables[name] = []; /* table may not exist pre-migration */ }
    }
    const payload = { app: "HELM حلم", exportedAt: new Date().toISOString(), tables };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="helm-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(payload, null, 1));
  } catch (e) { next(e); }
});

// Map of exportable resources -> SQL (with friendly joined columns).
const SOURCES = {
  campaigns: `SELECT c.name, c."nameAr", c.status, c.channel, c."businessUnit",
                c."startDate", c."endDate", c."budgetUsd", c."budgetSdg", u.name AS owner
              FROM campaigns c LEFT JOIN users u ON u.id = c."ownerId" ORDER BY c."createdAt" DESC`,
  leads: `SELECT l.company, l."contactName", l.email, l.phone, l.source, l."businessUnit",
            l.stage, l."valueUsd", l."valueSdg", u.name AS owner, l."updatedAt"
          FROM leads l LEFT JOIN users u ON u.id = l."ownerId" ORDER BY l."updatedAt" DESC`,
  events: `SELECT e.name, e."nameAr", e.type, e.venue, e.city, e."startDate", e."endDate",
            e.status, e."budgetUsd", e."budgetSdg", u.name AS owner
          FROM events e LEFT JOIN users u ON u.id = e."ownerId" ORDER BY e."startDate"`,
  budget: `SELECT b.label, b.kind, b.channel, b."amountUsd", b."amountSdg", b.date, c.name AS campaign
           FROM budget_entries b LEFT JOIN campaigns c ON c.id = b."campaignId" ORDER BY b.date DESC`,
  content: `SELECT ci.title, ci."titleAr", ci.channel, ci.status, ci."scheduledAt",
              c.name AS campaign, u.name AS author
            FROM content_items ci LEFT JOIN campaigns c ON c.id = ci."campaignId"
            LEFT JOIN users u ON u.id = ci."authorId" ORDER BY ci."scheduledAt"`,
  tasks: `SELECT t.title, t.status, t.priority, t."dueDate", u.name AS assignee, c.name AS campaign
          FROM tasks t LEFT JOIN users u ON u.id = t."assigneeId"
          LEFT JOIN campaigns c ON c.id = t."campaignId" ORDER BY t."createdAt" DESC`,
  metrics: `SELECT a.platform, a.handle, m.date, m.followers, m.posts, m.impressions,
              m.reach, m.engagement, m.clicks, m."spendUsd", m.source
            FROM social_metrics m JOIN social_accounts a ON a.id = m."accountId" ORDER BY m.date DESC`,
  signals: `SELECT t.label AS topic, t.category, s.title, s.source, s."sourceType",
              s."sentimentLabel", s.sentiment, s."publishedAt", s.url
            FROM osint_signals s JOIN osint_topics t ON t.id = s."topicId"
            ORDER BY COALESCE(s."publishedAt", s."fetchedAt") DESC`,
};

function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  return lines.join("\n");
}

exportRouter.get("/:resource", async (req, res, next) => {
  const { resource } = req.params;
  const format = (req.query.format || "csv").toString();
  const sql = SOURCES[resource];
  if (!sql) return res.status(404).json({ error: "Unknown export resource" });
  try {
    const rows = await all(sql);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      res.setHeader("Content-Disposition", `attachment; filename="helm-${resource}-${stamp}.json"`);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.send(JSON.stringify(rows, null, 2));
    }
    // CSV with a UTF-8 BOM so Arabic renders correctly in Excel.
    res.setHeader("Content-Disposition", `attachment; filename="helm-${resource}-${stamp}.csv"`);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send("\uFEFF" + toCsv(rows));
  } catch (e) { next(e); }
});

// ── Restore (operational data only) ──────────────────────────────────
// Users, roles, audit, and notifications are never restored (identity &
// history stay intact). Order respects foreign keys; child tables first
// on delete, parents first on insert. Aborts on the first failing table.
const RESTORE_ORDER = [
  "campaigns", "products", "segments", "personas", "events", "objectives",
  "content_items", "leads", "budget_entries", "tasks",
  "campaign_briefs", "tracked_links", "event_registrations", "customers",
  "media_contacts", "press_items", "influencers", "influencer_collabs",
  "posts", "assets", "feedback", "lead_activities",
  "social_accounts", "social_metrics", "osint_topics", "osint_signals",
  "process_templates",
];

exportRouter.post("/restore", requireAdmin, async (req, res, next) => {
  const tables = req.body?.tables;
  if (!tables || typeof tables !== "object") return res.status(400).json({ error: "Expected a HELM backup JSON ({ tables: ... })" });
  const restored = {};
  try {
    for (const t of [...RESTORE_ORDER].reverse()) {
      if (Array.isArray(tables[t])) await run(`DELETE FROM ${t}`);
    }
    for (const t of RESTORE_ORDER) {
      const rows = tables[t];
      if (!Array.isArray(rows)) continue;
      let n = 0;
      for (const row of rows) {
        const cols = Object.keys(row).filter((k) => row[k] !== undefined);
        if (!cols.length) continue;
        const vals = cols.map((k) => {
          const v = row[k];
          return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
        });
        await run(
          `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(",")})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals);
        n++;
      }
      restored[t] = n;
    }
    if (tables.settings?.[0]) {
      const st = tables.settings[0];
      await run(`UPDATE settings SET "usdToSdgRate" = COALESCE($1, "usdToSdgRate") WHERE id = 1`, [st.usdToSdgRate ?? null]).catch(() => {});
    }
    logAudit(req, "export.restore", "database", null, { tables: Object.keys(restored).length });
    res.json({ ok: true, restored });
  } catch (e) {
    res.status(500).json({ ok: false, error: `Restore failed at a table — database may be partially restored. ${e.message}`, restored });
  }
});
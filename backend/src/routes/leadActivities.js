import { Router } from "express";
import { all, get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logActivity } from "../leadlog.js";
import { logAudit } from "../audit.js";

export const leadActivitiesRouter = Router();
leadActivitiesRouter.use(requireAuth);

leadActivitiesRouter.get("/:id/activities", requirePerm("leads", "read"), async (req, res, next) => {
  try {
    res.json(await all(
      `SELECT id, "actorName", kind, body, meta, "createdAt"
       FROM lead_activities WHERE "leadId" = $1 ORDER BY "createdAt" DESC LIMIT 100`, [req.params.id]));
  } catch { res.json([]); /* pre-migration */ }
});

leadActivitiesRouter.post("/:id/notes", requirePerm("leads"), async (req, res, next) => {
  const body = (req.body?.body || "").trim();
  if (!body || body.length > 2000) return res.status(400).json({ error: "Note must be 1–2000 characters" });
  try {
    const lead = await get(`SELECT id FROM leads WHERE id = $1`, [req.params.id]);
    if (!lead) return res.status(404).json({ error: "Not found" });
    const row = await logActivity(req, req.params.id, "NOTE", body);
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// CSV import: header row + up to 500 rows. Known columns are mapped;
// unknown columns are ignored. company + phone required per row.
leadActivitiesRouter.post("/import", requirePerm("leads"), async (req, res, next) => {
  const csv = String(req.body?.csv || "");
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 501) return res.status(400).json({ error: "CSV needs a header + 1–500 rows" });
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iCompany = col("company"), iName = col("contactname"), iPhone = col("phone"),
        iEmail = col("email"), iSource = col("source"), iValue = col("valueusd");
  if (iCompany === -1) return res.status(400).json({ error: "CSV must include a 'company' column" });
  let created = 0, skipped = 0;
  try {
    for (const line of lines.slice(1)) {
      const c = line.split(",").map((x) => x.trim());
      const company = c[iCompany] || "";
      const phone = iPhone !== -1 ? c[iPhone] || "" : "";
      if (company.length < 2) { skipped++; continue; }
      const row = await get(
        `INSERT INTO leads (company, "contactName", phone, email, source, "valueUsd")
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [company.slice(0, 200), iName !== -1 ? (c[iName] || null) : null, phone.slice(0, 40) || null,
         iEmail !== -1 ? (c[iEmail] || null) : null,
         iSource !== -1 ? (c[iSource] || "IMPORT") : "IMPORT",
         iValue !== -1 ? (parseFloat(c[iValue]) || 0) : 0]);
      logActivity(req, row.id, "CREATED", null, { via: "IMPORT" });
      created++;
    }
    logAudit(req, "leads.import", "leads", null, { created, skipped });
    res.status(201).json({ created, skipped });
  } catch (e) { next(e); }
});
import { Router } from "express";
import { crudRouter } from "../crud.js";
import { get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";

// ── CONTACTS (Wave 1·B) — the audience layer ─────────────────────────
// Not every human is a sales lead. Consent is first-class data:
// [{ channel, grantedAt, revokedAt?, source }] — an append-only story
// regulated clients can show an auditor.

export const CONSENT_CHANNELS = ["WHATSAPP", "EMAIL", "SMS", "CALL"];
const jsonFix = (...keys) => async (data) => {
  for (const k of keys) if (data[k] !== undefined && typeof data[k] === "object") data[k] = JSON.stringify(data[k]);
  return null;
};

export const contactsRouter = crudRouter({
  table: "contacts",
  module: "leads",
  touchUpdatedAt: true,
  fields: ["name", "phone", "email", "company", "tags", "consent", "leadId", "customerId"],
  listSql: `SELECT c.*, l.company AS "leadCompany", cu.company AS "customerName"
            FROM contacts c
            LEFT JOIN leads l ON l.id = c."leadId"
            LEFT JOIN customers cu ON cu.id = c."customerId"
            ORDER BY c."createdAt" DESC`,
  validateCreate: async (data) => {
    if (!data.name && !data.email && !data.phone) return "A contact needs a name, phone, or email";
    if (!data.name) data.name = data.email || data.phone;
    return jsonFix("tags", "consent")(data);
  },
  validateUpdate: jsonFix("tags", "consent"),
});

const parseConsent = (c) => { try { return typeof c === "string" ? JSON.parse(c || "[]") : (c || []); } catch { return []; } };

/** Find by email/phone or create; enrich missing fields; append consent grant. */
export async function findOrCreateContact({ name, email, phone, company, consentChannel, consentSource } = {}) {
  email = String(email || "").trim().toLowerCase() || null;
  phone = String(phone || "").trim() || null;
  if (!email && !phone) return null;
  let c = null;
  if (email) c = await get(`SELECT * FROM contacts WHERE lower(email) = $1 LIMIT 1`, [email]);
  if (!c && phone) c = await get(`SELECT * FROM contacts WHERE phone = $1 LIMIT 1`, [phone]);
  const now = new Date().toISOString();
  if (!c) {
    const consent = consentChannel ? [{ channel: consentChannel, grantedAt: now, source: consentSource || null }] : [];
    return await get(
      `INSERT INTO contacts (name, email, phone, company, consent) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [String(name || email || phone).slice(0, 160), email, phone, company ? String(company).slice(0, 200) : null, JSON.stringify(consent)]
    );
  }
  const consent = parseConsent(c.consent);
  const sets = []; const vals = []; let i = 1;
  if (consentChannel && !consent.some((e) => e.channel === consentChannel && !e.revokedAt)) {
    consent.push({ channel: consentChannel, grantedAt: now, source: consentSource || null });
    sets.push(`consent = $${i++}`); vals.push(JSON.stringify(consent));
  }
  if (!c.email && email) { sets.push(`email = $${i++}`); vals.push(email); }
  if (!c.phone && phone) { sets.push(`phone = $${i++}`); vals.push(phone); }
  if (!c.company && company) { sets.push(`company = $${i++}`); vals.push(String(company).slice(0, 200)); }
  if (sets.length) {
    vals.push(c.id);
    c = await get(`UPDATE contacts SET ${sets.join(", ")}, "updatedAt" = now() WHERE id = $${i} RETURNING *`, vals);
  }
  return c;
}

// Grant / revoke consent per channel — the auditable path the UI uses.
export const contactsConsentRouter = Router();
contactsConsentRouter.use(requireAuth, requirePerm("leads", "write"));
contactsConsentRouter.post("/:id/consent", async (req, res, next) => {
  try {
    const { channel, granted, source } = req.body || {};
    if (!CONSENT_CHANNELS.includes(channel)) return res.status(400).json({ error: "channel must be one of " + CONSENT_CHANNELS.join(", ") });
    const c = await get(`SELECT * FROM contacts WHERE id = $1`, [req.params.id]);
    if (!c) return res.status(404).json({ error: "Not found" });
    const consent = parseConsent(c.consent);
    const now = new Date().toISOString();
    const active = consent.find((e) => e.channel === channel && !e.revokedAt);
    if (granted === false) {
      if (!active) return res.status(409).json({ error: "No active consent for that channel" });
      active.revokedAt = now;
    } else {
      if (active) return res.status(409).json({ error: "Consent already granted for that channel" });
      consent.push({ channel, grantedAt: now, source: source ? String(source).slice(0, 120) : `user:${req.user.name}` });
    }
    const updated = await get(`UPDATE contacts SET consent = $2, "updatedAt" = now() WHERE id = $1 RETURNING *`,
      [c.id, JSON.stringify(consent)]);
    logAudit(req, granted === false ? "contacts.consent_revoke" : "contacts.consent_grant", "contacts", c.id, { channel });
    res.json(updated);
  } catch (e) { next(e); }
});

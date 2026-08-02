import { Router } from "express";
import { all, get, run } from "../db.js";
import { rateLimit } from "../security.js";
import { requestApproval } from "../approvals.js";
import { notify } from "../notify.js";

// ── The guest portal (Wave 1·A) — /p/:token ──────────────────────────
// No agency accounts, no passwords: an expiring, revocable magic link.
// The portal sees ONLY the vendor's own deliverables + read-only briefs
// + the public Brand Center. It can submit links and reply to comments.
// Every action is rate-limited and lands in the audit trail as
// "portal:<vendor>". It never touches privileged tables.

export const portalRouter = Router();
portalRouter.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 120, message: "Too many portal requests — slow down" }));

// Resolve + validate the token, attach the vendor, touch lastUsedAt.
async function loadVendor(req, res, next) {
  try {
    res.setHeader("X-Robots-Tag", "noindex");
    const row = await get(
      `SELECT t.id AS "tokenId", t."vendorId", v.name AS "vendorName"
       FROM portal_tokens t JOIN vendors v ON v.id = t."vendorId"
       WHERE t.token = $1 AND t.revoked = false AND t."expiresAt" > now() AND v.active = true`,
      [req.params.token]
    );
    if (!row) return res.status(404).json({ error: "Invalid or expired link" });
    run(`UPDATE portal_tokens SET "lastUsedAt" = now() WHERE id = $1`, [row.tokenId]).catch(() => {});
    req.portal = row;
    next();
  } catch (e) { next(e); }
}

const audit = (portal, action, entityId, meta = null) =>
  run(`INSERT INTO audit_log ("actorId", "actorName", action, entity, "entityId", meta) VALUES (NULL, $1, $2, 'deliverables', $3, $4)`,
    [`portal:${portal.vendorName}`, action, entityId ? String(entityId) : null, meta ? JSON.stringify(meta) : null]).catch(() => {});

// One-shot payload: everything the vendor's workroom needs.
portalRouter.get("/:token", loadVendor, async (req, res, next) => {
  try {
    const vid = req.portal.vendorId;
    const [org, deliverables, brand] = await Promise.all([
      get(`SELECT "orgName", "orgNameAr", "logoUrl", "accentColor" FROM settings WHERE id = 1`),
      all(`SELECT d.id, d.title, d.status, d."dueDate", d."revisionCount", d."submittedUrl", d."submittedAt", d."approvedAt",
                  e.title AS "engagementTitle",
                  b.title AS "briefTitle", b.spec AS "briefSpec", b.format AS "briefFormat", b."dueDate" AS "briefDueDate", b.refs AS "briefRefs"
           FROM deliverables d
           JOIN engagements e ON e.id = d."engagementId"
           LEFT JOIN creative_briefs b ON b.id = d."briefId"
           WHERE e."vendorId" = $1
           ORDER BY (d.status = 'APPROVED'), d."dueDate" ASC NULLS LAST`, [vid]),
      all(`SELECT kind, label, "labelAr", value, url FROM brand_assets WHERE public = true ORDER BY sort ASC`),
    ]);
    const ids = deliverables.map((d) => d.id);
    const comments = ids.length
      ? await all(`SELECT "deliverableId", author, "authorName", body, "createdAt" FROM deliverable_comments
                   WHERE "deliverableId" = ANY($1::uuid[]) ORDER BY "createdAt" ASC`, [ids])
      : [];
    res.json({ vendor: { name: req.portal.vendorName }, org, deliverables, comments, brand });
  } catch (e) { next(e); }
});

// Submit work: BRIEFED/IN_PROGRESS/REVISION → SUBMITTED (+ approval filed, owner notified).
portalRouter.post("/:token/deliverables/:id/submit", loadVendor, async (req, res, next) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!/^https?:\/\/.{4,}/.test(url)) return res.status(400).json({ error: "A valid link to the work is required" });
    const d = await get(
      `SELECT d.*, e."ownerId", e."vendorId" FROM deliverables d JOIN engagements e ON e.id = d."engagementId"
       WHERE d.id = $1 AND e."vendorId" = $2`,
      [req.params.id, req.portal.vendorId]
    );
    if (!d) return res.status(404).json({ error: "Not found" });
    if (!["BRIEFED", "IN_PROGRESS", "REVISION"].includes(d.status)) {
      return res.status(409).json({ error: "This deliverable is not awaiting a submission" });
    }
    await run(
      `UPDATE deliverables SET status = 'SUBMITTED', "submittedUrl" = $2, "submittedAt" = now(), "updatedAt" = now() WHERE id = $1`,
      [d.id, url.slice(0, 1000)]
    );
    const note = String(req.body?.note || "").trim();
    if (note) {
      await run(`INSERT INTO deliverable_comments ("deliverableId", author, "authorName", body) VALUES ($1,'VENDOR',$2,$3)`,
        [d.id, req.portal.vendorName, note.slice(0, 4000)]);
    }
    await requestApproval({ entity: "deliverables", entityId: d.id, note: note || null });
    if (d.ownerId) notify([d.ownerId], "PORTAL_SUBMISSION", { title: d.title, vendor: req.portal.vendorName }, "/agency").catch(() => {});
    audit(req.portal, "portal.submit", d.id, { url: url.slice(0, 200) });
    res.json({ ok: true, status: "SUBMITTED" });
  } catch (e) { next(e); }
});

// Reply on the shared thread.
portalRouter.post("/:token/deliverables/:id/comments", loadVendor, async (req, res, next) => {
  try {
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "body is required" });
    const d = await get(
      `SELECT d.id, e."ownerId" FROM deliverables d JOIN engagements e ON e.id = d."engagementId"
       WHERE d.id = $1 AND e."vendorId" = $2`,
      [req.params.id, req.portal.vendorId]
    );
    if (!d) return res.status(404).json({ error: "Not found" });
    const r = await get(
      `INSERT INTO deliverable_comments ("deliverableId", author, "authorName", body) VALUES ($1,'VENDOR',$2,$3) RETURNING *`,
      [d.id, req.portal.vendorName, body.slice(0, 4000)]
    );
    if (d.ownerId) notify([d.ownerId], "PORTAL_COMMENT", { vendor: req.portal.vendorName }, "/agency").catch(() => {});
    audit(req.portal, "portal.comment", d.id);
    res.status(201).json(r);
  } catch (e) { next(e); }
});

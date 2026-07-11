import { Router } from "express";
import { get } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";
import { logActivity } from "../leadlog.js";

export const customersExtraRouter = Router();
customersExtraRouter.use(requireAuth);

// One click: a WON lead becomes a managed customer relationship.
customersExtraRouter.post("/convert/:leadId", requirePerm("leads"), async (req, res, next) => {
  try {
    const lead = await get(`SELECT * FROM leads WHERE id = $1`, [req.params.leadId]);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.stage !== "WON") return res.status(400).json({ error: "Only WON leads convert to customers" });
    if (await get(`SELECT 1 FROM customers WHERE "leadId" = $1`, [lead.id])) return res.status(409).json({ error: "Already a customer" });
    const reviewDays = (await get(`SELECT "customerReviewDays" FROM settings WHERE id = 1`))?.customerReviewDays || 90;
    const row = await get(
      `INSERT INTO customers ("leadId", company, "businessUnit", "productIds", "firstWonAt", "totalValueUsd", "accountOwnerId", "nextReviewAt")
       VALUES ($1,$2,$3,$4, now(), $5, $6, (now() + ($7 || ' days')::interval)::date) RETURNING *`,
      [lead.id, lead.company, lead.businessUnit,
       JSON.stringify(lead.productId ? [lead.productId] : []),
       lead.valueUsd || 0, lead.ownerId || req.user.id, String(reviewDays)]
    );
    logActivity(req, lead.id, "NOTE", "Converted to customer / تم التحويل إلى عميل");
    logAudit(req, "customers.convert", "customers", row.id, { leadId: lead.id });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

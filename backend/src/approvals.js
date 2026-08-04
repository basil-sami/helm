import { Router } from "express";
import { all, get, run } from "./db.js";
import { requireAuth, hasPerm } from "./auth.js";
import { logAudit } from "./audit.js";
import { notify } from "./notify.js";

// ── The approvals engine (Wave 1·A) ──────────────────────────────────
// ONE generalized sign-off mechanism, reused everywhere — never
// re-implemented per module. v1 wiring: invoices (approval releases a
// SPENT budget entry), asset_versions (approval stamps the version),
// deliverables (approval closes the loop, rejection = a revision round).
// Later waves plug in content, scheduled posts, and budget thresholds
// by adding one entry to ENTITY_RULES.

/** Create a PENDING approval (idempotent per entity+id+stage). Returns the approval id. */
export async function requestApproval({ entity, entityId, stage = "APPROVAL", requesterId = null, note = null }) {
  const existing = await get(
    `SELECT id FROM approvals WHERE entity = $1 AND "entityId" = $2 AND stage = $3 AND status = 'PENDING'`,
    [entity, entityId, stage]
  );
  if (existing) return existing.id;
  const r = await get(
    `INSERT INTO approvals (entity, "entityId", stage, "requesterId", note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [entity, entityId, stage, requesterId, note]
  );
  // Approvers = admins for v1; deciding also allowed to module writers (below).
  try {
    const admins = (await all(`SELECT u.id FROM users u JOIN roles r ON r.key = u.role
                               WHERE u.active AND (r.permissions->>'admin')::boolean IS TRUE`)).map((u) => u.id);
    await notify(admins, "APPROVAL_REQUESTED", { entity }, "/approvals");
  } catch { /* notification must never block the request */ }
  return r.id;
}

// Which permission module governs deciding on each entity + the side-effect on decision.
const ENTITY_RULES = {
  invoices: {
    module: "agency",
    async onDecide(ap, decision, req) {
      if (decision !== "APPROVED") return; // a rejected invoice simply stays RECEIVED
      const inv = await get(`SELECT * FROM invoices WHERE id = $1`, [ap.entityId]);
      if (!inv || inv.status !== "RECEIVED") return;
      await run(`UPDATE invoices SET status = 'APPROVED' WHERE id = $1`, [inv.id]);
      // Agency cost flows into ROMI: approval writes the SPENT budget entry.
      const vendor = await get(`SELECT name FROM vendors WHERE id = $1`, [inv.vendorId]);
      const rate = Number(inv.rateAtEntry) || null;
      const usd = Number(inv.amountUsd) || 0;
      await run(
        `INSERT INTO budget_entries (label, kind, channel, "amountUsd", "amountSdg", date, "campaignId", "rateAtEntry")
         VALUES ($1, 'SPENT', 'BTL', $2, $3, now(), $4, $5)`,
        [`Invoice ${inv.number} — ${vendor?.name || "vendor"}`, usd, rate ? usd * rate : 0, inv.campaignId, rate]
      );
      logAudit(req, "invoices.approve", "invoices", inv.id, { budgetReleased: usd });
    },
  },
  asset_versions: {
    module: "studio",
    async onDecide(ap, decision, req) {
      if (decision === "APPROVED") {
        await run(`UPDATE asset_versions SET status = 'APPROVED', "approvedById" = $2, "approvedAt" = now() WHERE id = $1`,
          [ap.entityId, req.user.id]);
      } else {
        await run(`UPDATE asset_versions SET status = 'DRAFT' WHERE id = $1 AND status = 'REVIEW'`, [ap.entityId]);
      }
    },
  },
  scheduled_posts: {
    module: "publish",
    async onDecide(ap, decision, _req) {
      // Approval releases the slot to READY; rejection sends it back to
      // the drafting table. Both only from AWAITING_APPROVAL — a
      // withdrawn or already-moved slot is left untouched.
      if (decision === "APPROVED") {
        await run(`UPDATE scheduled_posts SET status = 'READY', "updatedAt" = now()
                   WHERE id = $1 AND status = 'AWAITING_APPROVAL'`, [ap.entityId]);
      } else {
        await run(`UPDATE scheduled_posts SET status = 'DRAFT', "updatedAt" = now()
                   WHERE id = $1 AND status = 'AWAITING_APPROVAL'`, [ap.entityId]);
      }
    },
  },
  deliverables: {
    module: "agency",
    async onDecide(ap, decision, req) {
      const d = await get(`SELECT * FROM deliverables WHERE id = $1`, [ap.entityId]);
      if (!d) return;
      if (decision === "APPROVED") {
        await run(`UPDATE deliverables SET status = 'APPROVED', "approvedAt" = now(), "updatedAt" = now() WHERE id = $1`, [d.id]);
      } else {
        // Rejection = a revision round: the counter is the vendor scorecard's raw material.
        await run(`UPDATE deliverables SET status = 'REVISION', "revisionCount" = "revisionCount" + 1, "updatedAt" = now() WHERE id = $1`, [d.id]);
      }
      if (ap.note) {
        await run(`INSERT INTO deliverable_comments ("deliverableId", author, "authorName", body) VALUES ($1,'INTERNAL',$2,$3)`,
          [d.id, req.user.name, ap.note]).catch(() => {});
      }
    },
  },
};

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

// Inbox: pending first, joined with requester names. ?status= filters.
approvalsRouter.get("/", async (req, res, next) => {
  try {
    const status = ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status) ? req.query.status : null;
    const rows = await all(
      `SELECT a.*, ru.name AS "requesterName", au.name AS "approverName"
       FROM approvals a
       LEFT JOIN users ru ON ru.id = a."requesterId"
       LEFT JOIN users au ON au.id = a."approverId"
       ${status ? `WHERE a.status = '${status}'` : ""}
       ORDER BY (a.status = 'PENDING') DESC, a."createdAt" DESC LIMIT 200`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Decide: admin OR write-permission on the entity's governing module.
/**
 * Decide one approval. W4·D extracted this from the route so that bulk
 * approval is literally N single decisions through the same code —
 * every permission check, side-effect and audit entry included. A bulk
 * path that wrote statuses directly would be a second door.
 */
async function decideOne(id, decision, req) {
  const ap = await get(`SELECT * FROM approvals WHERE id = $1`, [id]);
  if (!ap) return { ok: false, status: 404, error: "Not found" };
  if (ap.status !== "PENDING") return { ok: false, status: 409, error: "Already decided" };

  const rule = ENTITY_RULES[ap.entity];
  let allowed = req.user.permissions?.admin || (rule && hasPerm(req.user.permissions, rule.module, "write"));
  // W4·D: a delegate may decide in the approver's place while the
  // delegation window is open — the approver's authority, borrowed, not
  // widened. The delegate still needs the module permission.
  if (!allowed && ap.approverId) {
    const { effectiveApprovers } = await import("./calendar.js");
    const standing = await effectiveApprovers(ap.approverId);
    if (standing.includes(req.user.id) && rule && hasPerm(req.user.permissions, rule.module, "write")) allowed = true;
  }
  if (!allowed) return { ok: false, status: 403, error: "Insufficient permissions" };

  const note = req.body?.note ? String(req.body.note).slice(0, 2000) : null;
  await run(
    `UPDATE approvals SET status = $2, "approverId" = COALESCE("approverId", $3), "decidedById" = $3,
       note = COALESCE($4, note), "decidedAt" = now() WHERE id = $1`,
    [ap.id, decision, req.user.id, note]
  );
  if (rule?.onDecide) {
    try { await rule.onDecide({ ...ap, note: note ?? ap.note }, decision, req); }
    catch (e) { console.error("approval side-effect failed", e); }
  }
  if (ap.requesterId) notify([ap.requesterId], `APPROVAL_${decision}`, { entity: ap.entity }, "/approvals").catch(() => {});
  logAudit(req, `approvals.${decision.toLowerCase()}`, ap.entity, ap.entityId);
  return { ok: true, row: await get(`SELECT * FROM approvals WHERE id = $1`, [ap.id]) };
}

approvalsRouter.post("/:id/decide", async (req, res, next) => {
  try {
    const decision = req.body?.status;
    if (!["APPROVED", "REJECTED"].includes(decision)) return res.status(400).json({ error: "status must be APPROVED or REJECTED" });
    const out = await decideOne(req.params.id, decision, req);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json(out.row);
  } catch (e) { next(e); }
});

/** Bulk decide — N single decisions, never a shortcut around them. */
approvalsRouter.post("/bulk-decide", async (req, res, next) => {
  try {
    const decision = req.body?.status;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 100) : [];
    if (!["APPROVED", "REJECTED"].includes(decision)) return res.status(400).json({ error: "status must be APPROVED or REJECTED" });
    if (!ids.length) return res.status(400).json({ error: "ids must be a non-empty array" });
    const results = [];
    for (const id of ids) {
      const out = await decideOne(id, decision, req);
      results.push({ id, ok: out.ok, error: out.error || null });
    }
    const decided = results.filter((r) => r.ok).length;
    logAudit(req, "approvals.bulk", "approvals", null, { decision, requested: ids.length, decided });
    res.json({ decision, requested: ids.length, decided, skipped: ids.length - decided, results });
  } catch (e) { next(e); }
});

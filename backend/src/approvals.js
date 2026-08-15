import { Router } from "express";
import { all, get, transaction } from "./db.js";
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
export async function requestApproval({ entity, entityId, stage = "APPROVAL", requesterId = null, note = null, db = { get }, notifyRequest = true }) {
  const existing = await db.get(
    `SELECT id FROM approvals WHERE entity = $1 AND "entityId" = $2 AND stage = $3 AND status = 'PENDING'`,
    [entity, entityId, stage]
  );
  if (existing) return existing.id;
  const module = ENTITY_RULES[entity]?.module;
  const approver = requesterId && module ? await db.get(
    `SELECT h.id FROM users u JOIN departments d ON d.id = u."departmentId"
      JOIN users h ON h.id = d."headId" AND h.active = true LEFT JOIN roles r ON r.key = h.role
      WHERE u.id = $1 AND (h.role = 'HEAD' OR COALESCE((r.permissions->>'admin')::boolean, false)
        OR r.permissions->>$2 = 'write')`, [requesterId, module]).catch(() => null) : null;
  let fallback = approver || await db.get(
    `SELECT u.id FROM users u LEFT JOIN roles r ON r.key = u.role
      WHERE u.active AND (u.role = 'HEAD' OR COALESCE((r.permissions->>'admin')::boolean, false))
      ORDER BY u."createdAt" ASC LIMIT 1`).catch(() => null);
  if (!fallback) fallback = await db.get(`SELECT id FROM users WHERE active = true AND role = 'HEAD' ORDER BY "createdAt" ASC LIMIT 1`).catch(() => null);
  const r = await db.get(
    `INSERT INTO approvals (entity, "entityId", stage, "requesterId", "approverId", note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [entity, entityId, stage, requesterId, fallback?.id || null, note]
  );
  try {
    if (notifyRequest && fallback?.id) await notify([fallback.id], "APPROVAL_REQUESTED", { entity }, "/approvals");
  } catch { /* notification must never block the request */ }
  return r.id;
}

// Which permission module governs deciding on each entity + the side-effect on decision.
const ENTITY_RULES = {
  invoices: {
    module: "agency",
    async onDecide(ap, decision, req, db) {
      const { get, run } = db;
      if (decision !== "APPROVED") return; // a rejected invoice simply stays RECEIVED
      const inv = await get(`SELECT * FROM invoices WHERE id = $1`, [ap.entityId]);
      if (!inv || inv.status !== "RECEIVED") throw new Error("Invoice is no longer awaiting approval");
      await run(`UPDATE invoices SET status = 'APPROVED' WHERE id = $1 AND status = 'RECEIVED'`, [inv.id]);
      // Agency cost flows into ROMI: approval writes the SPENT budget entry.
      const vendor = await get(`SELECT name FROM vendors WHERE id = $1`, [inv.vendorId]);
      const rate = Number(inv.rateAtEntry) || null;
      const usd = Number(inv.amountUsd) || 0;
      await run(
        `INSERT INTO budget_entries (label, kind, channel, "amountUsd", "amountSdg", date, "campaignId", "rateAtEntry")
         VALUES ($1, 'SPENT', 'BTL', $2, $3, now(), $4, $5)`,
        [`Invoice ${inv.number} — ${vendor?.name || "vendor"}`, usd, rate ? usd * rate : 0, inv.campaignId, rate]
      );
    },
  },
  asset_versions: {
    module: "studio",
    async onDecide(ap, decision, req, db) {
      const { run } = db;
      if (decision === "APPROVED") {
        const out = await run(`UPDATE asset_versions SET status = 'APPROVED', "approvedById" = $2, "approvedAt" = now() WHERE id = $1 AND status = 'REVIEW'`,
          [ap.entityId, req.user.id]);
        if (!out.rowCount) throw new Error("Asset version is no longer awaiting approval");
      } else {
        const out = await run(`UPDATE asset_versions SET status = 'DRAFT' WHERE id = $1 AND status = 'REVIEW'`, [ap.entityId]);
        if (!out.rowCount) throw new Error("Asset version is no longer awaiting approval");
      }
    },
  },
  scheduled_posts: {
    module: "publish",
    async onDecide(ap, decision, _req, db) {
      const { run } = db;
      // Approval releases the slot to READY; rejection sends it back to
      // the drafting table. Both only from AWAITING_APPROVAL — a
      // withdrawn or already-moved slot is left untouched.
      if (decision === "APPROVED") {
        const out = await run(`UPDATE scheduled_posts SET status = 'READY', "updatedAt" = now()
                   WHERE id = $1 AND status = 'AWAITING_APPROVAL'`, [ap.entityId]);
        if (!out.rowCount) throw new Error("Scheduled post is no longer awaiting approval");
      } else {
        const out = await run(`UPDATE scheduled_posts SET status = 'DRAFT', "updatedAt" = now()
                   WHERE id = $1 AND status = 'AWAITING_APPROVAL'`, [ap.entityId]);
        if (!out.rowCount) throw new Error("Scheduled post is no longer awaiting approval");
      }
    },
  },
  content_items: {
    module: "content",
    async onDecide(ap, decision, _req, db) {
      const { run } = db;
      // W4·UX2 — the composer's quick-draft path. Approval stamps the
      // item APPROVED so the publish gate opens; rejection returns it to
      // IDEA. Both only from REVIEW — an item someone already walked
      // elsewhere on the calendar is left untouched.
      if (decision === "APPROVED") {
        const out = await run(`UPDATE content_items SET status = 'APPROVED' WHERE id = $1 AND status = 'REVIEW'`, [ap.entityId]);
        if (!out.rowCount) throw new Error("Content item is no longer awaiting approval");
      } else {
        const out = await run(`UPDATE content_items SET status = 'IDEA' WHERE id = $1 AND status = 'REVIEW'`, [ap.entityId]);
        if (!out.rowCount) throw new Error("Content item is no longer awaiting approval");
      }
    },
  },
  deliverables: {
    module: "agency",
    async onDecide(ap, decision, req, db) {
      const { get, run } = db;
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
          [d.id, req.user.name, ap.note]);
      }
    },
  },
};

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

// ── W4·UX · Approve with eyes ────────────────────────────────────────
// An approval inbox that hides the thing being approved asks for a
// signature on a sealed envelope. Each known entity contributes ONE
// batched query (no N+1; the inbox is capped at 200 rows) mapping ids
// to a uniform preview: { kind, title, body, bodyAr, meta, mediaUrl,
// amountUsd, when }. An entity we don't know yields preview: null —
// declared, never a crash, and never a blocked inbox.
const PREVIEWERS = {
  scheduled_posts: async (ids) => {
    const rows = await all(
      `SELECT sp.id, sp."scheduledAt", v.platform, v.format, v.caption, v."captionAr",
              ci.title, a.url AS "mediaUrl"
       FROM scheduled_posts sp
       JOIN content_variants v ON v.id = sp."variantId"
       JOIN content_items ci ON ci.id = v."contentId"
       LEFT JOIN assets a ON a.id = v."assetId"
       WHERE sp.id = ANY($1::uuid[])`, [ids]);
    return new Map(rows.map((r) => [r.id, {
      kind: "scheduled_posts", title: r.title, body: r.caption, bodyAr: r.captionAr,
      meta: `${r.platform} · ${r.format}`, mediaUrl: r.mediaUrl, when: r.scheduledAt,
    }]));
  },
  invoices: async (ids) => {
    const rows = await all(
      `SELECT i.id, i.number, i."amountUsd", i."campaignId", ven.name AS "vendorName",
              c.name AS "campaignName", c."budgetUsd"
       FROM invoices i
       LEFT JOIN vendors ven ON ven.id = i."vendorId"
       LEFT JOIN campaigns c ON c.id = i."campaignId"
       WHERE i.id = ANY($1::uuid[])`, [ids]);
    // W5·NERVE — control at the signature: for a campaign-linked invoice
    // the preview states where this approval takes the envelope. The pct
    // uses the same triad math as /finance/overview: a RECEIVED invoice
    // is already inside `committed`, so its pctAfter equals the
    // campaign's current pct — approval moves it committed → actual,
    // same total, one money truth.
    const campIds = [...new Set(rows.map((r) => r.campaignId).filter(Boolean))];
    const pctByCamp = new Map();
    if (campIds.length) {
      const [sp, le, pe, pl] = await Promise.all([
        all(`SELECT "campaignId" k, SUM("amountUsd")::float u FROM ad_spend WHERE "campaignId" = ANY($1::uuid[]) GROUP BY 1`, [campIds]),
        all(`SELECT "campaignId" k, SUM("amountUsd")::float u FROM budget_entries WHERE kind = 'SPENT' AND "campaignId" = ANY($1::uuid[]) GROUP BY 1`, [campIds]),
        all(`SELECT "campaignId" k, SUM("amountUsd")::float u FROM invoices WHERE status = 'RECEIVED' AND "campaignId" = ANY($1::uuid[]) GROUP BY 1`, [campIds]),
        all(`SELECT mp."campaignId" k, SUM(pl."costUsd")::float u FROM media_placements pl JOIN media_plans mp ON mp.id = pl."planId" WHERE mp."campaignId" = ANY($1::uuid[]) GROUP BY 1`, [campIds]),
      ]);
      const acc = new Map(campIds.map((k) => [k, 0]));
      for (const g of [sp, le, pe, pl]) for (const r of g) acc.set(r.k, (acc.get(r.k) || 0) + (r.u || 0));
      for (const k of campIds) pctByCamp.set(k, acc.get(k) || 0);
    }
    return new Map(rows.map((r) => {
      const planned = Number(r.budgetUsd) || 0;
      const load = r.campaignId ? (pctByCamp.get(r.campaignId) || 0) : null;
      const pctAfter = r.campaignId && planned > 0 ? Math.round((load / planned) * 1000) / 10 : null;
      return [r.id, {
        kind: "invoices", title: `${r.vendorName || "—"} · ${r.number}`,
        amountUsd: Number(r.amountUsd) || 0,
        budgetContext: r.campaignId
          ? { campaignName: r.campaignName, pctAfter, planned }
          : null,
      }];
    }));
  },
  deliverables: async (ids) => {
    const rows = await all(
      `SELECT d.id, d.title, d."dueDate", d."submittedUrl", d."revisionCount"
       FROM deliverables d WHERE d.id = ANY($1::uuid[])`, [ids]);
    return new Map(rows.map((r) => [r.id, {
      kind: "deliverables", title: r.title, when: r.dueDate,
      meta: r.revisionCount > 0 ? `R${r.revisionCount}` : null, mediaUrl: r.submittedUrl,
    }]));
  },
  asset_versions: async (ids) => {
    const rows = await all(
      `SELECT av.id, av.version, av.url, av.note, a.name
       FROM asset_versions av JOIN assets a ON a.id = av."assetId"
       WHERE av.id = ANY($1::uuid[])`, [ids]);
    return new Map(rows.map((r) => [r.id, {
      kind: "asset_versions", title: `${r.name} · v${r.version}`, body: r.note, mediaUrl: r.url,
    }]));
  },
  content_items: async (ids) => {
    const rows = await all(
      `SELECT id, title, "titleAr", channel, notes, "scheduledAt"
       FROM content_items WHERE id = ANY($1::uuid[])`, [ids]);
    return new Map(rows.map((r) => [r.id, {
      kind: "content_items", title: r.title, body: r.notes, bodyAr: r.titleAr || r.notes,
      meta: r.channel, when: r.scheduledAt,
    }]));
  },
};

async function hydratePreviews(rows) {
  const byEntity = {};
  for (const r of rows) (byEntity[r.entity] ||= []).push(r.entityId);
  const maps = {};
  await Promise.all(Object.keys(byEntity).map(async (entity) => {
    const fn = PREVIEWERS[entity];
    if (!fn) return;
    try { maps[entity] = await fn([...new Set(byEntity[entity])]); }
    catch (e) { console.error(`approval preview failed for ${entity}`, e); }
  }));
  return rows.map((r) => ({ ...r, preview: maps[r.entity]?.get(r.entityId) ?? null }));
}

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
    res.json(await hydratePreviews(rows));
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
  const moduleWriter = rule && hasPerm(req.user.permissions, rule.module, "write");
  let allowed = !!req.user.permissions?.admin;
  // W4·D: a delegate may decide in the approver's place while the
  // delegation window is open — the approver's authority, borrowed, not
  // widened. The delegate still needs the module permission.
  if (!allowed && ap.approverId && moduleWriter) {
    const { effectiveApprovers } = await import("./calendar.js");
    const standing = await effectiveApprovers(ap.approverId);
    if (standing.includes(req.user.id)) allowed = true;
  }
  // Pre-assignment approvals from older deployments retain their existing
  // module-writer decision path rather than becoming stranded.
  if (!allowed && !ap.approverId && moduleWriter) allowed = true;
  if (!allowed) return { ok: false, status: 403, error: "Insufficient permissions" };

  const note = req.body?.note ? String(req.body.note).slice(0, 2000) : null;
  const changed = await transaction(async (tx) => {
    const row = await tx.get(
      `UPDATE approvals SET status = $2, "approverId" = COALESCE("approverId", $3), "decidedById" = $3,
         note = COALESCE($4, note), "decidedAt" = now() WHERE id = $1 AND status = 'PENDING' RETURNING id`,
      [ap.id, decision, req.user.id, note]
    );
    if (!row) return false;
    if (rule?.onDecide) await rule.onDecide({ ...ap, note: note ?? ap.note }, decision, req, tx);
    return true;
  });
  if (!changed) return { ok: false, status: 409, error: "Already decided" };
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

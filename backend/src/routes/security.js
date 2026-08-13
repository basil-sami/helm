import { Router } from "express";
import { all } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { verifyAuditChain } from "../audit.js";

// ═══ SEC·D ROUTES — evidence on demand (SOC 2 CC4/CC6/CC7) ═══════════
// Two things an auditor asks for on day one, generated live instead of
// assembled in a spreadsheet the night before: proof the governance
// trail is intact, and the quarterly user-access review.

export const securityRouter = Router();
securityRouter.use(requireAuth, requireAdmin);

securityRouter.get("/audit-verify", async (_req, res, next) => {
  try { res.json(await verifyAuditChain()); } catch (e) { next(e); }
});

const DORMANT_DAYS = 90;
securityRouter.get("/access-review", async (_req, res, next) => {
  try {
    const rows = await all(
      `SELECT u.id, u.name, u.email, u.role, u.active,
              (r.permissions->>'admin')::boolean AS "isAdmin",
              (SELECT MAX(a.at) FROM auth_events a
                WHERE a."userId" = u.id AND a.ok AND a.method <> 'refresh') AS "lastLoginAt"
       FROM users u LEFT JOIN roles r ON r.key = u.role
       ORDER BY u.name`);
    const cutoff = Date.now() - DORMANT_DAYS * 864e5;
    const users = rows.map((u) => ({
      ...u,
      isAdmin: !!u.isAdmin,
      dormant: !!u.active && (!u.lastLoginAt || new Date(u.lastLoginAt).getTime() < cutoff),
    }));
    res.json({
      generatedAt: new Date().toISOString(),
      dormantAfterDays: DORMANT_DAYS,
      summary: {
        total: users.length,
        active: users.filter((u) => u.active).length,
        admins: users.filter((u) => u.isAdmin && u.active).length,
        dormant: users.filter((u) => u.dormant).length,
      },
      users,
    });
  } catch (e) { next(e); }
});

import { run } from "./db.js";

// Fire-and-forget governance trail. Never blocks or fails the request.
export async function logAudit(req, action, entity, entityId = null, meta = null) {
  try {
    await run(
      `INSERT INTO audit_log ("actorId", "actorName", action, entity, "entityId", meta)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.user?.id || null, req.user?.name || "system", action, entity,
       entityId ? String(entityId) : null, meta ? JSON.stringify(meta) : null]
    );
  } catch { /* audit must never break the operation (e.g. pre-migration DB) */ }
}

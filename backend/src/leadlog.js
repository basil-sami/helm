import { get } from "./db.js";

// Append to a lead's timeline. Returns the row; swallows pre-migration errors.
export async function logActivity(req, leadId, kind, body = null, meta = null) {
  try {
    return await get(
      `INSERT INTO lead_activities ("leadId", "actorId", "actorName", kind, body, meta)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, "actorName", kind, body, meta, "createdAt"`,
      [leadId, req.user?.id || null, req.user?.name || "system", kind, body, meta ? JSON.stringify(meta) : null]
    );
  } catch { return null; }
}

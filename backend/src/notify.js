import { all, run } from "./db.js";

// Insert notifications for a set of users in ONE statement. Never throws
// (pre-migration DBs simply skip). meta is localized by the frontend per type.
export async function notify(userIds, type, meta = null, link = null) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  try {
    const values = ids.map((_, i) => `($${i + 1}, $${ids.length + 1}, $${ids.length + 2}, $${ids.length + 3})`).join(", ");
    await run(
      `INSERT INTO notifications ("userId", type, meta, link) VALUES ${values}`,
      [...ids, type, meta ? JSON.stringify(meta) : null, link]
    );
  } catch { /* notifications must never break the operation */ }
}

// Active users whose role grants write on a module (or admin). Falls back to
// admins-by-role=HEAD if the roles table doesn't exist yet.
export async function usersWithModuleWrite(module) {
  try {
    const rows = await all(
      `SELECT u.id FROM users u JOIN roles r ON r.key = u.role
       WHERE u.active = true
         AND ((r.permissions->>'admin')::boolean IS TRUE OR r.permissions->>$1 = 'write')`,
      [module]
    );
    if (rows.length) return rows.map((r) => r.id);
  } catch { /* fall through */ }
  try {
    const rows = await all(`SELECT id FROM users WHERE active = true AND role IN ('HEAD','DIGITAL')`);
    return rows.map((r) => r.id);
  } catch { return []; }
}

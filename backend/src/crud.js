import { Router } from "express";
import { all, get, run } from "./db.js";
import { requireAuth, hasPerm } from "./auth.js";
import { logAudit } from "./audit.js";

// "" -> null; leave booleans/numbers as-is (Postgres handles native types).
function normalize(value) {
  if (value === undefined) return null;
  if (value === "") return null;
  return value;
}
const q = (col) => `"${col}"`; // quote identifier to preserve camelCase

/**
 * Generic authenticated CRUD router for a Postgres table.
 * opts: { table, fields, listSql, getSql, orderBy, touchUpdatedAt, validate }
 */
export function crudRouter(opts) {
  const {
    table,
    fields,
    listSql,
    getSql,
    orderBy = '"createdAt" DESC',
    touchUpdatedAt = false,
    validate,
    module, // permission key (e.g. "campaigns"); reads need "read", writes need "write"
    afterWrite, // optional (req, action, id, data, prev) hook for domain side-effects
    beforeDelete, // optional async (req, id) hook called before DELETE
    validateUpdate, // optional async (data, prev, req) → error string blocks the write (400)
    validateCreate, // optional async (data, req) → error string blocks the write (400)
  } = opts;

  const router = Router();
  router.use(requireAuth);
  const guard = (level) => (req, res, next) => {
    if (!module || hasPerm(req.user?.permissions, module, level)) return next();
    return res.status(403).json({ error: "Insufficient permissions" });
  };

  const single = async (id) => get(getSql || `SELECT * FROM ${table} WHERE id = $1`, [id]);

  const pickFields = (body) => {
    const data = {};
    for (const f of fields) if (body[f] !== undefined) data[f] = normalize(body[f]);
    return data;
  };

  router.get("/", guard("read"), async (req, res, next) => {
    try {
      const rows = await all(listSql || `SELECT * FROM ${table} ORDER BY ${orderBy}`);
      const limit = parseInt(req.query.limit, 10);
      if (Number.isFinite(limit) && limit > 0) {
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        res.setHeader("X-Total-Count", String(rows.length));
        return res.json(rows.slice(offset, offset + Math.min(limit, 500)));
      }
      res.json(rows);
    } catch (e) { next(e); }
  });

  router.get("/:id", guard("read"), async (req, res, next) => {
    try {
      const row = await single(req.params.id);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e) { next(e); }
  });

  router.post("/", guard("write"), async (req, res, next) => {
    const data = pickFields(req.body);
    if (validate) {
      const err = validate(data, "create");
      if (err) return res.status(400).json({ error: err });
    }
    try {
      if (validateCreate) {
        const err = await validateCreate(data, req);
        if (err) return res.status(400).json({ error: err });
      }
      const cols = Object.keys(data);
      let id;
      if (cols.length === 0) {
        id = (await get(`INSERT INTO ${table} DEFAULT VALUES RETURNING id`)).id;
      } else {
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
        const r = await get(
          `INSERT INTO ${table} (${cols.map(q).join(", ")}) VALUES (${placeholders}) RETURNING id`,
          cols.map((c) => data[c])
        );
        id = r.id;
      }
      logAudit(req, `${table}.create`, table, id);
      if (afterWrite) { try { await afterWrite(req, "create", id, data, null); } catch { /* side-effects never break the op */ } }
      res.status(201).json(await single(id));
    } catch (e) {
      if (badInput(e)) return res.status(400).json({ error: "Create failed", detail: e.message });
      next(e);
    }
  });

  router.patch("/:id", guard("write"), async (req, res, next) => {
    const existing = await get(`SELECT id FROM ${table} WHERE id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const data = pickFields(req.body);
    if (validate) {
      const err = validate(data, "update");
      if (err) return res.status(400).json({ error: err });
    }
    const cols = Object.keys(data);
    if (cols.length === 0 && !touchUpdatedAt) return res.status(400).json({ error: "No valid fields to update" });

    const sets = cols.map((c, i) => `${q(c)} = $${i + 1}`);
    if (touchUpdatedAt) sets.push(`"updatedAt" = now()`);
    try {
      const prev = (afterWrite || validateUpdate) ? await single(req.params.id) : null;
      if (validateUpdate) {
        const err = await validateUpdate(data, prev, req);
        if (err) return res.status(400).json({ error: err });
      }
      await run(
        `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${cols.length + 1}`,
        [...cols.map((c) => data[c]), req.params.id]
      );
      logAudit(req, `${table}.update`, table, req.params.id, { fields: cols });
      if (afterWrite) { try { await afterWrite(req, "update", req.params.id, data, prev); } catch { /* ignore */ } }
      res.json(await single(req.params.id));
    } catch (e) {
      if (badInput(e)) return res.status(400).json({ error: "Update failed", detail: e.message });
      next(e);
    }
  });

  router.delete("/:id", guard("write"), async (req, res, next) => {
    try {
      if (beforeDelete) { try { await beforeDelete(req, req.params.id); } catch { /* ignore */ } }
      await run(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
      logAudit(req, `${table}.delete`, table, req.params.id);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  return router;
}

// Postgres error codes that indicate bad client input (check/enum/format).
function badInput(e) {
  return ["23514", "22P02", "22007", "23502", "23505"].includes(e.code);
}

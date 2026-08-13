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

  // ── Wave 3·H · department scoping, enforced once ────────────────────
  // A user assigned to a department sees their own department's rows plus
  // anything unassigned. Admins and unassigned users see everything, so
  // an instance that never adopts departments behaves exactly as before.
  const scopeOf = (req) => (req.user?.isAdmin ? null : req.user?.departmentId || null);
  const visible = (req, row) => {
    const scope = scopeOf(req);
    if (!scope || !row || row.departmentId === undefined) return true;
    return row.departmentId === null || row.departmentId === scope;
  };

  const pickFields = (body) => {
    const data = {};
    for (const f of fields) if (body[f] !== undefined) data[f] = normalize(body[f]);
    return data;
  };

  // ── W4·PERF · pagination pushed into SQL where visibility allows ────
  // The old list handler loaded the whole table into Node, filtered
  // department visibility in memory, then sliced. Correct — and
  // pathological once leads or posts reach month-12 scale. The page is
  // now cut in SQL whenever the visibility predicate permits:
  //   · no department scope on the request (admins, unscoped users), or
  //   · the table has no departmentId column        → plain LIMIT/OFFSET
  //   · scoped user + default query + dept column   → the SAME predicate
  //     visible() applies, expressed as WHERE, parameterized
  //   · scoped user + custom listSql + dept column  → unchanged in-memory
  //     path: correctness beats speed where the join shape is bespoke.
  // X-Total-Count keeps its meaning everywhere: visible rows, not raw.
  // Unpaginated requests are untouched — dropdowns still get full lists.
  const deptColCache = new Map();
  const hasDeptColumn = async () => {
    if (!deptColCache.has(table)) {
      const r = await get(
        `SELECT 1 AS x FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'departmentId'`, [table]);
      deptColCache.set(table, !!r);
    }
    return deptColCache.get(table);
  };

  router.get("/", guard("read"), async (req, res, next) => {
    try {
      const limitQ = parseInt(req.query.limit, 10);
      const wantsPage = Number.isFinite(limitQ) && limitQ > 0;
      const baseSql = listSql || `SELECT * FROM ${table} ORDER BY ${orderBy}`;

      if (wantsPage) {
        const cap = Math.min(limitQ, 500);
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const scope = scopeOf(req);
        const scoped = scope && (await hasDeptColumn());
        if (!scoped) {
          const cnt = await get(`SELECT COUNT(*)::int AS c FROM (${baseSql}) sub`);
          res.setHeader("X-Total-Count", String(cnt.c));
          // Default queries page on (orderBy, id) so timestamp ties cannot
          // duplicate or drop rows across pages; bespoke listSql keeps its
          // own ORDER BY verbatim.
          const paged = listSql
            ? `${baseSql} LIMIT ${cap} OFFSET ${offset}`
            : `SELECT * FROM ${table} ORDER BY ${orderBy}, id LIMIT ${cap} OFFSET ${offset}`;
          return res.json(await all(paged));
        }
        if (!listSql) {
          const where = `WHERE ("departmentId" IS NULL OR "departmentId" = $1)`;
          const cnt = await get(`SELECT COUNT(*)::int AS c FROM ${table} ${where}`, [scope]);
          res.setHeader("X-Total-Count", String(cnt.c));
          return res.json(await all(
            `SELECT * FROM ${table} ${where} ORDER BY ${orderBy}, id LIMIT ${cap} OFFSET ${offset}`, [scope]));
        }
        const raw = await all(baseSql);
        const rows = raw.filter((r) => visible(req, r));
        res.setHeader("X-Total-Count", String(rows.length));
        return res.json(rows.slice(offset, offset + cap));
      }

      const raw = await all(baseSql);
      res.json(raw.filter((r) => visible(req, r)));
    } catch (e) { next(e); }
  });

  router.get("/:id", guard("read"), async (req, res, next) => {
    try {
      const row = await single(req.params.id);
      // 404 rather than 403: whether another department's record exists is
      // itself information they are not entitled to.
      if (!row || !visible(req, row)) return res.status(404).json({ error: "Not found" });
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
      // a scoped user cannot create into someone else's department, and
      // does not have to remember to set their own
      const scope = scopeOf(req);
      if (scope && fields.includes("departmentId")) data.departmentId = scope;
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
    const existing = await single(req.params.id);
    if (!existing || !visible(req, existing)) return res.status(404).json({ error: "Not found" });
    // a scoped user may not move a record into another department
    const pScope = scopeOf(req);
    if (pScope && req.body.departmentId !== undefined && req.body.departmentId !== pScope) {
      return res.status(403).json({ error: "You cannot move this into another department" });
    }

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
      const prev = await single(req.params.id);
      if (prev && !visible(req, prev)) return res.status(404).json({ error: "Not found" });
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

import { Router } from "express";
import express from "express";
import { all, get, run } from "../db.js";
import { requireAuth } from "../auth.js";
import { logAudit } from "../audit.js";
import { putFile, readFile, deleteFile, fileUrl, verifyFileSig, MAX_BYTES, storageDriver, kindOf } from "../storage.js";

// ═══ FILES ═══════════════════════════════════════════════════════════
// Uploads arrive as a raw body — no multipart dependency, and the
// browser can post a File object directly.

export const filesRouter = Router();

// ── download comes first: it authenticates by signature, not session ──
filesRouter.get("/:id", async (req, res, next) => {
  try {
    const f = await get(
      `SELECT id, "key", name, mime, size, driver, "remoteUrl", public FROM files WHERE id = $1`,
      [req.params.id]);
    if (!f) return res.status(404).json({ error: "Not found" });
    if (!f.public && !verifyFileSig(f.id, req.query.exp, req.query.sig)) {
      return res.status(403).json({ error: "This link is invalid or has expired" });
    }
    if (f.driver === "SUPABASE" && f.public && f.remoteUrl) return res.redirect(f.remoteUrl);
    const buf = await readFile(f);
    if (!buf) return res.status(404).json({ error: "Not found" });
    res.set("Content-Type", f.mime);
    res.set("Content-Disposition", `inline; filename="${encodeURIComponent(f.name)}"`);
    res.set("Cache-Control", f.public ? "public, max-age=86400" : "private, max-age=300");
    res.send(buf);
  } catch (e) { next(e); }
});

filesRouter.use(requireAuth);

// ── the media library: search, filter, page ─────────────────────────
const MIME_FAMILY = {
  IMAGE: `mime LIKE 'image/%'`,
  VIDEO: `mime LIKE 'video/%'`,
  AUDIO: `mime LIKE 'audio/%'`,
  DOC: `(mime LIKE 'text/%' OR mime ~ 'pdf|word|excel|powerpoint|document|sheet|presentation')`,
  ARCHIVE: `mime ~ 'zip|rar|7z|tar'`,
};

filesRouter.get("/", async (req, res, next) => {
  try {
    const { entity, entityId, q, kind, limit, offset } = req.query;
    const where = [], params = [];
    if (entity) { params.push(entity); where.push(`entity = $${params.length}`); }
    if (entityId) { params.push(entityId); where.push(`"entityId" = $${params.length}`); }
    if (q) { params.push(`%${String(q).toLowerCase()}%`); where.push(`lower(name) LIKE $${params.length}`); }
    if (kind && MIME_FAMILY[kind]) where.push(MIME_FAMILY[kind]);
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    const lim = Math.min(Number(limit) || 60, 200);
    const off = Math.max(0, Number(offset) || 0);

    const rows = await all(
      `SELECT id, name, mime, size, sha256, driver, public, entity, "entityId", "uploadedById", "createdAt"
       FROM files ${clause} ORDER BY "createdAt" DESC LIMIT ${lim} OFFSET ${off}`, params);
    const total = await get(`SELECT COUNT(*)::int c, COALESCE(SUM(size),0)::bigint b FROM files ${clause}`, params);
    res.json({
      total: total?.c || 0,
      bytes: Number(total?.b || 0),
      items: rows.map((f) => ({ ...f, url: fileUrl(f), kind: kindOf(f.mime) })),
    });
  } catch (e) { next(e); }
});

/**
 * Where a file is actually used. A library you can't safely delete from
 * is just a junk drawer, so deletion asks this first.
 */
async function usageOf(file) {
  const url = fileUrl(file).split("?")[0];               // signature-independent
  const like = `%${url}%`;
  const out = [];
  const probe = async (label, sql) => {
    const rows = await all(sql, [like]).catch(() => []);
    for (const r of rows) out.push({ kind: label, id: r.id, label: r.label });
  };
  await probe("asset", `SELECT id, name AS label FROM assets WHERE url LIKE $1`);
  await probe("version", `SELECT av.id, a.name || ' v' || av.version AS label FROM asset_versions av
                          JOIN assets a ON a.id = av."assetId" WHERE av.url LIKE $1`);
  await probe("brand", `SELECT id, label FROM brand_assets WHERE url LIKE $1`);
  await probe("bio", `SELECT id, label FROM bio_links WHERE url LIKE $1`);
  const logo = await get(`SELECT 1 FROM settings WHERE id = 1 AND "logoUrl" LIKE $1`, [like]).catch(() => null);
  if (logo) out.push({ kind: "logo", id: "settings", label: "Organisation logo" });
  return out;
}

filesRouter.get("/:id/usage", async (req, res, next) => {
  try {
    const f = await get(`SELECT id, driver, public, "remoteUrl" FROM files WHERE id = $1`, [req.params.id]);
    if (!f) return res.status(404).json({ error: "Not found" });
    res.json(await usageOf(f));
  } catch (e) { next(e); }
});

filesRouter.patch("/:id", express.json({ limit: "64kb" }), async (req, res, next) => {
  try {
    const f = await get(`SELECT * FROM files WHERE id = $1`, [req.params.id]);
    if (!f) return res.status(404).json({ error: "Not found" });
    if (req.body.name !== undefined) {
      await run(`UPDATE files SET name = $2 WHERE id = $1`, [f.id, String(req.body.name).slice(0, 200)]);
    }
    if (req.body.public !== undefined) await run(`UPDATE files SET public = $2 WHERE id = $1`, [f.id, !!req.body.public]);
    if (req.body.entity !== undefined) await run(`UPDATE files SET entity = $2 WHERE id = $1`, [f.id, req.body.entity || null]);
    if (req.body.entityId !== undefined) await run(`UPDATE files SET "entityId" = $2 WHERE id = $1`, [f.id, req.body.entityId || null]);
    const updated = await get(
      `SELECT id, name, mime, size, driver, public, entity, "entityId", "createdAt" FROM files WHERE id = $1`, [f.id]);
    res.json({ ...updated, url: fileUrl(updated), kind: kindOf(updated.mime) });
  } catch (e) { next(e); }
});

// Raw body: the client posts the file itself with its Content-Type.
filesRouter.post("/", express.raw({ type: "*/*", limit: MAX_BYTES }), async (req, res, next) => {
  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer?.length) return res.status(400).json({ error: "Send the file as the request body" });
    const f = await putFile({
      buffer,
      name: req.query.name || "upload",
      mime: req.headers["content-type"] || "application/octet-stream",
      entity: req.query.entity || null,
      entityId: req.query.entityId || null,
      userId: req.user.id,
      isPublic: req.query.public === "true",
    });
    logAudit(req, "files.upload", "files", f.id, { name: f.name, size: f.size, driver: f.driver });
    res.status(201).json({ ...f, url: fileUrl(f) });
  } catch (e) {
    if (e.userFacing) return res.status(400).json({ error: e.message });
    next(e);
  }
});

filesRouter.delete("/:id", async (req, res, next) => {
  try {
    const f = await get(`SELECT id, "key", driver, public, "remoteUrl" FROM files WHERE id = $1`, [req.params.id]);
    if (!f) return res.status(404).json({ error: "Not found" });
    if (req.query.force !== "true") {
      const used = await usageOf(f);
      if (used.length) return res.status(409).json({ error: "This file is still in use", usage: used });
    }
    await deleteFile(f);
    logAudit(req, "files.delete", "files", f.id, null);
    res.status(204).end();
  } catch (e) { next(e); }
});

// What the admin needs to know about where bytes are going.
export const storageInfoRouter = Router();
storageInfoRouter.use(requireAuth);
storageInfoRouter.get("/", async (_req, res, next) => {
  try {
    const s = await get(`SELECT COUNT(*)::int AS files, COALESCE(SUM(size),0)::bigint AS bytes FROM files`);
    res.json({
      driver: storageDriver(),
      maxBytes: MAX_BYTES,
      files: s?.files || 0,
      bytes: Number(s?.bytes || 0),
    });
  } catch (e) { next(e); }
});

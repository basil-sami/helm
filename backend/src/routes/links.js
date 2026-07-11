import { Router } from "express";
import crypto from "crypto";
import { all, get, run } from "../db.js";
import { requireAuth, requirePerm } from "../auth.js";
import { logAudit } from "../audit.js";

export const linksRouter = Router();
linksRouter.use(requireAuth);

const CODE_RE = /^[a-z0-9-]{3,30}$/;
const genCode = () => crypto.randomBytes(4).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "l" + Date.now().toString(36);

linksRouter.get("/", requirePerm("campaigns", "read"), async (_req, res, next) => {
  try {
    res.json(await all(`SELECT l.*, c.name AS "campaignName" FROM tracked_links l
                        LEFT JOIN campaigns c ON c.id = l."campaignId" ORDER BY l."createdAt" DESC`));
  } catch (e) { next(e); }
});

linksRouter.post("/", requirePerm("campaigns"), async (req, res, next) => {
  const { url, campaignId = null, channel = null } = req.body || {};
  let code = (req.body?.code || "").toLowerCase().trim();
  if (!/^https?:\/\/.+/.test(url || "")) return res.status(400).json({ error: "A valid destination URL is required" });
  if (code && !CODE_RE.test(code)) return res.status(400).json({ error: "Code: 3–30 chars, a–z 0–9 -" });
  try {
    if (!code) { do { code = genCode(); } while (await get(`SELECT 1 FROM tracked_links WHERE code = $1`, [code])); }
    else if (await get(`SELECT 1 FROM tracked_links WHERE code = $1`, [code])) return res.status(409).json({ error: "Code already exists" });
    const row = await get(
      `INSERT INTO tracked_links (code, url, "campaignId", channel) VALUES ($1,$2,$3,$4) RETURNING *`,
      [code, url, campaignId, channel]
    );
    logAudit(req, "links.create", "tracked_links", row.id, { code });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

linksRouter.delete("/:id", requirePerm("campaigns"), async (req, res, next) => {
  try {
    await run(`DELETE FROM tracked_links WHERE id = $1`, [req.params.id]);
    logAudit(req, "links.delete", "tracked_links", req.params.id);
    res.status(204).end();
  } catch (e) { next(e); }
});

// PUBLIC redirect — counts the click, then 302s. Mounted at /r/:code.
export async function redirectHandler(req, res) {
  try {
    const link = await get(`SELECT url FROM tracked_links WHERE code = $1`, [String(req.params.code || "").toLowerCase()]);
    if (!link) return res.status(404).send("Link not found");
    run(`UPDATE tracked_links SET clicks = clicks + 1, "lastClickAt" = now() WHERE code = $1`, [req.params.code.toLowerCase()]).catch(() => {});
    res.redirect(302, link.url);
  } catch { res.status(404).send("Link not found"); }
}

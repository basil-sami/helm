import { Router } from "express";
import { get, run } from "../db.js";
import { integrationCfg, logRun } from "../connectors/index.js";
import { verifySignature, parseWebhook } from "../connectors/waba.js";
import { parseMetaWebhook } from "../connectors/meta.js";

// ═══ PUBLIC WEBHOOKS ═════════════════════════════════════════════════
// Unauthenticated by necessity, so authenticity is proven by signature.
// Meta retries hard: answer 200 fast, keep the work small.

export const hooksRouter = Router();

// Meta's subscription handshake.
hooksRouter.get("/wa", async (req, res) => {
  const cfg = await integrationCfg("wa");
  const mode = req.query["hub.mode"], token = req.query["hub.verify_token"];
  if (mode === "subscribe" && cfg.verifyToken && token === cfg.verifyToken) {
    await logRun("WA", "WEBHOOK", "OK", "handshake");
    return res.status(200).send(String(req.query["hub.challenge"] ?? ""));
  }
  await logRun("WA", "WEBHOOK", "FAILED", "handshake token mismatch");
  res.sendStatus(403);
});

hooksRouter.post("/wa", async (req, res) => {
  try {
    const cfg = await integrationCfg("wa");
    if (!verifySignature(req.rawBody, req.headers["x-hub-signature-256"], cfg.appSecret)) {
      await logRun("WA", "WEBHOOK", "FAILED", "bad signature");
      return res.sendStatus(401);
    }
    const account = await get(`SELECT id FROM social_accounts WHERE platform = 'WA' AND status = 'CONNECTED' LIMIT 1`);
    let n = 0;
    for (const m of parseWebhook(req.body)) {
      // the unique (platform, externalId) index makes redelivery harmless
      const r = await run(
        `INSERT INTO inbox_items (platform, kind, author, text, status, "externalId", via, "receivedAt")
         VALUES ('WA','DM',$1,$2,'OPEN',$3,'API',$4)
         ON CONFLICT DO NOTHING`,
        [m.author, m.text, m.externalId, m.at]).catch(() => null);
      if (r) n++;
    }
    await logRun("WA", "WEBHOOK", "OK", `${n} message(s)`, account?.id || null);
    res.sendStatus(200);
  } catch (e) {
    // never make Meta retry over our own bug — record it and move on
    await logRun("WA", "WEBHOOK", "FAILED", String(e?.message || e));
    res.sendStatus(200);
  }
});

// ── Meta: page comments, mentions, messenger ─────────────────────────
hooksRouter.get("/meta", async (req, res) => {
  const cfg = await integrationCfg("meta");
  if (req.query["hub.mode"] === "subscribe" && cfg.verifyToken && req.query["hub.verify_token"] === cfg.verifyToken) {
    await logRun("META", "WEBHOOK", "OK", "handshake");
    return res.status(200).send(String(req.query["hub.challenge"] ?? ""));
  }
  await logRun("META", "WEBHOOK", "FAILED", "handshake token mismatch");
  res.sendStatus(403);
});

hooksRouter.post("/meta", async (req, res) => {
  try {
    const cfg = await integrationCfg("meta");
    if (!verifySignature(req.rawBody, req.headers["x-hub-signature-256"], cfg.appSecret)) {
      await logRun("META", "WEBHOOK", "FAILED", "bad signature");
      return res.sendStatus(401);
    }
    const platform = req.body?.object === "instagram" ? "INSTAGRAM" : "FACEBOOK";
    let n = 0;
    for (const m of parseMetaWebhook(req.body)) {
      const r = await run(
        `INSERT INTO inbox_items (platform, kind, author, text, url, status, "externalId", via, "receivedAt")
         VALUES ($1,$2,$3,$4,$5,'OPEN',$6,'API',$7) ON CONFLICT DO NOTHING`,
        [platform, m.kind, m.author, m.text, m.url, m.externalId, m.at]).catch(() => null);
      if (r) n++;
    }
    await logRun(platform, "WEBHOOK", "OK", `${n} item(s)`);
    res.sendStatus(200);
  } catch (e) {
    await logRun("META", "WEBHOOK", "FAILED", String(e?.message || e));
    res.sendStatus(200);
  }
});

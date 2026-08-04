import { all, get, run } from "./db.js";
import { adapterFor, callAdapter } from "./connectors/index.js";
import { notify } from "./notify.js";

// ═══ THE PUBLISH TICK (Wave 2·D) ═════════════════════════════════════
// The 05:00 Daily Pulse cannot honour a 2 PM slot, so auto-publishing
// gets its own heartbeat. The state machine is untouched: this only
// changes *who* moves READY → PUBLISHED, a human or the platform.

export async function runPublishTick() {
  const due = await all(
    `SELECT sp.id, sp."linkCode", cv.platform, cv.caption, cv."captionAr", cv.hashtags,
            ci.title, a.url AS "assetUrl", sp."assigneeId"
     FROM scheduled_posts sp
     JOIN content_variants cv ON cv.id = sp."variantId"
     JOIN content_items ci ON ci.id = cv."contentId"
     LEFT JOIN assets a ON a.id = cv."assetId"
     WHERE sp.status = 'READY' AND sp."scheduledAt" <= now() AND sp."externalUrl" IS NULL`);

  let published = 0, failed = 0, skipped = 0;

  for (const p of due) {
    const acc = await get(
      `SELECT * FROM social_accounts WHERE platform = $1 AND status = 'CONNECTED'
         AND "autoPublish" = true AND "accessToken" IS NOT NULL LIMIT 1`, [p.platform]);
    // no connected auto-publish account → the manual NOTIFIED flow still owns it
    if (!acc || !adapterFor(acc.platform)?.caps?.publish) { skipped++; continue; }
    // SEC·A: decrypt at the point of use. An unreadable credential must not
    // silently fall back to manual — it is a misconfiguration, not a skip.
    let account;
    try { account = (await import("./secrets.js")).withToken(acc); }
    catch (e) { failed++; continue; }

    const tags = (() => {
      try { const t = typeof p.hashtags === "string" ? JSON.parse(p.hashtags) : p.hashtags; return Array.isArray(t) ? t : []; }
      catch { return []; }
    })();
    const text = [p.captionAr || p.caption || p.title, tags.join(" ")].filter(Boolean).join("\n\n");
    const link = p.linkCode ? `${process.env.PUBLIC_URL || ""}/r/${p.linkCode}` : undefined;
    // Platforms fetch media themselves, so a relative upload path is useless
    // to them — resolve it against the instance's public address.
    const media = p.assetUrl
      ? [/^https?:\/\//.test(p.assetUrl) ? p.assetUrl : `${(process.env.PUBLIC_URL || "").replace(/\/$/, "")}${p.assetUrl}`]
      : [];
    if (p.assetUrl && !/^https?:\/\//.test(media[0])) {
      await run(`UPDATE scheduled_posts SET "publishError" = $2, "updatedAt" = now() WHERE id = $1`,
        [p.id, "Set PUBLIC_URL so platforms can reach uploaded media"]);
      failed++;
      continue;
    }

    const r = await callAdapter(account, "PUBLISH", (adapter, cfg) =>
      adapter.publish(account, cfg, { text, link, mediaUrls: media }));

    if (r.ok) {
      await run(`UPDATE scheduled_posts SET status = 'PUBLISHED', "externalUrl" = $2,
                 "publishError" = NULL, "updatedAt" = now() WHERE id = $1`, [p.id, r.externalUrl || null]);
      published++;
    } else {
      // stays READY so a human can retry — a failed post is not a lost one
      await run(`UPDATE scheduled_posts SET "publishError" = $2, "updatedAt" = now() WHERE id = $1`,
        [p.id, String(r.error).slice(0, 300)]);
      failed++;
      const dup = await get(
        `SELECT 1 FROM notifications WHERE type = 'PUBLISH_FAILED'
           AND "createdAt" > now() - interval '20 hours' LIMIT 1`);
      if (!dup && p.assigneeId) {
        await notify([p.assigneeId], "PUBLISH_FAILED", { title: p.title, platform: p.platform }, "/publish");
      }
    }
  }
  return { published, failed, skipped };
}

export async function publishTickCronHandler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  if (secret) {
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: "Invalid cron secret" });
  } else if (process.env.NODE_ENV === "production") {
    return res.status(401).json({ error: "Set CRON_SECRET to enable the publish tick" });
  }
  res.json({ ok: true, ...(await runPublishTick()) });
}

import { platformFetch } from "./index.js";

// ═══ META — Facebook Pages + Instagram Business ══════════════════════
// Publishing differs sharply between the two: a Page takes a single
// call, Instagram demands a media container and will not accept a
// text-only post at all. That asymmetry is the platform's, not ours.

const GRAPH = "https://graph.facebook.com/v21.0";
const base = (cfg) => (cfg.apiUrl || GRAPH).replace(/\/$/, "");
const tok = (account) => ({ Authorization: `Bearer ${account.accessToken}` });

const meta = {
  key: "META",
  cfgKey: "meta",
  caps: { verify: 1, publish: 1, inbox: 1, metrics: 1, adspend: 1, send: 0 },

  async verify(account, cfg) {
    const d = await platformFetch(`${base(cfg)}/${account.externalId || "me"}?fields=id,name`, {
      method: "GET", headers: tok(account),
    });
    return { externalId: d.id || account.externalId, name: d.name || null };
  },

  async publish(account, cfg, { text, link, mediaUrls = [] }) {
    if (account.platform === "INSTAGRAM") {
      // Instagram is media-first: no image, no post. Say so plainly.
      if (!mediaUrls.length) {
        const e = new Error("Instagram requires an image or video URL — text-only posts are not supported");
        e.userFacing = true;
        throw e;
      }
      const container = await platformFetch(`${base(cfg)}/${account.externalId}/media`, {
        headers: tok(account), body: { image_url: mediaUrls[0], caption: text || "" },
      });
      const pub = await platformFetch(`${base(cfg)}/${account.externalId}/media_publish`, {
        headers: tok(account), body: { creation_id: container.id },
      });
      return { externalId: pub.id, externalUrl: pub.permalink || `https://www.instagram.com/p/${pub.id}/` };
    }
    const d = await platformFetch(`${base(cfg)}/${account.externalId}/feed`, {
      headers: tok(account), body: { message: text || "", ...(link ? { link } : {}) },
    });
    return { externalId: d.id, externalUrl: d.permalink_url || `https://www.facebook.com/${d.id}` };
  },

  async pullMetrics(account, cfg) {
    const d = await platformFetch(
      `${base(cfg)}/${account.externalId}/insights?metric=page_impressions,page_post_engagements,page_fans`,
      { method: "GET", headers: tok(account) });
    const pick = (name) => {
      const row = (d.data || []).find((x) => x.name === name);
      return Number(row?.values?.[0]?.value ?? row?.value ?? 0);
    };
    return {
      followers: pick("page_fans"),
      impressions: pick("page_impressions"),
      engagement: pick("page_post_engagements"),
      reach: pick("page_reach"),
      clicks: pick("page_clicks"),
    };
  },

  /** Campaign-level daily cost. `campaignRef` is what we match to a Pulse campaign. */
  async pullAdSpend(account, cfg) {
    const actId = cfg.adAccountId || account.externalId;
    const d = await platformFetch(
      `${base(cfg)}/act_${actId}/insights?level=campaign&time_increment=1&fields=campaign_name,spend,impressions,clicks`,
      { method: "GET", headers: tok(account) });
    return { rows: (d.data || []).map((r) => ({
      date: r.date_start || new Date().toISOString().slice(0, 10),
      campaignRef: r.campaign_name || null,
      amountUsd: Number(r.spend || 0),
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
    })) };
  },
};

export default meta;

/** Page feed comments + messenger DMs → inbox-shaped rows. */
export function parseMetaWebhook(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      if (ch.field === "feed" && v.item === "comment" && v.verb === "add") {
        out.push({
          externalId: v.comment_id, kind: "COMMENT",
          author: v.from?.name || v.from?.id || "unknown",
          text: v.message || "", url: v.post_id ? `https://www.facebook.com/${v.post_id}` : null,
          at: v.created_time ? new Date(Number(v.created_time) * 1000).toISOString() : new Date().toISOString(),
        });
      }
      if (ch.field === "mentions") {
        out.push({
          externalId: v.comment_id || v.post_id, kind: "MENTION",
          author: v.from?.name || "unknown", text: v.message || "", url: null,
          at: new Date().toISOString(),
        });
      }
    }
    for (const m of entry.messaging || []) {
      if (!m.message?.text) continue;
      out.push({
        externalId: m.message.mid, kind: "DM",
        author: m.sender?.id || "unknown", text: m.message.text, url: null,
        at: m.timestamp ? new Date(Number(m.timestamp)).toISOString() : new Date().toISOString(),
      });
    }
  }
  return out;
}

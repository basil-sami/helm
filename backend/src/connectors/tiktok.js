import { platformFetch } from "./index.js";

// ═══ TIKTOK — publish & metrics only ═════════════════════════════════
// Comment and DM APIs sit behind a restricted tier TikTok grants case by
// case, so `inbox` is deliberately absent from caps rather than faked:
// the UI reads the capability map and simply won't offer what isn't real.

const API = "https://open.tiktokapis.com/v2";
const base = (cfg) => (cfg.apiUrl || API).replace(/\/$/, "");
const tok = (account) => ({ Authorization: `Bearer ${account.accessToken}` });

export default {
  key: "TIKTOK",
  cfgKey: "tiktok",
  caps: { verify: 1, publish: 1, metrics: 1, inbox: 0, adspend: 0, send: 0 },

  async verify(account, cfg) {
    const d = await platformFetch(`${base(cfg)}/user/info/?fields=open_id,display_name`, {
      method: "GET", headers: tok(account),
    });
    const u = d.data?.user || d.user || d;
    return { externalId: u.open_id || account.externalId, name: u.display_name || null };
  },

  async publish(account, cfg, { text, mediaUrls = [] }) {
    if (!mediaUrls.length) {
      const e = new Error("TikTok requires a video URL");
      e.userFacing = true;
      throw e;
    }
    const d = await platformFetch(`${base(cfg)}/post/publish/video/init/`, {
      headers: tok(account),
      body: { post_info: { title: (text || "").slice(0, 150) }, source_info: { source: "PULL_FROM_URL", video_url: mediaUrls[0] } },
    });
    const id = d.data?.publish_id || d.publish_id || null;
    return { externalId: id, externalUrl: d.data?.share_url || null };
  },

  async pullMetrics(account, cfg) {
    const d = await platformFetch(`${base(cfg)}/user/info/?fields=follower_count,likes_count,video_count`, {
      method: "GET", headers: tok(account),
    });
    const u = d.data?.user || d.user || d;
    return {
      followers: Number(u.follower_count || 0),
      engagement: Number(u.likes_count || 0),
      posts: Number(u.video_count || 0),
    };
  },
};

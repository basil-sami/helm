import { platformFetch } from "./index.js";

// ═══ GOOGLE ADS — spend only ═════════════════════════════════════════
// Gated in the real world by an approved developer token; until those
// credentials exist the adapter stays dormant rather than half-working.

const API = "https://googleads.googleapis.com/v18";
const base = (cfg) => (cfg.apiUrl || API).replace(/\/$/, "");

export default {
  key: "GOOGLE",
  cfgKey: "google",
  caps: { verify: 1, adspend: 1, publish: 0, inbox: 0, metrics: 0, send: 0 },

  async verify(account, cfg) {
    if (!cfg.developerToken) {
      const e = new Error("Google Ads needs an approved developer token before it can connect");
      e.userFacing = true;
      throw e;
    }
    const d = await platformFetch(`${base(cfg)}/customers/${cfg.customerId || account.externalId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${account.accessToken}`, "developer-token": cfg.developerToken },
    });
    return { externalId: d.id || cfg.customerId || account.externalId, name: d.descriptiveName || null };
  },

  async pullAdSpend(account, cfg) {
    const q = "SELECT campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign DURING LAST_7_DAYS";
    const d = await platformFetch(`${base(cfg)}/customers/${cfg.customerId || account.externalId}/googleAds:searchStream`, {
      headers: { Authorization: `Bearer ${account.accessToken}`, "developer-token": cfg.developerToken },
      body: { query: q },
    });
    const rows = Array.isArray(d) ? d.flatMap((b) => b.results || []) : (d.results || []);
    return { rows: rows.map((r) => ({
      date: r.segments?.date || new Date().toISOString().slice(0, 10),
      campaignRef: r.campaign?.name || null,
      amountUsd: Number(r.metrics?.costMicros || 0) / 1e6,
      impressions: Number(r.metrics?.impressions || 0),
      clicks: Number(r.metrics?.clicks || 0),
    })) };
  },
};

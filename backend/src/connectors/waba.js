import crypto from "crypto";
import { platformFetch } from "./index.js";

// ═══ WHATSAPP BUSINESS (Cloud API) ═══════════════════════════════════
// The compliance rule is structural, not cosmetic: business-initiated
// messages need a Meta-approved template. Free-form text is legal only
// inside the 24-hour service window after the customer's last message.

const GRAPH = "https://graph.facebook.com/v21.0";
const base = (cfg) => (cfg.apiUrl || GRAPH).replace(/\/$/, "");
const auth = (account) => ({ Authorization: `Bearer ${account.accessToken}` });

export const WINDOW_HOURS = 24;

export default {
  key: "WA",
  cfgKey: "wa",
  caps: { verify: 1, send: 1, inbox: 1, publish: 0, metrics: 0, adspend: 0 },

  /** Confirm the phone-number id and token actually work. */
  async verify(account, cfg) {
    const d = await platformFetch(`${base(cfg)}/${account.externalId}`, { method: "GET", headers: auth(account) });
    return { externalId: d.id || account.externalId, name: d.verified_name || d.display_phone_number || null };
  },

  /**
   * Send a message. `templateName` → business-initiated (always allowed);
   * plain `text` → only valid inside the service window, which the caller
   * must have established.
   */
  async sendMessage(account, cfg, { to, templateName, params = [], lang = "ar", text }) {
    const payload = templateName
      ? {
          messaging_product: "whatsapp", to, type: "template",
          template: {
            name: templateName, language: { code: lang },
            ...(params.length
              ? { components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t) })) }] }
              : {}),
          },
        }
      : { messaging_product: "whatsapp", to, type: "text", text: { body: text } };

    const d = await platformFetch(`${base(cfg)}/${account.externalId}/messages`, { headers: auth(account), body: payload });
    return { externalId: d?.messages?.[0]?.id || null };
  },
};

/** Constant-time HMAC check over the RAW body — parsed JSON will not match. */
export function verifySignature(rawBody, header, appSecret) {
  if (!appSecret || !header || !rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** WABA webhook envelope → flat inbox-shaped rows. Tolerant by design. */
export function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        const text =
          m.text?.body ||
          m.button?.text ||
          m.interactive?.list_reply?.title ||
          m.interactive?.button_reply?.title ||
          (m.type ? `[${m.type}]` : "");
        out.push({
          externalId: m.id,
          from: m.from,
          author: names[m.from] ? `${names[m.from]} (${m.from})` : m.from,
          text,
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  }
  return out;
}

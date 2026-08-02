import { all, get, run } from "../db.js";
import { normalizeAr, sentimentToward } from "./arabic.js";

// ═══ ENTITY RESOLUTION (Wave 2·E · P2) ═══════════════════════════════
// Mentions attach to entities, not to topic keywords. That is what makes
// share of voice trustworthy: one article can name three competitors and
// feel differently about each.

// GUARDRAIL — enforced here, not merely documented. Pulse resolves
// organisations, brands, products and outlets, plus spokespeople acting
// officially. It does not build profiles of private individuals.
export const ENTITY_KINDS = ["ORG", "BRAND", "PRODUCT", "OUTLET", "PUBLIC_FIGURE"];

let cache = { at: 0, aliases: [] };
export const bustEntityCache = () => { cache.at = 0; };

async function aliasIndex() {
  if (Date.now() - cache.at > 60_000) {
    const rows = await all(
      `SELECT a."surfaceNorm", a.surface, a.kind, a.weight, a."entityId",
              e.name, e."isSelf", e."competitorId", e.active
       FROM osint_aliases a JOIN osint_entities e ON e.id = a."entityId"
       WHERE e.active = true
       ORDER BY length(a."surfaceNorm") DESC`);   // longest match wins
    cache = { at: Date.now(), aliases: rows };
  }
  return cache.aliases;
}

/** Which entities does this text actually name, and how sure are we? */
export async function resolveEntities(text = "") {
  const hay = ` ${normalizeAr(text)} `;
  if (hay.trim().length < 2) return [];
  const found = new Map();

  for (const a of await aliasIndex()) {
    const needle = ` ${a.surfaceNorm} `;
    if (!hay.includes(needle)) continue;

    // an abbreviation or a two-letter surface is weaker evidence than a
    // full name — record that rather than pretending all matches are equal
    const base = a.kind === "EXACT" ? 0.9 : a.kind === "TRANSLITERATION" ? 0.8
      : a.kind === "HANDLE" ? 0.85 : a.kind === "MISSPELLING" ? 0.7 : 0.6;
    const lengthBonus = Math.min(0.1, a.surfaceNorm.length / 200);
    const confidence = Math.min(1, Number(a.weight) * (base + lengthBonus));

    const prev = found.get(a.entityId);
    if (!prev || confidence > prev.confidence) {
      found.set(a.entityId, {
        entityId: a.entityId, name: a.name, isSelf: a.isSelf, competitorId: a.competitorId,
        matchMethod: a.kind === "HANDLE" ? "HANDLE" : "ALIAS",
        matchedOn: a.surface, surfaceNorm: a.surfaceNorm, confidence: Number(confidence.toFixed(2)),
      });
    }
  }
  return [...found.values()];
}

/** Link a signal to everything it names, with sentiment toward each. */
export async function linkSignalEntities(signalId, text) {
  const matches = await resolveEntities(text);
  for (const m of matches) {
    const s = sentimentToward(text, m.surfaceNorm);
    await run(
      `INSERT INTO osint_signal_entities ("signalId", "entityId", "matchMethod", "matchedOn",
         confidence, sentiment, "sentimentLabel", "sentimentConfidence")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT ("signalId", "entityId") DO UPDATE
         SET confidence = EXCLUDED.confidence, sentiment = EXCLUDED.sentiment,
             "sentimentLabel" = EXCLUDED."sentimentLabel",
             "sentimentConfidence" = EXCLUDED."sentimentConfidence"`,
      [signalId, m.entityId, m.matchMethod, m.matchedOn, m.confidence,
       s.score, s.label, s.confidence]).catch(() => {});
  }
  await run(`UPDATE osint_signals SET "entityCount" = $2 WHERE id = $1`, [signalId, matches.length]).catch(() => {});
  return matches.length;
}

/** Backfill: resolve entities across signals collected before P2. */
export async function resolveAllSignals({ limit = 2000 } = {}) {
  const rows = await all(
    `SELECT id, title, snippet FROM osint_signals
     WHERE canonical = true AND "reviewStatus" <> 'REJECTED'
     ORDER BY "fetchedAt" DESC LIMIT ${Number(limit)}`);
  let linked = 0;
  for (const r of rows) linked += await linkSignalEntities(r.id, `${r.title} ${r.snippet || ""}`);
  return { scanned: rows.length, linked };
}

/**
 * Share of voice computed from entity links — the honest version.
 * Only canonical, non-rejected signals count, so syndication and noise
 * cannot inflate anyone's share.
 */
export async function entitySov({ days = 30 } = {}) {
  const rows = await all(
    `SELECT e.id, e.name, e."nameAr", e.kind, e."isSelf", e."competitorId",
            COUNT(*)::int AS mentions,
            ROUND(AVG(se.sentiment)::numeric, 3) AS "avgSentiment",
            COUNT(*) FILTER (WHERE se."sentimentLabel" = 'POS')::int AS pos,
            COUNT(*) FILTER (WHERE se."sentimentLabel" = 'NEG')::int AS neg,
            COUNT(*) FILTER (WHERE se."sentimentConfidence" < 0.4)::int AS unsure
     FROM osint_signal_entities se
     JOIN osint_entities e ON e.id = se."entityId"
     JOIN osint_signals s ON s.id = se."signalId"
     WHERE s.canonical = true AND s."reviewStatus" <> 'REJECTED'
       AND s."fetchedAt" >= now() - ($1 || ' days')::interval
     GROUP BY e.id ORDER BY mentions DESC`, [String(days)]);

  const total = rows.reduce((a, r) => a + r.mentions, 0);
  return {
    total,
    entities: rows.map((r) => ({ ...r, sovPct: total ? Math.round((r.mentions / total) * 1000) / 10 : 0 })),
    ownPct: total
      ? Math.round((rows.filter((r) => r.isSelf).reduce((a, r) => a + r.mentions, 0) / total) * 1000) / 10
      : 0,
  };
}

/** Seed the obvious aliases for an entity so it works immediately. */
export async function seedAliases(entityId, { name, nameAr }) {
  for (const [surface, lang] of [[name, "en"], [nameAr, "ar"]]) {
    if (!surface) continue;
    const norm = normalizeAr(surface);
    if (norm.length < 2) continue;
    await run(
      `INSERT INTO osint_aliases ("entityId", surface, "surfaceNorm", lang, kind, weight)
       VALUES ($1,$2,$3,$4,'EXACT',1) ON CONFLICT ("entityId", "surfaceNorm") DO NOTHING`,
      [entityId, surface, norm, lang]).catch(() => {});
  }
  bustEntityCache();
}

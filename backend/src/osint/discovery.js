import { all, get, run } from "../db.js";
import { normalizeAr } from "./arabic.js";

// ═══ HANDLE DISCOVERY (Wave 2·E · P4) ════════════════════════════════
// Social Analyzer's method, narrowed hard: find the official accounts of
// *organisations*. It proposes candidates with the evidence for each; a
// human confirms before anything binds to an entity.

// GUARDRAIL — enforced here, not merely stated. Discovery may only run
// against organisational entities. A spokesperson entity exists so their
// official statements can be attributed; it is not a licence to go
// looking for their accounts.
export const DISCOVERABLE_KINDS = ["ORG", "BRAND", "PRODUCT", "OUTLET"];

// Public profile URLs only. No authentication, ever — logging in to
// scrape is how a client's accounts get banned, and it is not ours to do.
export const PLATFORMS = [
  { key: "FACEBOOK", url: (h) => `https://www.facebook.com/${h}` },
  { key: "INSTAGRAM", url: (h) => `https://www.instagram.com/${h}/` },
  { key: "X", url: (h) => `https://x.com/${h}` },
  { key: "LINKEDIN", url: (h) => `https://www.linkedin.com/company/${h}` },
  { key: "YOUTUBE", url: (h) => `https://www.youtube.com/@${h}` },
  { key: "TIKTOK", url: (h) => `https://www.tiktok.com/@${h}` },
];

/** Candidate handles a company plausibly uses, from its own names. */
export function handleGuesses({ name, nameAr }) {
  const base = String(name || nameAr || "").toLowerCase()
    .replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return [];
  const words = base.split(" ").filter(Boolean);
  const out = new Set([
    words.join(""),
    words.join("-"),
    words.join("_"),
    words.slice(0, 2).join(""),
    words[0],
    words.map((w) => w[0]).join(""),
  ]);
  return [...out].filter((h) => h && h.length >= 3 && h.length <= 30);
}

/** Character-trigram overlap — tolerant of word order and small edits. */
export function similarity(a = "", b = "") {
  const grams = (s) => {
    const t = ` ${normalizeAr(s).replace(/[^\p{L}\p{N}]/gu, "")} `;
    const g = new Set();
    for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3));
    return g;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return Number((inter / new Set([...A, ...B]).size).toFixed(3));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One polite probe: does this public profile exist, and is it them? */
async function probe(platform, handle, entity, baseUrl) {
  const url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/${platform.key.toLowerCase()}/${handle}` : platform.url(handle);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "PulseBot/1.0 (+entity verification; contact your Pulse admin)" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const body = (await res.text()).slice(0, 20000);
    const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    const desc = (body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] || "").trim();

    // it exists — but is it the right organisation?
    const nameHit = Math.max(
      similarity(entity.name || "", title),
      similarity(entity.nameAr || "", title),
      similarity(entity.name || "", desc) * 0.8);
    const countryHit = entity.country && new RegExp(entity.country, "i").test(body) ? 0.08 : 0;
    const handleHit = similarity(entity.name || "", handle) * 0.5;

    return {
      platform: platform.key, handle, url,
      similarity: Number(Math.min(1, nameHit + countryHit + handleHit).toFixed(3)),
      evidence: { title: title.slice(0, 200), description: desc.slice(0, 300) },
    };
  } catch {
    return null;                                   // unreachable is not evidence of absence
  }
}

/**
 * Propose candidates for one entity. Rate-limited by construction: one
 * probe at a time with a pause, because hammering a platform from a
 * client's IP is how the client gets blocked.
 */
export async function discoverHandles(entityId, { baseUrl = null, minSimilarity = 0.25 } = {}) {
  const entity = await get(`SELECT * FROM osint_entities WHERE id = $1`, [entityId]);
  if (!entity) return { error: "Not found" };
  if (!DISCOVERABLE_KINDS.includes(entity.kind)) {
    return { error: "Discovery runs on organisations, brands, products and outlets only — Pulse does not search for individuals' accounts." };
  }

  const guesses = handleGuesses(entity);
  const found = [];
  for (const p of PLATFORMS) {
    for (const h of guesses.slice(0, 3)) {
      const hit = await probe(p, h, entity, baseUrl);
      await sleep(120);
      if (hit && hit.similarity >= minSimilarity) {
        found.push(hit);
        break;                                     // one candidate per platform is enough to review
      }
    }
  }

  for (const f of found) {
    await run(
      `INSERT INTO osint_handle_candidates ("entityId", platform, handle, url, similarity, evidence)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ("entityId", platform, handle) DO UPDATE
         SET similarity = EXCLUDED.similarity, evidence = EXCLUDED.evidence, "checkedAt" = now()`,
      [entityId, f.platform, f.handle, f.url, f.similarity, JSON.stringify(f.evidence)]).catch(() => {});
  }
  return { entity: entity.name, probed: PLATFORMS.length, candidates: found.length };
}

/** Confirming a candidate is what binds it — never discovery itself. */
export async function decideCandidate(id, status, userId) {
  const c = await get(`SELECT * FROM osint_handle_candidates WHERE id = $1`, [id]);
  if (!c) return null;
  await run(
    `UPDATE osint_handle_candidates SET status = $2, "decidedById" = $3, "decidedAt" = now() WHERE id = $1`,
    [id, status, userId || null]);

  if (status === "CONFIRMED") {
    const surface = `@${c.handle}`;
    await run(
      `INSERT INTO osint_aliases ("entityId", surface, "surfaceNorm", lang, kind, weight)
       VALUES ($1,$2,$3,'other','HANDLE',0.9) ON CONFLICT ("entityId", "surfaceNorm") DO NOTHING`,
      [c.entityId, surface, normalizeAr(surface)]).catch(() => {});
    const { bustEntityCache } = await import("./entities.js");
    bustEntityCache();
  }
  return await get(`SELECT * FROM osint_handle_candidates WHERE id = $1`, [id]);
}

export async function candidatesFor(entityId) {
  return await all(
    `SELECT c.*, u.name AS "decidedByName" FROM osint_handle_candidates c
     LEFT JOIN users u ON u.id = c."decidedById"
     WHERE c."entityId" = $1 ORDER BY c.similarity DESC`, [entityId]);
}

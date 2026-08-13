import { get } from "./db.js";

// ── Module feature flags (Wave 0) ────────────────────────────────────
// Per-client flags live in settings.modules (jsonb): { "<key>": false }.
// An ABSENT key means ENABLED — existing instances keep working untouched,
// and a client simply never sees a territory they didn't buy.
// Flags are enforced server-side here (route guard) AND client-side (nav);
// the server guard is the source of truth.

export const MODULE_KEYS = ["brain", "intel", "listening", "social", "media", "events", "planning", "studio", "agency", "automate", "research", "publish", "reach"];

let cache = { at: 0, modules: {} };
const TTL_MS = 5000; // tiny TTL: near-zero query cost, ≤5s propagation across serverless instances

export async function getModules() {
  if (Date.now() - cache.at < TTL_MS) return cache.modules;
  try {
    const row = await get(`SELECT modules FROM settings WHERE id = 1`);
    let m = row?.modules ?? {};
    if (typeof m === "string") { try { m = JSON.parse(m); } catch { m = {}; } }
    cache = { at: Date.now(), modules: m && typeof m === "object" ? m : {} };
  } catch {
    // Pre-migration DB (no modules column yet): treat everything as enabled.
    cache = { at: Date.now(), modules: {} };
  }
  return cache.modules;
}

export function invalidateModulesCache() {
  cache = { at: 0, modules: {} };
}

export const moduleEnabled = (mods, key) => mods?.[key] !== false;

/** Express guard: 404s a whole router when the client's plan disables the module. */
export const requireModule = (key) => async (req, res, next) => {
  try {
    if (moduleEnabled(await getModules(), key)) return next();
    return res.status(404).json({ error: "Module disabled", module: key });
  } catch (e) { next(e); }
};

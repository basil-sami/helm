import crypto from "node:crypto";
import { get } from "./db.js";

// Shared slug discipline for every public surface (/f /l /s /b …)
export function slugify(s, fallback = "x") {
  const base = String(s || "").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base.length >= 3 ? base : `${fallback}-${crypto.randomBytes(3).toString("hex")}`;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/** Ensure uniqueness within a table by suffixing -2, -3 … */
export async function uniqueSlug(table, want) {
  let slug = want, n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hit = await get(`SELECT 1 FROM ${table} WHERE slug = $1`, [slug]);
    if (!hit) return slug;
    n += 1; slug = `${want}-${n}`;
    if (n > 50) return `${want}-${crypto.randomBytes(3).toString("hex")}`;
  }
}

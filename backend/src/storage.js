import crypto from "crypto";
import { get, run } from "./db.js";

// ═══ THE STORAGE RAIL (Wave 2·C) ═════════════════════════════════════
// Two drivers, one contract — the mail rail's shape again. Supabase
// Storage when it's configured; otherwise the bytes live in Postgres so
// a self-hosted or offline instance is never blocked on a third party.

export const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024;

/** Broad file family, derived from the mime type — what the library filters on. */
export function kindOf(mime = "") {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  if (/pdf|word|excel|powerpoint|document|sheet|presentation|text\//.test(mime)) return "DOC";
  if (/zip|rar|7z|tar/.test(mime)) return "ARCHIVE";
  return "OTHER";
}
const BUCKET = process.env.SUPABASE_BUCKET || "pulse";

export function storageDriver() {
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY ? "SUPABASE" : "DB";
}

const secret = () => process.env.JWT_SECRET || process.env.CRON_SECRET || "pulse-dev-file-secret";

/** Short-lived signature so a private file URL can't be shared forever. */
export function signFile(id, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = crypto.createHmac("sha256", secret()).update(`${id}.${exp}`).digest("hex").slice(0, 32);
  return { exp, sig };
}

export function verifyFileSig(id, exp, sig) {
  if (!exp || !sig || Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac("sha256", secret()).update(`${id}.${exp}`).digest("hex").slice(0, 32);
  const a = Buffer.from(expected), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const slug = (name) =>
  String(name || "file").normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(-80) || "file";

/** Store bytes and return the file row. Never partially writes. */
export async function putFile({ buffer, name, mime, entity, entityId, userId, isPublic = false }) {
  if (!buffer?.length) throw Object.assign(new Error("Empty upload"), { userFacing: true });
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(new Error(`File is larger than ${Math.round(MAX_BYTES / 1048576)} MB`), { userFacing: true });
  }
  const sha = crypto.createHash("sha256").update(buffer).digest("hex");
  const key = `${new Date().toISOString().slice(0, 10)}/${crypto.randomBytes(6).toString("hex")}-${slug(name)}`;
  const driver = storageDriver();

  let remoteUrl = null, data = buffer;
  if (driver === "SUPABASE") {
    const base = process.env.SUPABASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": mime || "application/octet-stream",
        "x-upsert": "true",
      },
      body: buffer,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw Object.assign(new Error(`Storage upload failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`),
        { userFacing: true });
    }
    remoteUrl = `${base}/storage/v1/object/${isPublic ? "public/" : ""}${BUCKET}/${key}`;
    data = null; // the bytes are over there now
  }

  return await get(
    `INSERT INTO files ("key", name, mime, size, sha256, driver, data, "remoteUrl", public, entity, "entityId", "uploadedById")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, "key", name, mime, size, sha256, driver, "remoteUrl", public, entity, "entityId", "createdAt"`,
    [key, String(name || "file").slice(0, 200), mime || "application/octet-stream", buffer.length, sha,
     driver, data, remoteUrl, !!isPublic, entity || null, entityId || null, userId || null]);
}

/**
 * The URL to hand to the rest of the product. Public files get a stable
 * path; private ones get a signed, expiring one.
 */
export function fileUrl(file, { absolute = null, ttl = 3600 } = {}) {
  if (file.driver === "SUPABASE" && file.public && file.remoteUrl) return file.remoteUrl;
  const path = file.public
    ? `/api/files/${file.id}`
    : (() => { const { exp, sig } = signFile(file.id, ttl); return `/api/files/${file.id}?exp=${exp}&sig=${sig}`; })();
  return absolute ? `${absolute.replace(/\/$/, "")}${path}` : path;
}

/** Fetch bytes back, whichever driver holds them. */
export async function readFile(file) {
  if (file.driver === "SUPABASE") {
    const base = process.env.SUPABASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${file.key}`, {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Storage read failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const row = await get(`SELECT data FROM files WHERE id = $1`, [file.id]);
  return row?.data ? Buffer.from(row.data) : null;
}

export async function deleteFile(file) {
  if (file.driver === "SUPABASE" && process.env.SUPABASE_URL) {
    const base = process.env.SUPABASE_URL.replace(/\/$/, "");
    await fetch(`${base}/storage/v1/object/${BUCKET}/${file.key}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` },
      signal: AbortSignal.timeout(15000),
    }).catch(() => {});
  }
  await run(`DELETE FROM files WHERE id = $1`, [file.id]);
}

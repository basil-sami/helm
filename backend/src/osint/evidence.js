import crypto from "crypto";
import { get, run } from "../db.js";
import { putFile } from "../storage.js";

// ═══ EVIDENCE INTEGRITY (Wave 2·E · P3) ══════════════════════════════
// A board-pack claim whose source 404s six months later is worthless,
// and a PR or legal escalation is exactly when the original matters.
// So we keep our own copy, hashed, with who took it and when.

const strip = (html = "") =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Preserve a signal. Tries the live page; if it can't be reached, keeps
 * what we already hold and says so — a PARTIAL snapshot is honest, a
 * missing one is a gap nobody notices until it matters.
 */
export async function captureSnapshot(signal, userId) {
  let body = null, kind = "PARTIAL";
  if (signal.url) {
    try {
      const res = await fetch(signal.url, {
        headers: { "User-Agent": "PulseBot/1.0 (+listening archive)" },
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (res.ok) { body = await res.text(); kind = "FULL"; }
    } catch { /* link rot, blocks, timeouts — all expected */ }
  }

  const captured = new Date().toISOString();
  const text = body ? strip(body) : `${signal.title || ""}\n\n${signal.snippet || ""}`.trim();
  const record = [
    `# Pulse evidence snapshot`,
    `signal: ${signal.id}`,
    `url: ${signal.url || "(none)"}`,
    `title: ${signal.title || ""}`,
    `source: ${signal.source || ""}`,
    `published: ${signal.publishedAt || ""}`,
    `capturedAt: ${captured}`,
    `capturedBy: ${userId || "system"}`,
    `snapshot: ${kind}`,
    `textSha256: ${crypto.createHash("sha256").update(text).digest("hex")}`,
    ``,
    `---- extracted text ----`,
    text,
    ...(body ? [``, `---- raw html ----`, body] : []),
  ].join("\n");

  const file = await putFile({
    buffer: Buffer.from(record, "utf8"),
    name: `evidence-${signal.id}.txt`,
    mime: "text/plain; charset=utf-8",
    entity: "osint_signal",
    entityId: signal.id,
    userId,
    isPublic: false,                       // evidence is never a public link
  });

  await run(
    `UPDATE osint_signals SET "snapshotFileId" = $2, "capturedAt" = $3, "capturedById" = $4,
       "snapshotKind" = $5, "contentHash" = COALESCE("contentHash", $6) WHERE id = $1`,
    [signal.id, file.id, captured, userId || null, kind,
     crypto.createHash("sha256").update(text).digest("hex").slice(0, 32)]);

  return { fileId: file.id, kind, capturedAt: captured, sha256: file.sha256, bytes: file.size };
}

/** The full provenance chain for one signal — "show your work". */
export async function provenanceOf(signalId) {
  const s = await get(
    `SELECT s.*, t.label AS "topicLabel", u.name AS "reviewedByName", cu.name AS "capturedByName",
            src.domain AS "sourceDomain", src.reliability, src.kind AS "sourceKind", src."ownerGroup",
            f.id AS "fileId", f.sha256 AS "fileSha", f.size AS "fileSize"
     FROM osint_signals s
     LEFT JOIN osint_topics t ON t.id = s."topicId"
     LEFT JOIN users u ON u.id = s."reviewedById"
     LEFT JOIN users cu ON cu.id = s."capturedById"
     LEFT JOIN osint_sources src ON s.url LIKE '%' || src.domain || '%'
     LEFT JOIN files f ON f.id = s."snapshotFileId"
     WHERE s.id = $1 LIMIT 1`, [signalId]);
  if (!s) return null;

  const { all } = await import("../db.js");
  const entities = await all(
    `SELECT e.name, e."nameAr", e.kind, se."matchMethod", se."matchedOn", se.confidence,
            se.sentiment, se."sentimentLabel", se."sentimentConfidence"
     FROM osint_signal_entities se JOIN osint_entities e ON e.id = se."entityId"
     WHERE se."signalId" = $1 ORDER BY se.confidence DESC`, [signalId]);
  const siblings = s.clusterId
    ? await all(`SELECT id, title, source, url FROM osint_signals
                 WHERE "clusterId" = $1 AND id <> $2 ORDER BY "publishedAt" NULLS LAST LIMIT 20`,
                [s.clusterId, signalId])
    : [];

  return {
    signal: {
      id: s.id, title: s.title, snippet: s.snippet, url: s.url, source: s.source,
      publishedAt: s.publishedAt, fetchedAt: s.fetchedAt, topicLabel: s.topicLabel,
    },
    collection: {
      sourceDomain: s.sourceDomain, reliability: s.reliability, sourceKind: s.sourceKind,
      ownerGroup: s.ownerGroup, credibility: s.credibility, relevance: s.relevance,
    },
    dedupe: { clusterId: s.clusterId, canonical: s.canonical, syndicationCount: s.syndicationCount, siblings },
    review: { status: s.reviewStatus, by: s.reviewedByName, at: s.reviewedAt },
    sentiment: { score: s.sentiment, label: s.sentimentLabel, confidence: s.sentimentConfidence },
    entities,
    evidence: s.fileId
      ? { fileId: s.fileId, sha256: s.fileSha, size: s.fileSize, kind: s.snapshotKind,
          capturedAt: s.capturedAt, capturedBy: s.capturedByName, contentHash: s.contentHash }
      : null,
  };
}

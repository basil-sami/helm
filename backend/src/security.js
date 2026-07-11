// Security hardening middleware — dependency-free.

// Applied to every response. CSP is intentionally omitted for the SPA
// (inline chart styles); everything else is strict.
export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
}

// Sliding-window limiter keyed by IP. In-memory: on serverless each warm
// instance keeps its own window — still blunts credential-stuffing bursts.
export function rateLimit({ windowMs = 10 * 60 * 1000, max = 10, message = "Too many attempts — try again later" } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || now > rec.resetAt) rec = { count: 0, resetAt: now + windowMs };
    rec.count++;
    hits.set(ip, rec);
    if (hits.size > 5000) { // bound memory
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
    }
    if (rec.count > max) {
      res.setHeader("Retry-After", Math.ceil((rec.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

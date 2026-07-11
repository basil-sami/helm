// Dependency-free TOTP (RFC 6238, SHA-1, 30s step, 6 digits).
import crypto from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function b32encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function b32decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of str.replace(/=+$/,"").toUpperCase()) {
    const idx = B32.indexOf(ch); if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newSecret = () => b32encode(crypto.randomBytes(20));

function hotp(secretB32, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}
export function totpNow(secretB32, step = 30) {
  return hotp(secretB32, Math.floor(Date.now() / 1000 / step));
}
export function totpVerify(secretB32, code, window = 1, step = 30) {
  if (!/^\d{6}$/.test(String(code || ""))) return false;
  const t = Math.floor(Date.now() / 1000 / step);
  for (let w = -window; w <= window; w++) if (hotp(secretB32, t + w) === String(code)) return true;
  return false;
}
export const otpauthUrl = (secret, account, issuer = "HELM") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;

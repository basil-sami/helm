// ── Nabd theming engine (Wave 0) ─────────────────────────────────────
// One client accent color → a full derived scale, applied as CSS variables.
// Tailwind's `amber-*` tokens read these vars, so a single hex re-themes
// the entire interface without breaking the ink/paper foundation.

export const PULSE_ACCENT = "#E8A33D"; // the Pulse default — amber on ink

const SHADE_KEYS = ["50", "300", "400", "500", "600", "700"] as const;

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Derive the six-step scale as "R G B" triplet strings keyed by shade. */
export function deriveAccent(hex: string): Record<(typeof SHADE_KEYS)[number], string> | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s, l] = rgbToHsl(...rgb);
  const at = (ls: number, ss = s) => hslToRgb(h, clamp01(ss), clamp01(ls)).join(" ");
  return {
    "50": at(0.94, Math.min(s, 0.82)),
    "300": at(l + 0.16),
    "400": at(l + 0.08),
    "500": rgb.join(" "),
    "600": at(l - 0.1, Math.min(1, s + 0.05)),
    "700": at(l - 0.2, Math.min(1, s + 0.08)),
  };
}

/** Apply (or reset) the client accent. Invalid/absent hex falls back to the Pulse default. */
export function applyAccent(hex?: string | null) {
  const root = document.documentElement;
  const scale = deriveAccent(hex || PULSE_ACCENT) || deriveAccent(PULSE_ACCENT)!;
  for (const k of SHADE_KEYS) root.style.setProperty(`--accent-${k}`, scale[k]);
}

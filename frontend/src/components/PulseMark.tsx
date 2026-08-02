// ── The Pulse mark (نبض) ─────────────────────────────────────────────
// The brand's heartbeat: an amber ECG waveform on ink. When a client sets
// their own logo it takes the mark's place — Pulse identity is the default
// theme, never the only theme.

const ECG_D = "M2 13h4l2.2-5.6 3.4 10.8 2.5-7.6 1.5 2.4H22";

export function EcgGlyph({ className, strokeWidth = 2.1 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ECG_D} />
    </svg>
  );
}

export default function PulseMark({ size = 36, logoUrl, className = "" }: { size?: number; logoUrl?: string | null; className?: string }) {
  if (logoUrl) {
    return (
      <img src={logoUrl} alt="" width={size} height={size}
        className={`shrink-0 rounded-lg bg-white/10 object-cover ${className}`}
        style={{ width: size, height: size }} />
    );
  }
  return (
    <div className={`grid shrink-0 place-items-center rounded-lg bg-amber-500 text-ink-950 ${className}`}
      style={{ width: size, height: size }}>
      <EcgGlyph className="h-[62%] w-[62%]" />
    </div>
  );
}

/** The loading state IS the heartbeat: a travelling ECG segment. */
export function EcgLoader({ label, className = "" }: { label?: string; className?: string }) {
  const d = "M0 16h26l4-0 3.6-9 5.4 18 4-12.4 2.6 4.6 3.4-1.2h24l4 0 3.6-8 5.4 16 4-11 2.6 4 3.4-1h20";
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`} role="status" aria-live="polite">
      <svg className="ecg-loader" viewBox="0 0 120 32" width="168" height="46" fill="none" aria-hidden="true">
        <path d={d} stroke="currentColor" strokeOpacity="0.14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path className="ecg-run" d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label && <div className="text-sm text-ink-500">{label}</div>}
    </div>
  );
}

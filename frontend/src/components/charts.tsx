import { useI18n } from "../context/I18nContext";

const ACCENTS: Record<string, string> = {
  amber: "#E8A33D", steel: "#3F7191", moss: "#5E8B5A", clay: "#C2603E", violet: "#7A6CA8", teal: "#3E8F8A", ink: "#3A4654",
};

// ── Horizontal bars (channels, sources, value-by-stage, content status) ──
export function HBars({
  data, accent = "amber", format, colorFor,
}: {
  data: { label: string; value: number; sub?: string }[];
  accent?: string;
  format?: (n: number) => string;
  colorFor?: (index: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const color = ACCENTS[accent] || accent;
  if (data.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.label} className="flex items-center gap-3">
          <div className="w-28 shrink-0 truncate text-sm text-ink-600" title={d.label}>{d.label}</div>
          <div className="relative h-6 flex-1 overflow-hidden rounded bg-paper-200">
            <div className="h-full rounded transition-all duration-slow" style={{ width: `${(d.value / max) * 100}%`, background: colorFor ? colorFor(i) : color }} />
          </div>
          <div className="w-24 shrink-0 text-end">
            <span className="kpi-num text-xs text-ink-800">{format ? format(d.value) : d.value}</span>
            {d.sub && <div className="text-[10px] text-ink-400">{d.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Sales funnel (descending centered bars with conversion %) ──────────
export function Funnel({ data, el }: { data: { stage: string; count: number; conversion: number }[]; el: (s: string) => string }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => {
        const w = 40 + (d.count / max) * 60; // 40%..100%
        return (
          <div key={d.stage} className="flex items-center gap-3">
            <div className="w-24 shrink-0 text-sm text-ink-600">{el(d.stage)}</div>
            <div className="flex flex-1 justify-center">
              <div className="flex h-9 items-center justify-center rounded text-sm font-semibold text-white transition-all duration-slow"
                style={{ width: `${w}%`, background: `linear-gradient(90deg, #CC8526, #E8A33D)` }}>
                <span className="kpi-num">{d.count}</span>
              </div>
            </div>
            <div className="w-14 shrink-0 text-end text-xs text-ink-500">
              {i > 0 && <span className={d.conversion >= 50 ? "text-moss-600" : d.conversion >= 25 ? "text-amber-700" : "text-clay-600"}>{d.conversion}%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Area trend (SVG line + fill over months) ───────────────────────────
export function AreaTrend({
  data, accent = "amber", format,
}: {
  data: { month: string; value: number }[];
  accent?: string;
  format?: (n: number) => string;
}) {
  const { lang } = useI18n();
  const color = ACCENTS[accent] || accent;
  const W = 520, H = 140, P = 8;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const x = (i: number) => (n <= 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P - 14);
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`);
  const line = pts.length ? `M${pts.join(" L")}` : "";
  const area = pts.length ? `M${x(0)},${H - P} L${pts.join(" L")} L${x(n - 1)},${H - P} Z` : "";
  const monthLabel = (m: string) => {
    const d = new Date(m + "-01");
    return d.toLocaleDateString(lang === "ar" ? "ar" : "en", { month: "short" });
  };
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 140 }}>
        <defs>
          <linearGradient id={`g-${accent}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill={`url(#g-${accent})`} />}
        {line && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r="2.5" fill={color} />)}
      </svg>
      <div className="mt-1 flex justify-between px-1 text-[10px] text-ink-400">
        {data.map((d) => <span key={d.month}>{monthLabel(d.month)}</span>)}
      </div>
      {format && <div className="mt-1 text-end text-xs text-ink-500">{lang === "ar" ? "الإجمالي: " : "Total: "}{format(data.reduce((a, d) => a + Number(d.value || 0), 0))}</div>}
    </div>
  );
}

// ── Spark (tiny inline trend for monitoring cards) ─────────────────────
export function Spark({ data, color = "#E8A33D" }: { data: number[]; color?: string }) {
  const W = 96, H = 28, P = 2;
  if (data.length < 2) return <div className="h-7 w-24 rounded bg-paper-200/60" />;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / (data.length - 1);
  const y = (v: number) => H - P - ((v - min) / range) * (H - 2 * P);
  const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-24">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="2" fill={color} />
    </svg>
  );
}

// ── Donut (sentiment, proportions) ─────────────────────────────────────
export function Donut({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = Math.max(1, segments.reduce((a, s) => a + Number(s.value || 0), 0));
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
        {segments.map((s) => {
          const len = (s.value / total) * C;
          const seg = <circle key={s.label} cx="50" cy="50" r={R} fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return seg;
        })}
      </svg>
      <div className="space-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-ink-600">{s.label}</span>
            <span className="kpi-num text-ink-800">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

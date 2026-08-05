import { useMemo, useState } from "react";
import { useFetch, Card, Field, Select, Modal, SectionTitle, SkeletonCards } from "../components/ui";
import { useToast } from "../components/Toast";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { fmtMoney, fmtNum, fmtDate } from "../lib/format";
import AnalyticsBoards from "./AnalyticsBoards";
import { TargetArrivals, BudgetScenario } from "./Forecast";
import MediaMix from "./MediaMix";
import { DepartmentRollup } from "./Departments";

// ═══ ANALYTICS — the measurement brain, fronted by the Pulse Index ═══

interface Comp { key: string; value: number; score: number; weight: number }
interface Overview {
  pulse: { value: number; components: Comp[] };
  areas: { key: string; name: string; nameAr?: string; value: number; components: Comp[] }[];
  movers: { key: string; name: string; nameAr?: string; unit: string; direction: string; current: number; previous: number; deltaPct: number }[];
  alerts: { metricKey: string; metricName: string; metricNameAr?: string; condition: string; threshold: number; lastFiredAt: string }[];
}
interface Metric { key: string; name: string; nameAr?: string; category: string; unit: string; direction: string; active: boolean }
interface Pacing {
  id: string; metricKey: string; metricName: string; metricNameAr?: string; unit: string;
  periodStart: string; periodEnd: string; target: number; actual: number; expected: number; progressPct: number; pacePct: number;
}
interface Alert { id: string; metricKey: string; metricName: string; metricNameAr?: string; condition: string; threshold: number; windowDays: number; active: boolean; lastFiredAt?: string | null }
interface RepRun { id: string; templateKey: string; period: string; generatedAt: string; generatedByName?: string | null }
interface RepItem { key: string; name: string; nameAr?: string; category: string; unit: string; value: number; prev: number | null; deltaPct: number | null }

const toneOf = (v: number) => (v >= 70 ? "text-moss-600" : v >= 40 ? "text-amber-600" : "text-clay-600");
const strokeOf = (v: number) => (v >= 70 ? "#5f7a4e" : v >= 40 ? "#c98a2b" : "#b0563f");

type Lang = "ar" | "en";
function fmtVal(v: number | null | undefined, unit: string, lang: Lang) {
  if (v === null || v === undefined) return "—";
  if (unit === "usd") return fmtMoney(v, "USD", lang);
  if (unit === "pct") return `${Math.round(v * 10) / 10}%`;
  if (unit === "days" || unit === "hours" || unit === "score") return String(Math.round(v * 10) / 10);
  return fmtNum(v, lang);
}

/** The dial: a 270° arc gauge with an ECG line running underneath. */
function PulseDial({ value }: { value: number }) {
  const { tr } = useI18n();
  const r = 64, c = 2 * Math.PI * r, frac = 0.75, span = c * frac;
  const filled = span * Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)) / 100;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 160 160" className="h-44 w-44">
        <g transform="rotate(135 80 80)">
          <circle cx="80" cy="80" r={r} fill="none" stroke="var(--paper-300, #e6ded2)" strokeWidth="10"
            strokeDasharray={`${span} ${c}`} strokeLinecap="round" />
          <circle cx="80" cy="80" r={r} fill="none" stroke={strokeOf(value)} strokeWidth="10"
            strokeDasharray={`${filled} ${c}`} strokeLinecap="round" className="transition-all duration-700" />
        </g>
        <text x="80" y="78" textAnchor="middle" className="kpi-num" fontSize="34" fill="currentColor">{Number.isFinite(value) ? Math.round(value) : 0}</text>
        <text x="80" y="96" textAnchor="middle" fontSize="9" fill="#8a8172">/ 100</text>
        <polyline points="34,128 52,128 60,116 68,140 76,120 84,128 126,128" fill="none"
          stroke={strokeOf(value)} strokeWidth="2" strokeLinejoin="round" opacity="0.85" />
      </svg>
      <div className="mt-1 text-sm font-semibold text-ink-800">{tr("an_index")}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-500" title={tr("an_pulseScale")}>
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#b0563f" }} /><span>0–39</span>
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#c98a2b" }} /><span>40–69</span>
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#5f7a4e" }} /><span>70–100</span>
      </div>
    </div>
  );
}

/** Inline sparkline from a series of {date, value}. */
function Spark({ pts, stroke = "#c98a2b" }: { pts: { date: string; value: number }[]; stroke?: string }) {
  if (!pts.length) return null;
  const vs = pts.map((p) => Number(p.value));
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const w = 280, h = 48;
  const line = vs.map((v, i) => `${(i / Math.max(1, vs.length - 1)) * w},${h - 6 - ((v - min) / span) * (h - 12)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full" preserveAspectRatio="none">
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function DeltaChip({ pct, direction }: { pct: number; direction: string }) {
  const good = direction === "LOWER" ? pct < 0 : pct > 0;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${good ? "bg-moss-100 text-moss-700" : "bg-clay-100 text-clay-700"}`} dir="ltr">
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────
function OverviewTab() {
  const { tr, lang } = useI18n();
  const { data: metrics } = useFetch<Metric[]>("/metrics");
  const metricName = (key: string) => {
    const m = metrics?.find((x) => x.key === key);
    return m ? (lang === "ar" && m.nameAr ? m.nameAr : m.name) : key;
  };
  const { data, loading } = useFetch<Overview>("/analytics/overview");
  const nameOf = (m: { name: string; nameAr?: string }) => (lang === "ar" && m.nameAr ? m.nameAr : m.name);
  if (loading || !data) return <SkeletonCards count={4} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex items-center justify-center p-5"><PulseDial value={data.pulse.value} /></Card>
        <Card className="p-4 lg:col-span-2">
          <SectionTitle>{tr("an_areas")}</SectionTitle>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {data.areas.map((a) => (
              <div key={a.key} className="rounded-xl border border-paper-200 bg-paper-50 p-3">
                <div className="text-[11px] text-ink-500">{nameOf(a)}</div>
                <div className={`kpi-num text-2xl ${toneOf(a.value)}`}>{Math.round(a.value)}</div>
                <div className="mt-2 space-y-1" title={`${tr("an_barsHint")}`}>
                  {a.components.map((c) => (
                    <div key={c.key} className="h-1.5 w-full overflow-hidden rounded-full bg-paper-200" title={`${metricName(c.key)}: ${c.score}/100`}>
                      <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${c.score}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle>{tr("an_movers")}</SectionTitle>
          {data.movers.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">{tr("an_noMovers")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-paper-200">
              {data.movers.map((m) => (
                <li key={m.key} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className="text-sm font-medium text-ink-800">{nameOf(m)}</div>
                    <div className="text-[11px] text-ink-500" dir="ltr">{fmtVal(m.previous, m.unit, lang)} → {fmtVal(m.current, m.unit, lang)}</div>
                  </div>
                  <DeltaChip pct={m.deltaPct} direction={m.direction} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <SectionTitle>{tr("an_alertsFired")}</SectionTitle>
          <AiDrafts />
          <DepartmentRollup />
          <TargetArrivals />
          <BudgetScenario />
          <MediaMix />
          {data.alerts.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">{tr("an_noAlerts")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-paper-200">
              {data.alerts.map((a, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-clay-700">{lang === "ar" && a.metricNameAr ? a.metricNameAr : a.metricName}</span>
                  <span className="text-[11px] text-ink-500" dir="ltr">{a.condition} {a.threshold} · {fmtDate(a.lastFiredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Explore tab ──────────────────────────────────────────────────────
function ExploreTab({ metrics }: { metrics: Metric[] }) {
  const { tr, lang } = useI18n();
  const [key, setKey] = useState("leads_new_30d");
  const [days, setDays] = useState(90);
  const { data: series } = useFetch<{ date: string; value: number }[]>(`/metrics/${key}/series?days=${days}`, [key, days]);
  const { data: live } = useFetch<{ value: number }>(`/metrics/${key}/value`, [key]);
  const { data: slices } = useFetch<{ dims: Record<string, string>; value: number }[]>(`/metrics/${key}/slices`, [key]);
  const m = metrics.find((x) => x.key === key);
  const nameOf = (x?: { name: string; nameAr?: string }) => (x ? (lang === "ar" && x.nameAr ? x.nameAr : x.name) : "");
  const groups = useMemo(() => {
    const g: Record<string, Metric[]> = {};
    for (const x of metrics) (g[x.category] ||= []).push(x);
    return g;
  }, [metrics]);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-4">
        <Field label={tr("an_metric")}>
          <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
            {Object.entries(groups).map(([cat, ms]) => (
              <optgroup key={cat} label={cat}>
                {ms.map((x) => <option key={x.key} value={x.key}>{nameOf(x)}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="mt-3 flex gap-1">
          {[30, 90, 365].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${days === d ? "bg-ink-900 text-paper-50" : "bg-paper-200 text-ink-600 hover:bg-paper-300"}`} dir="ltr">
              {d}d
            </button>
          ))}
        </div>
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-500">{tr("an_latest")}</div>
          <div className="kpi-num text-3xl text-ink-900">{fmtVal(live?.value, m?.unit || "count", lang)}</div>
        </div>
      </Card>
      <Card className="p-4 lg:col-span-2">
        <SectionTitle>{nameOf(m)}</SectionTitle>
        {series && series.length > 1 ? <div className="mt-3"><Spark pts={series} /></div>
          : <p className="mt-3 text-sm text-ink-500">{tr("an_noSeries")}</p>}
        {slices && slices.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-500">{tr("an_slices")}</div>
            <ul className="divide-y divide-paper-200">
              {slices.map((s, i) => (
                <li key={i} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-ink-700">{Object.values(s.dims).join(" · ")}</span>
                  <span className="kpi-num" dir="ltr">{fmtVal(s.value, m?.unit || "count", lang)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Targets & alerts tab ─────────────────────────────────────────────
function TargetsTab({ metrics, isAdmin }: { metrics: Metric[]; isAdmin: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: pacing, reload: reloadPace } = useFetch<Pacing[]>("/metric-targets/pacing");
  const { data: alerts, reload: reloadAlerts } = useFetch<Alert[]>("/metric-alerts");
  const [nt, setNt] = useState<{ metricKey: string; periodStart: string; periodEnd: string; target: number } | null>(null);
  const [na, setNa] = useState<{ metricKey: string; condition: string; threshold: number; windowDays: number } | null>(null);
  const nameOf = (x: { metricName?: string; metricNameAr?: string; name?: string; nameAr?: string }) =>
    lang === "ar" ? (x.metricNameAr || x.nameAr || x.metricName || x.name) : (x.metricName || x.name);
  const opts = metrics.filter((m) => m.category !== "PULSE" || m.key.startsWith("pulse")).map((m) => ({ value: m.key, label: (lang === "ar" && m.nameAr ? m.nameAr : m.name) }));

  const saveTarget = async () => {
    if (!nt) return;
    try { await api.post("/metric-targets", nt); setNt(null); reloadPace(); toast.push(tr("saved"), "success"); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };
  const saveAlert = async () => {
    if (!na) return;
    try { await api.post("/metric-alerts", na); setNa(null); reloadAlerts(); toast.push(tr("saved"), "success"); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{tr("an_targets")}</SectionTitle>
          {isAdmin && <button className="btn-amber text-xs" onClick={() => setNt({ metricKey: "leads_new_30d", periodStart: new Date().toISOString().slice(0, 8) + "01", periodEnd: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10), target: 0 })}>{tr("an_target_new")}</button>}
        </div>
        {!pacing?.length ? <p className="mt-2 text-sm text-ink-500">{tr("empty")}</p> : (
          <ul className="mt-3 space-y-3">
            {pacing.map((t) => {
              const pctBar = Math.min(100, t.progressPct);
              const expBar = t.target ? Math.min(100, Math.round((t.expected / t.target) * 100)) : 0;
              const paceTone = t.pacePct >= 100 ? "text-moss-600" : t.pacePct >= 80 ? "text-amber-600" : "text-clay-600";
              return (
                <li key={t.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink-800">{nameOf(t)}</span>
                    <span className={`kpi-num text-xs ${paceTone}`} dir="ltr">{t.pacePct}% {tr("an_pace")}</span>
                  </div>
                  <div className="relative mt-1 h-2 w-full overflow-hidden rounded-full bg-paper-200">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${pctBar}%` }} />
                    <div className="absolute top-0 h-full w-0.5 bg-ink-700/70" style={{ insetInlineStart: `${expBar}%` }} title={tr("an_expected")} />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[11px] text-ink-500" dir="ltr">
                    <span>{fmtVal(t.actual, t.unit, lang)} / {fmtVal(t.target, t.unit, lang)}</span>
                    <span>{fmtDate(t.periodStart)} → {fmtDate(t.periodEnd)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{tr("an_alerts")}</SectionTitle>
          {isAdmin && <button className="btn-amber text-xs" onClick={() => setNa({ metricKey: "leads_new_30d", condition: "BELOW", threshold: 0, windowDays: 7 })}>{tr("an_alert_new")}</button>}
        </div>
        {!alerts?.length ? <p className="mt-2 text-sm text-ink-500">{tr("empty")}</p> : (
          <ul className="mt-2 divide-y divide-paper-200">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium text-ink-800">{nameOf(a)}</div>
                  <div className="text-[11px] text-ink-500" dir="ltr">{a.condition} {a.threshold} · {a.windowDays}d</div>
                </div>
                <span className="text-[11px] text-ink-500">{a.lastFiredAt ? fmtDate(a.lastFiredAt) : tr("an_never")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!nt} onClose={() => setNt(null)} title={tr("an_target_new")}
        footer={<><button onClick={() => setNt(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={saveTarget} className="btn-amber">{tr("save")}</button></>}>
        {nt && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("an_metric")}><Select value={nt.metricKey} onChange={(v) => setNt({ ...nt, metricKey: v })} options={opts} /></Field></div>
            <Field label={tr("an_periodStart")}><input type="date" className="input" dir="ltr" value={nt.periodStart} onChange={(e) => setNt({ ...nt, periodStart: e.target.value })} /></Field>
            <Field label={tr("an_periodEnd")}><input type="date" className="input" dir="ltr" value={nt.periodEnd} onChange={(e) => setNt({ ...nt, periodEnd: e.target.value })} /></Field>
            <div className="col-span-2"><Field label={tr("an_targetVal")}><input type="number" className="input" dir="ltr" value={nt.target} onChange={(e) => setNt({ ...nt, target: Number(e.target.value) })} /></Field></div>
          </div>
        )}
      </Modal>

      <Modal open={!!na} onClose={() => setNa(null)} title={tr("an_alert_new")}
        footer={<><button onClick={() => setNa(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={saveAlert} className="btn-amber">{tr("save")}</button></>}>
        {na && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("an_metric")}><Select value={na.metricKey} onChange={(v) => setNa({ ...na, metricKey: v })} options={opts} /></Field></div>
            <Field label={tr("an_condition")}><Select value={na.condition} onChange={(v) => setNa({ ...na, condition: v })} options={["ABOVE", "BELOW", "DELTA_PCT"].map((c) => ({ value: c, label: c }))} /></Field>
            <Field label={tr("an_threshold")}><input type="number" className="input" dir="ltr" value={na.threshold} onChange={(e) => setNa({ ...na, threshold: Number(e.target.value) })} /></Field>
            <div className="col-span-2"><Field label={tr("an_window")}><input type="number" className="input" dir="ltr" value={na.windowDays} onChange={(e) => setNa({ ...na, windowDays: Number(e.target.value) })} /></Field></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Reports tab ──────────────────────────────────────────────────────
function ReportsTab({ isAdmin }: { isAdmin: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: runs, reload } = useFetch<RepRun[]>("/reports");
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{ period: string; items: RepItem[] } | null>(null);
  const run = async () => {
    setBusy(true);
    try { await api.post("/reports/run", { templateKey: "monthly_board", period }); reload(); toast.push(tr("saved"), "success"); }
    catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  };
  const open = async (id: string) => {
    const r = await api.get<{ snapshot: string | { period: string; items: RepItem[] } }>(`/reports/${id}`);
    const snap = typeof r.snapshot === "string" ? JSON.parse(r.snapshot) : r.snapshot;
    setView(snap);
  };
  const grouped = useMemo(() => {
    const g: Record<string, RepItem[]> = {};
    for (const it of view?.items || []) (g[it.category] ||= []).push(it);
    return g;
  }, [view]);
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label={tr("an_period")}><input type="month" className="input" dir="ltr" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
        {isAdmin && <button onClick={run} disabled={busy} className="btn-amber">{tr("an_report_run")}</button>}
        <p className="text-xs text-ink-500">{tr("an_reportHint")}</p>
      </Card>
      <Card className="p-4">
        <SectionTitle>{tr("an_runs")}</SectionTitle>
        {!runs?.length ? <p className="mt-2 text-sm text-ink-500">{tr("empty")}</p> : (
          <ul className="mt-2 divide-y divide-paper-200">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="kpi-num font-semibold" dir="ltr">{r.period}</span>
                  <span className="ms-2 text-[11px] text-ink-500">{fmtDate(r.generatedAt)} · {r.generatedByName || "—"}</span>
                </div>
                <button className="btn-ghost text-xs" onClick={() => open(r.id)}>{tr("an_view")}</button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!view} onClose={() => setView(null)} title={`${tr("an_reportTitle")} · ${view?.period || ""}`}>
        {view && (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto">
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-500">{cat}</div>
                <ul className="divide-y divide-paper-200 rounded-xl border border-paper-200">
                  {items.map((it) => (
                    <li key={it.key} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-ink-800">{lang === "ar" && it.nameAr ? it.nameAr : it.name}</span>
                      <span className="flex items-center gap-2" dir="ltr">
                        <span className="kpi-num font-semibold">{fmtVal(it.value, it.unit, lang)}</span>
                        {it.deltaPct !== null && (
                          <span className={`text-[11px] ${it.deltaPct >= 0 ? "text-moss-600" : "text-clay-600"}`}>
                            {it.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(it.deltaPct)}%
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────
export default function Analytics() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const isAdmin = can("analytics", "write");
  const [tab, setTab] = useState<"overview" | "explore" | "boards" | "targets" | "reports">("overview");
  const { data: metrics } = useFetch<Metric[]>("/metrics");
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const runDaily = async () => {
    setRunning(true);
    try { await api.post("/metrics/run-daily", {}); toast.push(tr("an_ranDaily"), "success"); }
    catch (e) { toast.push((e as Error).message, "error"); }
    finally { setRunning(false); }
  };
  const tabs: { id: typeof tab; label: string }[] = [
    { id: "overview", label: tr("an_overview") },
    { id: "explore", label: tr("an_explore") },
    { id: "boards", label: tr("an_boards") },
    { id: "targets", label: tr("an_targets") },
    { id: "reports", label: tr("an_reports") },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${tab === t.id ? "bg-ink-900 text-paper-50" : "bg-paper-200 text-ink-600 hover:bg-paper-300"}`}>
              {t.label}
            </button>
          ))}
        </div>
        {isAdmin && <button onClick={runDaily} disabled={running} className="btn-ghost text-xs">{tr("an_runDaily")}</button>}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "explore" && <ExploreTab metrics={metrics || []} />}
      {tab === "boards" && <AnalyticsBoards />}
      {tab === "targets" && <TargetsTab metrics={metrics || []} isAdmin={isAdmin} />}
      {tab === "reports" && <ReportsTab isAdmin={isAdmin} />}
    </div>
  );
}

// ── Wave 3·C · what the model proposed, waiting on a person ──────────
interface Draft {
  id: string; title: string; titleAr?: string; body?: string; status: string;
  aiGenerated: boolean; alertLabel?: string; hypotheses?: unknown; createdAt: string;
}

function AiDrafts() {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data, reload } = useFetch<Draft[]>("/ai/drafts");
  const [open, setOpen] = useState<Draft | null>(null);
  const rows = data || [];
  if (!rows.length) return null;

  const decide = async (id: string, status: "PUBLISHED" | "DISMISSED") => {
    try {
      await api.post(`/ai/drafts/${id}/decide`, { status });
      setOpen(null); reload();
      toast.push(tr(status === "PUBLISHED" ? "ai_kept" : "ai_dismissed"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  const cites = (d: Draft) => {
    const h = d.hypotheses;
    const arr = typeof h === "string" ? JSON.parse(h || "[]") : (h as { text: string }[] | undefined);
    return Array.isArray(arr) ? arr : [];
  };

  return (
    <div className="mb-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
        ✎ {tr("ai_drafts")} <span className="kpi-num" dir="ltr">{rows.length}</span>
      </div>
      <div className="mt-1.5 space-y-1">
        {rows.slice(0, 4).map((d) => (
          <button key={d.id} onClick={() => setOpen(d)}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-white/60">
            <span className="truncate text-xs text-ink-800">{lang === "ar" && d.titleAr ? d.titleAr : d.title}</span>
            <span className="shrink-0 text-[10px] text-ink-400">{tr("ai_pending")}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-ink-400">{tr("ai_draftHint")}</p>

      {open && (
        <Modal open title={lang === "ar" && open.titleAr ? open.titleAr : open.title} onClose={() => setOpen(null)}>
          <div className="space-y-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">{open.body}</p>
            {cites(open).length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("ai_basedOn")}</div>
                <ul className="mt-1 space-y-0.5">
                  {cites(open).map((c, i) => (
                    <li key={i} className="text-[11px] text-ink-600">· {c.text}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[10px] text-ink-400">{tr("ai_draftNote")}</p>
            <div className="flex gap-2">
              <button onClick={() => decide(open.id, "PUBLISHED")} className="btn-amber flex-1">✓ {tr("ai_keep")}</button>
              <button onClick={() => decide(open.id, "DISMISSED")} className="btn-ghost flex-1">✕ {tr("ai_dismiss")}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

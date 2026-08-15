import { useEffect, useState } from "react";
import { Card, SectionTitle, Select, Modal } from "./ui";
import { Spark } from "./charts";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { fmtNum } from "../lib/format";

// ═══ UI·DEBT4 · THE LAST LINE: METRIC BOARDS GET THEIR BUILDER ════════
// The dashboards rail shipped with the Analytics territory — CRUD, a
// seeded «لوحة الإدارة», and a widget vocabulary of {metricKey, viz,
// size} — and never met an operator. This is its builder: the 82-metric
// catalog is the palette, the snapshot ledger is the paint, and every
// number renders from the same semantic layer the board pack reads.
// No widget invents a value the catalog cannot compute.

interface Board { id: string; name: string; nameAr?: string; widgets: Widget[] | string; shared: boolean; isDefault: boolean }
interface Widget { metricKey: string; viz: "KPI" | "LINE"; size?: "lg" }
interface Metric { key: string; name: string; nameAr?: string; category: string; unit?: string; direction?: string }
interface Value { value: number | null; target?: number | null; pacePct?: number | null }

const wArr = (b: Board | null): Widget[] => !b ? [] : Array.isArray(b.widgets) ? b.widgets : JSON.parse(b.widgets || "[]");

function WidgetCard({ w, metric, lang }: { w: Widget; metric?: Metric; lang: "ar" | "en" }) {
  const [val, setVal] = useState<Value | null>(null);
  const [series, setSeries] = useState<{ date: string; value: number }[]>([]);
  useEffect(() => {
    api.get<Value>(`/metrics/${w.metricKey}/value`).then(setVal).catch(() => setVal({ value: null }));
    if (w.viz === "LINE") api.get<{ date: string; value: number }[]>(`/metrics/${w.metricKey}/series?days=90`).then(setSeries).catch(() => {});
  }, [w.metricKey, w.viz]);
  const label = metric ? (lang === "ar" && metric.nameAr ? metric.nameAr : metric.name) : w.metricKey;
  return (
    <Card className={`p-4 ${w.size === "lg" ? "sm:col-span-2" : ""}`}>
      <div className="text-xs uppercase tracking-wide text-ink-500" dir="auto">{label}</div>
      <div className="kpi-num mt-1 text-2xl text-ink-900" dir="ltr">
        {val === null ? "…" : val.value === null ? "—" : fmtNum(val.value, lang)}
        {metric?.unit === "pct" && val?.value !== null && val !== null ? "%" : ""}
      </div>
      {w.viz === "LINE" && series.length > 1 && (
        <div className="mt-2"><Spark data={series.map((p) => p.value)} /></div>
      )}
      {val?.target != null && (
        <div className="mt-0.5 text-[10px] text-ink-400" dir="ltr">→ {fmtNum(val.target, lang)}{val.pacePct != null ? ` · ${val.pacePct}%` : ""}</div>
      )}
    </Card>
  );
}

export function MetricBoards() {
  const { lang, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const w = can("analytics", "write");

  const [boards, setBoards] = useState<Board[] | null>(null);
  const [cur, setCur] = useState<Board | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [building, setBuilding] = useState(false);
  const [adding, setAdding] = useState<{ metricKey: string; viz: "KPI" | "LINE"; lg: boolean } | null>(null);
  const [naming, setNaming] = useState<{ id?: string; name: string; nameAr: string } | null>(null);

  const load = async (keepId?: string) => {
    try {
      const [b, m] = await Promise.all([api.get<Board[]>("/dashboards"), api.get<Metric[]>("/metrics")]);
      setBoards(b); setMetrics(m);
      const pick = (keepId && b.find((x) => x.id === keepId)) || b.find((x) => x.isDefault) || b[0] || null;
      setCur(pick);
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const saveWidgets = async (widgets: Widget[]) => {
    if (!cur) return;
    try { const r = await api.patch<Board>(`/dashboards/${cur.id}`, { widgets }); setCur(r); setBoards((bs) => (bs || []).map((b) => b.id === r.id ? r : b)); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };
  const move = (i: number, dir: -1 | 1) => {
    const ws = [...wArr(cur)];
    const t = ws[i + dir]; if (!t) return;
    ws[i + dir] = ws[i]; ws[i] = t;
    saveWidgets(ws);
  };
  const saveBoard = async () => {
    if (!naming?.name) return;
    try {
      if (naming.id) { const r = await api.patch<Board>(`/dashboards/${naming.id}`, { name: naming.name, nameAr: naming.nameAr || null }); await load(r.id); }
      else { const r = await api.post<Board>("/dashboards", { name: naming.name, nameAr: naming.nameAr || null, widgets: [] }); await load(r.id); }
      setNaming(null);
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const removeBoard = async () => {
    if (!cur || cur.isDefault || !confirm(tr("db_deleteConfirm"))) return;
    try { await api.del(`/dashboards/${cur.id}`); await load(); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };

  if (!boards) return <div className="skeleton h-32 w-full rounded-2xl" />;
  const widgets = wArr(cur);
  const byCat = metrics.reduce<Record<string, Metric[]>>((a, m) => { (a[m.category] ||= []).push(m); return a; }, {});
  const mName = (k: string) => { const m = metrics.find((x) => x.key === k); return m ? (lang === "ar" && m.nameAr ? m.nameAr : m.name) : k; };

  return (
    <Card>
      <SectionTitle action={
        <span className="flex flex-wrap items-center gap-2">
          <Select value={cur?.id || ""} onChange={(v: string) => setCur(boards.find((b) => b.id === v) || null)}
            options={boards.map((b) => ({ value: b.id, label: (lang === "ar" && b.nameAr ? b.nameAr : b.name) + (b.isDefault ? " ★" : "") }))} />
          {w && <button onClick={() => setBuilding(!building)}
            className={`rounded-xl border px-2.5 py-1 text-xs font-medium ${building ? "border-amber-500/40 bg-amber-500/10 text-amber-700" : "border-paper-300 bg-white text-ink-700 hover:bg-paper-100"}`}>🧱 {tr("db_build")}</button>}
        </span>
      }>📊 {tr("db_title")}</SectionTitle>

      {building && w && cur && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-paper-100 px-2.5 py-2 text-xs">
          <button onClick={() => setAdding({ metricKey: "", viz: "KPI", lg: false })} className="btn-amber text-xs">+ {tr("db_addWidget")}</button>
          <button onClick={() => setNaming({ id: cur.id, name: cur.name, nameAr: cur.nameAr || "" })} className="btn-ghost text-xs">✏ {tr("db_rename")}</button>
          <button onClick={() => setNaming({ name: "", nameAr: "" })} className="btn-ghost text-xs">+ {tr("db_newBoard")}</button>
          {!cur.isDefault && <button onClick={removeBoard} className="text-clay-600 hover:underline">🗑 {tr("db_deleteBoard")}</button>}
          <span className="ms-auto text-[10px] text-ink-400">{tr("db_groundedNote")}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {widgets.map((wg, i) => (
          <div key={`${wg.metricKey}-${i}`} className={`relative ${wg.size === "lg" ? "sm:col-span-2" : ""}`}>
            <WidgetCard w={wg} metric={metrics.find((m) => m.key === wg.metricKey)} lang={lang} />
            {building && w && (
              <span className="absolute end-2 top-2 flex gap-1">
                <button onClick={() => move(i, -1)} className="rounded bg-paper-100 px-1 text-[10px] hover:bg-paper-200">↑</button>
                <button onClick={() => move(i, 1)} className="rounded bg-paper-100 px-1 text-[10px] hover:bg-paper-200">↓</button>
                <button onClick={() => saveWidgets(widgets.filter((_, k) => k !== i))} className="rounded bg-clay-500/10 px-1 text-[10px] text-clay-600 hover:bg-clay-500/20">✕</button>
              </span>
            )}
          </div>
        ))}
        {widgets.length === 0 && <p className="col-span-full text-xs text-ink-400">{tr("db_empty")}</p>}
      </div>

      <Modal open={!!adding} onClose={() => setAdding(null)} title={tr("db_addWidget")}
        footer={<><button onClick={() => setAdding(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={() => { if (adding?.metricKey) { saveWidgets([...widgets, { metricKey: adding.metricKey, viz: adding.viz, ...(adding.lg ? { size: "lg" as const } : {}) }]); setAdding(null); } }} className="btn-amber">{tr("db_add")}</button></>}>
        {adding && (
          <div className="space-y-3">
            <div>
              <span className="label">{tr("db_metric")}</span>
              <select className="input" value={adding.metricKey} onChange={(e) => setAdding({ ...adding, metricKey: e.target.value })}>
                <option value="">—</option>
                {Object.entries(byCat).map(([cat, ms]) => (
                  <optgroup key={cat} label={cat}>
                    {ms.map((m) => <option key={m.key} value={m.key}>{mName(m.key)}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><span className="label">{tr("db_viz")}</span>
                <Select value={adding.viz} onChange={(v: string) => setAdding({ ...adding, viz: v as "KPI" | "LINE" })}
                  options={[{ value: "KPI", label: tr("db_vizKpi") }, { value: "LINE", label: tr("db_vizLine") }]} /></div>
              <label className="flex items-end gap-2 pb-2 text-xs text-ink-700">
                <input type="checkbox" checked={adding.lg} onChange={(e) => setAdding({ ...adding, lg: e.target.checked })} /> {tr("db_wide")}
              </label>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!naming} onClose={() => setNaming(null)} title={naming?.id ? tr("db_rename") : tr("db_newBoard")}
        footer={<><button onClick={() => setNaming(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={saveBoard} className="btn-amber">{tr("save")}</button></>}>
        {naming && (
          <div className="grid grid-cols-2 gap-3">
            <input className="input" dir="auto" placeholder={tr("db_nameAr")} value={naming.nameAr} onChange={(e) => setNaming({ ...naming, nameAr: e.target.value })} />
            <input className="input" dir="ltr" placeholder="Name (EN)" value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} />
          </div>
        )}
      </Modal>
    </Card>
  );
}

import { useState } from "react";
import { useFetch, Card, SectionTitle } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useToast } from "../components/Toast";

// ═══ FORECASTING (Wave 3·F) ══════════════════════════════════════════
// The band is the point. A single projected number gets quoted as a
// promise, so nothing here renders one without its range.

interface Arrival {
  ok: boolean; refused?: boolean; finished?: boolean; reason?: string;
  metric?: string; metricAr?: string; target?: number; actual?: number; daysLeft?: number;
  projected?: { lo: number; mid: number; hi: number }; probability?: number;
  method?: string; observations?: number;
}
interface Scenario {
  ok: boolean; refused?: boolean; reason?: string;
  channels: { platform: string; spend: number; leads: number; costPerLead: number | null }[];
  moved: { from: string; to: string; amountUsd: number; leadsLost: number; leadsGained: number }[];
  projectedLeadChange: { lo: number; mid: number; hi: number };
  assumptions: string[];
}

export function TargetArrivals() {
  const { tr, lang } = useI18n();
  const { data } = useFetch<Arrival[]>("/forecast/targets");
  const rows = (data || []).filter((r) => r.metric);
  if (!rows.length) return null;

  return (
    <Card>
      <SectionTitle>📈 {tr("fc_title")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("fc_sub")}</p>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-ink-800">{lang === "ar" && r.metricAr ? r.metricAr : r.metric}</span>
              {r.ok && !r.finished && r.probability != null && (
                <span className={`kpi-num shrink-0 font-bold ${
                  r.probability >= 70 ? "text-moss-700" : r.probability >= 40 ? "text-amber-700" : "text-clay-700"}`} dir="ltr">
                  {r.probability}%
                </span>
              )}
            </div>

            {r.refused ? (
              <p className="mt-0.5 text-[11px] text-ink-400">{r.reason}</p>
            ) : r.finished ? (
              <p className="mt-0.5 text-[11px] text-ink-500" dir="ltr">
                {r.actual} / {r.target} · {tr("fc_done")}
              </p>
            ) : r.projected ? (
              <>
                {/* the band, drawn — because the width is the message */}
                <div className="relative mt-1 h-2 w-full rounded-full bg-paper-200">
                  {(() => {
                    const max = Math.max(r.projected.hi, r.target ?? 0) * 1.05 || 1;
                    const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
                    return (
                      <>
                        <div className="absolute inset-y-0 rounded-full bg-amber-500/30"
                          style={{ left: pct(r.projected.lo), width: `calc(${pct(r.projected.hi)} - ${pct(r.projected.lo)})` }} />
                        <div className="absolute inset-y-0 w-0.5 bg-amber-600" style={{ left: pct(r.projected.mid) }} />
                        <div className="absolute -inset-y-1 w-0.5 bg-ink-900" style={{ left: pct(r.target ?? 0) }} title={tr("fc_target")} />
                      </>
                    );
                  })()}
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-ink-400" dir="ltr">
                  <span>{r.projected.lo} – {r.projected.hi}</span>
                  <span>{tr("fc_target")}: {r.target} · {r.daysLeft}{tr("sy_d")}</span>
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-ink-400">{tr("fc_bandNote")}</p>
    </Card>
  );
}

export function BudgetScenario() {
  const { tr } = useI18n();
  const toast = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pct, setPct] = useState("20");
  const [res, setRes] = useState<Scenario | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: seed } = useFetch<Scenario>("/forecast/scenario-seed");

  const run = async () => {
    if (!from || !to || from === to) return;
    setBusy(true);
    try { setRes(await api.post<Scenario>("/forecast/scenario", { shifts: [{ from, to, pct: Number(pct) }] })); }
    catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  };

  const platforms = res?.channels?.map((c) => c.platform) || seed?.channels?.map((c) => c.platform) || ["META", "TIKTOK", "GOOGLE"];

  return (
    <Card>
      <SectionTitle>⚖ {tr("fc_scTitle")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("fc_scSub")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-32" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">{tr("fc_from")}</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="input w-32" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">{tr("fc_to")}</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input className="input w-24" type="number" dir="ltr" value={pct} onChange={(e) => setPct(e.target.value)} />
        <button onClick={run} disabled={busy || !from || !to} className="btn-amber">{busy ? "…" : tr("fc_run")}</button>
      </div>

      {res && (
        <div className="mt-3">
          {!res.ok ? (
            <p className="text-sm text-ink-500">{res.reason}</p>
          ) : (
            <>
              <div className="rounded-xl bg-paper-100 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("fc_effect")}</div>
                <div className="kpi-num mt-0.5 text-lg font-bold text-ink-900" dir="ltr">
                  {res.projectedLeadChange.lo > 0 ? "+" : ""}{res.projectedLeadChange.lo} … {res.projectedLeadChange.hi > 0 ? "+" : ""}{res.projectedLeadChange.hi}
                </div>
                <div className="text-[11px] text-ink-500">{tr("fc_leads")}</div>
              </div>
              <div className="mt-2 space-y-0.5">
                {res.channels.map((c) => (
                  <div key={c.platform} className="flex items-center justify-between text-[11px] text-ink-600">
                    <span dir="ltr">{c.platform}</span>
                    <span className="kpi-num" dir="ltr">
                      ${c.spend} · {c.costPerLead ? `$${c.costPerLead}/${tr("fc_lead")}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{tr("fc_assume")}</div>
                <ul className="mt-1 space-y-0.5">
                  {res.assumptions.map((a, i) => <li key={i} className="text-[11px] text-ink-600">· {a}</li>)}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

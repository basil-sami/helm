import { useState } from "react";
import { useFetch, Card, SectionTitle } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useToast } from "../components/Toast";

// ═══ MEDIA-MIX MODELLING (Wave 3·G) ══════════════════════════════════
// The readiness panel is the headline, not the model. A media-mix model
// that is available and wrong moves real budget — so what this screen
// mostly does is tell you honestly how far off a trustworthy one is.

interface Readiness {
  weeksCollected: number; weeksUsable: number; weeksNeeded: number; shortBy: number;
  aboveFloor: boolean; readinessPct: number; estimatedReady: string | null;
  avgCompleteness: number; note: string;
  channels: { platform: string; weeks: number; meanSpend: number; cv: number; usable: boolean }[];
}
interface Contribution {
  platform: string; coefficient: number; contribution: number; sharePct: number;
  spendUsd: number; saturationPoint: number; costPerOutcome: number | null; inseparable: boolean;
  roi?: { lo: number; hi: number } | null; signalShare?: number | null;
}
interface Fit {
  ok: boolean; refused?: boolean; reason?: string; directional?: boolean; caveat?: string | null;
  contributions?: Contribution[];
  diagnostics?: { r2: number; holdoutMape: number | null; naiveMape?: number | null; skill?: boolean;
                  weeks: number; avgCompleteness: number; optimiserNote?: string | null;
                  collinear: { a: string; b: string; corr: number }[]; adstockDecay: number };
  optimiser?: {
    // legacy (pre-Stage-2 runs)
    suggestion?: { from: string; to: string; amountUsd: number };
    // W3·G2 curve optimiser
    kind?: string; cap?: number; horizonWeeks?: number; budgetWeeklyUsd?: number;
    channels?: { platform: string; currentWeeklyUsd: number; proposedWeeklyUsd: number; deltaPct: number }[];
    projectedGain: { lo: number; mid: number; hi: number };
    projectedGainHorizon?: { lo: number; mid: number; hi: number };
    assumptions: string[];
  } | null;
}

export default function MediaMix() {
  const { tr } = useI18n();
  const toast = useToast();
  const { data: ready, reload } = useFetch<Readiness>("/mmm/readiness");
  const [fit, setFit] = useState<Fit | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;

  const act = async (path: string) => {
    setBusy(true);
    try {
      if (path === "panel") { await api.post("/mmm/panel", {}); reload(); toast.push(tr("mm_rebuilt"), "success"); }
      else setFit(await api.post<Fit>("/mmm/fit", {}));
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle>🎚 {tr("mm_title")}</SectionTitle>
          <p className="-mt-1 text-sm text-ink-500">{tr("mm_sub")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => act("panel")} disabled={busy} className="btn-ghost text-xs">⟳ {tr("mm_rebuild")}</button>
          <button onClick={() => act("fit")} disabled={busy} className="btn-ghost text-xs">{busy ? "…" : `✦ ${tr("mm_run")}`}</button>
        </div>
      </div>

      {/* readiness — the honest headline */}
      <div className="mt-3 rounded-xl border border-paper-200 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-ink-600">{tr("mm_readiness")}</span>
          <span className="kpi-num font-bold text-ink-900" dir="ltr">
            {ready.weeksUsable} / {ready.weeksNeeded} {tr("mm_weeks")}
          </span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-paper-200">
          <div className={`h-full rounded-full ${ready.aboveFloor ? "bg-moss-500" : "bg-amber-500"}`}
            style={{ width: `${Math.min(100, ready.readinessPct)}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-ink-600">{ready.note}</p>
        {!ready.aboveFloor && ready.estimatedReady && (
          <p className="mt-0.5 text-[11px] text-ink-400" dir="ltr">
            {tr("mm_eta")}: {ready.estimatedReady}
          </p>
        )}
        <div className="mt-2 space-y-0.5">
          {ready.channels.map((c) => (
            <div key={c.platform} className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${c.usable ? "bg-moss-500" : "bg-ink-300"}`} />
                <span className="text-ink-600" dir="ltr">{c.platform}</span>
                {!c.usable && <span className="text-[10px] text-ink-400">{tr("mm_flat")}</span>}
              </span>
              <span className="kpi-num text-[10px] text-ink-400" dir="ltr">
                ${c.meanSpend}/{tr("mm_wk")} · cv {c.cv}
              </span>
            </div>
          ))}
        </div>
      </div>

      {fit && (
        <div className="mt-3">
          {!fit.ok ? (
            <p className="text-sm text-ink-500">{fit.reason}</p>
          ) : (
            <>
              {fit.caveat && (
                <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{tr("mm_directional")}</div>
                  <p className="mt-0.5 text-[11px] text-ink-700">{fit.caveat}</p>
                </div>
              )}

              <div className="space-y-1.5">
                {fit.contributions!.map((c) => (
                  <div key={c.platform} className="rounded-xl bg-paper-100 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2">
                        <span className="text-ink-800" dir="ltr">{c.platform}</span>
                        {c.inseparable && (
                          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700"
                            title={tr("mm_inseparableHint")}>{tr("mm_inseparable")}</span>
                        )}
                      </span>
                      <span className="kpi-num text-ink-600" dir="ltr">{c.sharePct}%</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-3 text-[10px] text-ink-400" dir="ltr">
                      <span>${c.spendUsd}</span>
                      <span title={tr("mm_satHint")}>{tr("mm_sat")} ≈ ${c.saturationPoint}</span>
                      {c.costPerOutcome != null
                        ? <span>${c.costPerOutcome} / {tr("fc_lead")}</span>
                        : <span className="text-ink-300">{tr("mm_noRoi")}</span>}
                      {c.roi
                        ? <span className="font-medium text-moss-700">${c.roi.lo}–${c.roi.hi}</span>
                        : c.signalShare != null && !c.inseparable && (
                            <span className="text-ink-300" title={tr("mm_unstableHint")}>
                              {tr("mm_unstable")} · {Math.round(c.signalShare * 100)}%
                            </span>
                          )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-ink-500" dir="ltr">
                <span>R² {fit.diagnostics!.r2}</span>
                {fit.diagnostics!.holdoutMape != null && <span>holdout {fit.diagnostics!.holdoutMape}%</span>}
                {fit.diagnostics!.naiveMape != null && <span>naive {fit.diagnostics!.naiveMape}%</span>}
                {fit.diagnostics!.skill != null && (
                  <span className={fit.diagnostics!.skill ? "font-medium text-moss-700" : "text-clay-600"}>
                    {fit.diagnostics!.skill ? `✓ ${tr("mm_skillPass")}` : `✕ ${tr("mm_skillFail")}`}
                  </span>
                )}
                <span>{fit.diagnostics!.weeks} {tr("mm_weeks")}</span>
                <span>adstock {fit.diagnostics!.adstockDecay}</span>
              </div>
              {!fit.optimiser && fit.diagnostics?.optimiserNote && (
                <p className="mt-1.5 text-[11px] text-ink-500">{fit.diagnostics.optimiserNote}</p>
              )}

              {fit.optimiser && (
                <div className="mt-2 rounded-xl border border-moss-300 bg-moss-50/40 p-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-moss-700">{tr("mm_suggest")}</div>
                  {fit.optimiser.kind === "curve" ? (
                    <>
                      <div className="mt-1 space-y-0.5">
                        {fit.optimiser.channels!.map((ch) => (
                          <div key={ch.platform} className="flex items-center justify-between text-[11px]" dir="ltr">
                            <span className="text-ink-700">{ch.platform}</span>
                            <span className="kpi-num text-ink-600">
                              ${ch.currentWeeklyUsd} → ${ch.proposedWeeklyUsd}
                              <span className={`ms-1.5 ${ch.deltaPct >= 0 ? "text-moss-700" : "text-clay-600"}`}>
                                {ch.deltaPct >= 0 ? "+" : ""}{ch.deltaPct}%
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="kpi-num mt-1 text-[11px] text-ink-700" dir="ltr">
                        +{fit.optimiser.projectedGain.lo} … +{fit.optimiser.projectedGain.mid} … +{fit.optimiser.projectedGain.hi} / {tr("mm_wk")}
                        {fit.optimiser.projectedGainHorizon && (
                          <span className="ms-2 text-ink-500">
                            (+{fit.optimiser.projectedGainHorizon.lo} … +{fit.optimiser.projectedGainHorizon.hi} · {fit.optimiser.horizonWeeks} {tr("mm_weeks")})
                          </span>
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-0.5 text-xs text-ink-800" dir="ltr">
                        {fit.optimiser.suggestion!.from} → {fit.optimiser.suggestion!.to}: ${fit.optimiser.suggestion!.amountUsd}
                      </p>
                      <p className="kpi-num text-[11px] text-ink-600" dir="ltr">
                        +{fit.optimiser.projectedGain.lo} … +{fit.optimiser.projectedGain.hi}
                      </p>
                    </>
                  )}
                  <ul className="mt-1 space-y-0.5">
                    {fit.optimiser.assumptions.map((a, i) => <li key={i} className="text-[10px] text-ink-500">· {a}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

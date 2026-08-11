import { useState } from "react";
import { useFetch, Card, Modal, SkeletonCards } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { safeNum } from "../lib/format";

// ═══ MEDIA PLANS — الإعلان الخارجي: billboards that report back ══════

interface Plan { id: string; name: string; nameAr?: string; period?: string; channel: string; budgetUsd: number; campaignId?: string; placementCount: number; spentUsd: number; scans: number }
interface Placement { id: string; label: string; location?: string; startDate?: string; endDate?: string; costUsd: number; linkCode?: string; scans?: number }
interface Campaign { id: string; name: string }

const CH_ICON: Record<string, string> = { BILLBOARD: "🛣️", RADIO: "📻", PRINT: "📰", TV: "📺", OTHER: "📍" };

export default function MediaPlans() {
  const { tr, lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const w = can("media");
  const plans = useFetch<Plan[]>("/media-plans");
  const campaigns = useFetch<Campaign[]>("/campaigns");
  const [open, setOpen] = useState<Plan | null>(null);
  const [pls, setPls] = useState<Placement[] | null>(null);
  const [planM, setPlanM] = useState<Partial<Plan> | null>(null);
  const [plM, setPlM] = useState(false);
  const [plForm, setPlForm] = useState({ label: "", location: "", costUsd: "", targetUrl: "" });
  const [qr, setQr] = useState<{ dataUrl: string; url: string; code: string; label: string } | null>(null);

  const loadPlacements = async (p: Plan) => {
    setOpen(p); setPls(null);
    setPls(await api.get<Placement[]>(`/media-plans/${p.id}/placements`));
  };

  const showQr = async (m: Placement) => {
    try {
      const d = await api.get<{ dataUrl: string; url: string; code: string }>(`/media-plans/placements/${m.id}/qr`);
      setQr({ ...d, label: m.label });
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-900">{tr("mp_title")}</h1>
          <p className="text-sm text-ink-500">{tr("mp_sub")}</p>
        </div>
        {w && <button onClick={() => setPlanM({ channel: "BILLBOARD", budgetUsd: 0 })} className="btn-amber">+ {tr("mp_add")}</button>}
      </div>

      {plans.loading ? <SkeletonCards count={3} /> : !plans.data?.length ? (
        <Card className="p-8 text-center"><p className="text-sm font-medium text-ink-700">{tr("mp_none")}</p><p className="mt-1 text-xs text-ink-400">{tr("mp_noneHint")}</p></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {plans.data.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="cursor-pointer" onClick={() => loadPlacements(p)}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-ink-900">{CH_ICON[p.channel]} {lang === "ar" && p.nameAr ? p.nameAr : p.name}</div>
                    <div className="mt-0.5 text-xs text-ink-500">{tr(`mp_ch_${p.channel}`)}{p.period ? ` · ${p.period}` : ""}</div>
                  </div>
                  <span className="kpi-num rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-700" dir="ltr">📱 {p.scans}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-ink-500">
                  <div><div className="kpi-num text-sm font-bold text-ink-900" dir="ltr">{p.placementCount}</div>{tr("mp_placements")}</div>
                  <div><div className="kpi-num text-sm font-bold text-ink-900" dir="ltr">${safeNum(p.spentUsd).toLocaleString()}</div>{tr("mp_spent")}</div>
                  <div><div className="kpi-num text-sm font-bold text-ink-900" dir="ltr">${safeNum(p.budgetUsd).toLocaleString()}</div>{tr("mp_budget")}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── placements drawer ── */}
      {open && (
        <Modal open title={`${CH_ICON[open.channel]} ${lang === "ar" && open.nameAr ? open.nameAr : open.name}`} onClose={() => { setOpen(null); setPls(null); }}>
          <div className="space-y-3">
            {w && (
              <button onClick={() => { setPlForm({ label: "", location: "", costUsd: "", targetUrl: "" }); setPlM(true); }}
                className="btn-amber w-full">+ {tr("mp_addPlacement")}</button>
            )}
            {!pls ? <SkeletonCards count={2} /> : !pls.length ? <p className="py-4 text-center text-sm text-ink-400">{tr("mp_noPl")}</p> : (
              <div className="space-y-2">
                {pls.map((m) => (
                  <div key={m.id} className="rounded-xl border border-paper-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-ink-900">{m.label}</div>
                        <div className="mt-0.5 text-[11px] text-ink-500">{m.location || "—"} · <span className="kpi-num" dir="ltr">${safeNum(m.costUsd).toLocaleString()}</span></div>
                      </div>
                      <span className="kpi-num shrink-0 rounded-full bg-paper-200 px-2 py-0.5 text-[11px] text-ink-600" dir="ltr">📱 {m.scans || 0}</span>
                    </div>
                    <div className="mt-2 flex gap-2 text-[11px]">
                      <button onClick={() => showQr(m)} className="rounded-lg bg-ink-900 px-2.5 py-1 font-medium text-paper-50">⬛ {tr("mp_qr")}</button>
                      <code className="kpi-num rounded bg-paper-200 px-2 py-1 text-ink-500" dir="ltr">/r/{m.linkCode}</code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── QR display ── */}
      {qr && (
        <Modal open title={qr.label} onClose={() => setQr(null)}>
          <div className="space-y-3 text-center">
            <img src={qr.dataUrl} alt="QR" className="mx-auto w-56 rounded-2xl border border-paper-200 p-2" />
            <code className="kpi-num block text-xs text-ink-500" dir="ltr">{qr.url}</code>
            <p className="text-[11px] text-ink-400">{tr("mp_qrHint")}</p>
            <a href={qr.dataUrl} download={`qr-${qr.code}.png`} className="btn-amber inline-block">⬇ {tr("mp_download")}</a>
          </div>
        </Modal>
      )}

      {/* ── new plan ── */}
      {planM && (
        <Modal open title={tr("mp_add")} onClose={() => setPlanM(null)}>
          <div className="space-y-3">
            <input className="input" placeholder={tr("mp_name")} value={planM.name || ""} onChange={(e) => setPlanM({ ...planM, name: e.target.value })} />
            <input className="input" placeholder={tr("mp_nameAr")} value={planM.nameAr || ""} onChange={(e) => setPlanM({ ...planM, nameAr: e.target.value })} dir="rtl" />
            <div className="grid grid-cols-2 gap-3">
              <select className="input" value={planM.channel} onChange={(e) => setPlanM({ ...planM, channel: e.target.value })}>
                {Object.keys(CH_ICON).map((c) => <option key={c} value={c}>{CH_ICON[c]} {tr(`mp_ch_${c}`)}</option>)}
              </select>
              <input className="input" placeholder={tr("mp_period")} value={planM.period || ""} onChange={(e) => setPlanM({ ...planM, period: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input className="input kpi-num" type="number" placeholder={tr("mp_budget")} value={planM.budgetUsd ?? ""} onChange={(e) => setPlanM({ ...planM, budgetUsd: Number(e.target.value) })} dir="ltr" />
              <select className="input" value={planM.campaignId || ""} onChange={(e) => setPlanM({ ...planM, campaignId: e.target.value || undefined })}>
                <option value="">{tr("gr_noCampaign")}</option>
                {(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button className="btn-amber w-full" disabled={!planM.name}
              onClick={async () => {
                try { await api.post("/media-plans", planM); setPlanM(null); plans.reload(); toast.push(tr("saved"), "success"); }
                catch (e) { toast.push((e as Error).message, "error"); }
              }}>{tr("save")}</button>
          </div>
        </Modal>
      )}

      {/* ── new placement ── */}
      {plM && open && (
        <Modal open title={tr("mp_addPlacement")} onClose={() => setPlM(false)}>
          <div className="space-y-3">
            <input className="input" placeholder={tr("mp_plLabel")} value={plForm.label} onChange={(e) => setPlForm({ ...plForm, label: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <input className="input" placeholder={tr("mp_plLoc")} value={plForm.location} onChange={(e) => setPlForm({ ...plForm, location: e.target.value })} />
              <input className="input kpi-num" type="number" placeholder={tr("mp_cost")} value={plForm.costUsd} onChange={(e) => setPlForm({ ...plForm, costUsd: e.target.value })} dir="ltr" />
            </div>
            <input className="input" placeholder="https://example.com/offer" value={plForm.targetUrl} onChange={(e) => setPlForm({ ...plForm, targetUrl: e.target.value })} dir="ltr" />
            <p className="text-[11px] text-ink-400">{tr("mp_plExplain")}</p>
            <button className="btn-amber w-full" disabled={!plForm.label || !plForm.targetUrl}
              onClick={async () => {
                try {
                  await api.post(`/media-plans/${open.id}/placements`, { ...plForm, costUsd: Number(plForm.costUsd) || 0 });
                  setPlM(false); loadPlacements(open); plans.reload(); toast.push(tr("mp_minted"), "success");
                } catch (e) { toast.push((e as Error).message, "error"); }
              }}>{tr("mp_mint")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

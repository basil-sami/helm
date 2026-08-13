import { useMemo, useState } from "react";
import { useFetch, Card, Modal, SkeletonCards } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";

// ═══ GROWTH — النمو: offers, word-of-mouth, channel, paid ════════════

interface Promo { id: string; name: string; nameAr?: string; code: string; kind: string; redemptions: number; active: boolean; startsAt?: string; endsAt?: string }
interface Referral { id: string; code: string; referrerCompany: string; referredCompany?: string; referredStage?: string; rewardState: string; clicks?: number; referredLeadId?: string }
interface Partner { id: string; name: string; nameAr?: string; kind: string; region?: string; coopBudgetUsd: number; campaignCount: number; active: boolean }
interface Spend { id: string; platform: string; campaignName?: string; campaignId?: string; date: string; amountUsd: number; impressions?: number; clicks?: number; source?: string; campaignRef?: string }
interface Customer { id: string; company: string }
interface Campaign { id: string; name: string }
interface Lead { id: string; company: string }

const REWARD_TONE: Record<string, string> = { PENDING: "bg-paper-200 text-ink-500", EARNED: "bg-amber-500/15 text-amber-700", PAID: "bg-moss-100 text-moss-700" };
const PLATFORMS = ["META", "TIKTOK", "GOOGLE", "OTHER"];

export default function Growth() {
  const { tr, lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const w = can("planning");
  const [tab, setTab] = useState<"promos" | "refs" | "partners" | "spend">("promos");

  const promos = useFetch<Promo[]>("/promotions");
  const refs = useFetch<Referral[]>("/referrals");
  const partners = useFetch<Partner[]>("/partners");
  const spend = useFetch<Spend[]>("/ad-spend");
  const customers = useFetch<Customer[]>("/customers");
  const campaigns = useFetch<Campaign[]>("/campaigns");
  const leads = useFetch<Lead[]>("/leads");

  const [promoM, setPromoM] = useState<Partial<Promo> | null>(null);
  const [refM, setRefM] = useState(false);
  const [refForm, setRefForm] = useState({ referrerCustomerId: "", targetUrl: "" });
  const [attach, setAttach] = useState<Referral | null>(null);
  const [partnerM, setPartnerM] = useState<Partial<Partner> | null>(null);
  const [linkM, setLinkM] = useState<Partner | null>(null);
  const [linkForm, setLinkForm] = useState({ campaignId: "", sharePct: 50 });
  const [spendM, setSpendM] = useState(false);
  const [spendForm, setSpendForm] = useState({ platform: "META", campaignId: "", amountUsd: "", impressions: "", clicks: "" });

  const spendTotal = useMemo(() => (spend.data || []).reduce((a, s) => a + Number(s.amountUsd), 0), [spend.data]);

  const savePromo = async () => {
    if (!promoM?.name || !promoM.code) return;
    try {
      if (promoM.id) await api.patch(`/promotions/${promoM.id}`, promoM);
      else await api.post("/promotions", promoM);
      setPromoM(null); promos.reload(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  const TABS = [
    ["promos", tr("gr_promos"), promos.data?.length],
    ["refs", tr("gr_refs"), refs.data?.length],
    ["partners", tr("gr_partners"), partners.data?.length],
    ["spend", tr("gr_spend"), spend.data?.length],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-900">{tr("gr_title")}</h1>
          <p className="text-sm text-ink-500">{tr("gr_sub")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-2xl bg-paper-200 p-1">
        {TABS.map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-xl px-3.5 py-1.5 text-sm font-medium transition ${tab === k ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"}`}>
            {label}{typeof n === "number" ? <span className="kpi-num ms-1.5 text-[10px] text-ink-400">{n}</span> : null}
          </button>
        ))}
      </div>

      {/* ── PROMOTIONS ── */}
      {tab === "promos" && (promos.loading ? <SkeletonCards count={3} /> : (
        <div className="space-y-3">
          {w && <button onClick={() => setPromoM({ kind: "DISCOUNT", active: true })} className="btn-amber">+ {tr("gr_addPromo")}</button>}
          {!promos.data?.length ? <Card className="p-8 text-center"><p className="text-sm text-ink-500">{tr("gr_noPromos")}</p></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {promos.data.map((p) => (
                <Card key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-ink-900">{lang === "ar" && p.nameAr ? p.nameAr : p.name}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
                        <code className="kpi-num rounded bg-paper-200 px-1.5 py-0.5 font-bold text-ink-700" dir="ltr">{p.code}</code>
                        <span>{tr(`gr_kind_${p.kind}`)}</span>
                        {!p.active && <span className="rounded-full bg-paper-200 px-2 py-0.5">{tr("gr_inactive")}</span>}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="kpi-num text-xl font-bold text-amber-700" dir="ltr">{p.redemptions}</div>
                      <div className="text-[10px] text-ink-400">{tr("gr_redemptions")}</div>
                    </div>
                  </div>
                  {w && (
                    <div className="mt-3 flex gap-2 text-xs">
                      <button onClick={async () => { try { await api.post(`/promotions/${p.id}/redeem`, {}); promos.reload(); } catch (e) { toast.push((e as Error).message, "error"); } }}
                        className="rounded-lg bg-amber-500/15 px-2.5 py-1 font-medium text-amber-700 hover:bg-amber-500/25" disabled={!p.active}>✓ {tr("gr_redeem")}</button>
                      <button onClick={() => setPromoM(p)} className="rounded-lg bg-paper-200 px-2.5 py-1 text-ink-600 hover:bg-paper-300">{tr("edit")}</button>
                      <button onClick={async () => { await api.patch(`/promotions/${p.id}`, { active: !p.active }); promos.reload(); }}
                        className="rounded-lg bg-paper-200 px-2.5 py-1 text-ink-600 hover:bg-paper-300">{p.active ? tr("gr_deactivate") : tr("gr_activate")}</button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* ── REFERRALS ── */}
      {tab === "refs" && (refs.loading ? <SkeletonCards count={3} /> : (
        <div className="space-y-3">
          {w && <button onClick={() => { setRefForm({ referrerCustomerId: "", targetUrl: "" }); setRefM(true); }} className="btn-amber">+ {tr("gr_addRef")}</button>}
          {!refs.data?.length ? <Card className="p-8 text-center"><p className="text-sm font-medium text-ink-700">{tr("gr_noRefs")}</p><p className="mt-1 text-xs text-ink-400">{tr("gr_refsHint")}</p></Card> : (
            <Card className="divide-y divide-paper-200 p-0">
              {refs.data.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink-900">{r.referrerCompany}
                      <span className="mx-1.5 text-ink-300">←</span>
                      <span className={r.referredCompany ? "text-ink-700" : "text-ink-400"}>{r.referredCompany || tr("gr_noLeadYet")}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-500">
                      <code className="kpi-num rounded bg-paper-200 px-1.5 py-0.5" dir="ltr">/r/{r.code}</code>
                      <span dir="ltr">👆 {r.clicks || 0}</span>
                      {r.referredStage && <span className="rounded-full bg-paper-200 px-2 py-0.5">{tr(`stage_${r.referredStage}`)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${REWARD_TONE[r.rewardState]}`}>{tr(`gr_rw_${r.rewardState}`)}</span>
                    {w && !r.referredLeadId && <button onClick={() => setAttach(r)} className="rounded-lg bg-paper-200 px-2 py-1 text-[11px] text-ink-600 hover:bg-paper-300">{tr("gr_attach")}</button>}
                    {w && r.rewardState === "EARNED" && (
                      <button onClick={async () => { await api.patch(`/referrals/${r.id}`, { rewardState: "PAID" }); refs.reload(); toast.push(tr("gr_paidOk"), "success"); }}
                        className="rounded-lg bg-moss-100 px-2 py-1 text-[11px] font-medium text-moss-700">💸 {tr("gr_markPaid")}</button>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      ))}

      {/* ── PARTNERS ── */}
      {tab === "partners" && (partners.loading ? <SkeletonCards count={3} /> : (
        <div className="space-y-3">
          {w && <button onClick={() => setPartnerM({ kind: "DISTRIBUTOR", active: true, coopBudgetUsd: 0 })} className="btn-amber">+ {tr("gr_addPartner")}</button>}
          {!partners.data?.length ? <Card className="p-8 text-center"><p className="text-sm text-ink-500">{tr("gr_noPartners")}</p></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {partners.data.map((p) => (
                <Card key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-ink-900">{lang === "ar" && p.nameAr ? p.nameAr : p.name}</div>
                      <div className="mt-0.5 text-xs text-ink-500">{tr(`gr_pk_${p.kind}`)}{p.region ? ` · ${p.region}` : ""}</div>
                    </div>
                    <span className="kpi-num rounded-full bg-paper-200 px-2.5 py-1 text-[11px] text-ink-600" dir="ltr">{p.campaignCount} 🔗</span>
                  </div>
                  <div className="mt-2 text-xs text-ink-500">{tr("gr_coop")}: <span className="kpi-num text-ink-700" dir="ltr">${Number(p.coopBudgetUsd).toLocaleString()}</span></div>
                  {w && (
                    <div className="mt-3 flex gap-2 text-xs">
                      <button onClick={() => { setLinkForm({ campaignId: "", sharePct: 50 }); setLinkM(p); }} className="rounded-lg bg-amber-500/15 px-2.5 py-1 font-medium text-amber-700">🔗 {tr("gr_linkCampaign")}</button>
                      <button onClick={() => setPartnerM(p)} className="rounded-lg bg-paper-200 px-2.5 py-1 text-ink-600 hover:bg-paper-300">{tr("edit")}</button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* ── AD SPEND ── */}
      {tab === "spend" && (spend.loading ? <SkeletonCards count={3} /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {w && <button onClick={() => { setSpendForm({ platform: "META", campaignId: "", amountUsd: "", impressions: "", clicks: "" }); setSpendM(true); }} className="btn-amber">+ {tr("gr_addSpend")}</button>}
            <div className="text-sm text-ink-500">{tr("gr_total")}: <span className="kpi-num font-bold text-ink-900" dir="ltr">${spendTotal.toLocaleString()}</span></div>
          </div>
          {!spend.data?.length ? <Card className="p-8 text-center"><p className="text-sm font-medium text-ink-700">{tr("gr_noSpend")}</p><p className="mt-1 text-xs text-ink-400">{tr("gr_spendHint")}</p></Card> : (
            <Card className="divide-y divide-paper-200 p-0">
              {spend.data.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2.5">
                    <span className="kpi-num rounded-lg bg-paper-200 px-2 py-1 text-[11px] font-bold text-ink-700">{s.platform}</span>
                    <span className="text-ink-700">{s.campaignName || (s.campaignRef
                      ? <span className="text-amber-700" title={tr("gr_unmapped")}>{s.campaignRef} ⚠</span>
                      : tr("gr_noCampaign"))}</span>
                    {s.source === "SYNC" && <span className="rounded-full bg-moss-100 px-1.5 py-0.5 text-[10px] font-bold text-moss-700">SYNC</span>}
                    <span className="kpi-num text-[11px] text-ink-400" dir="ltr">{s.date?.slice(0, 10)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-ink-500" dir="ltr">
                    {s.impressions ? <span>👁 {Number(s.impressions).toLocaleString()}</span> : null}
                    {s.clicks ? <span>👆 {Number(s.clicks).toLocaleString()}</span> : null}
                    <span className="kpi-num text-sm font-bold text-ink-900">${Number(s.amountUsd).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </Card>
          )}
          <p className="text-[11px] text-ink-400">{tr("gr_romiNote")}</p>
        </div>
      ))}

      {/* ── modals ── */}
      {promoM && (
        <Modal open title={promoM.id ? tr("gr_editPromo") : tr("gr_addPromo")} onClose={() => setPromoM(null)}>
          <div className="space-y-3">
            <input className="input" placeholder={tr("gr_pName")} value={promoM.name || ""} onChange={(e) => setPromoM({ ...promoM, name: e.target.value })} />
            <input className="input" placeholder={tr("gr_pNameAr")} value={promoM.nameAr || ""} onChange={(e) => setPromoM({ ...promoM, nameAr: e.target.value })} dir="rtl" />
            <div className="grid grid-cols-2 gap-3">
              <input className="input kpi-num" placeholder="EID25" value={promoM.code || ""} onChange={(e) => setPromoM({ ...promoM, code: e.target.value.toUpperCase() })} dir="ltr" />
              <select className="input" value={promoM.kind} onChange={(e) => setPromoM({ ...promoM, kind: e.target.value })}>
                {["DISCOUNT", "OFFER", "BUNDLE"].map((k) => <option key={k} value={k}>{tr(`gr_kind_${k}`)}</option>)}
              </select>
            </div>
            <button onClick={savePromo} className="btn-amber w-full">{tr("save")}</button>
          </div>
        </Modal>
      )}

      {refM && (
        <Modal open title={tr("gr_addRef")} onClose={() => setRefM(false)}>
          <div className="space-y-3">
            <select className="input" value={refForm.referrerCustomerId} onChange={(e) => setRefForm({ ...refForm, referrerCustomerId: e.target.value })}>
              <option value="">{tr("gr_pickCustomer")}</option>
              {(customers.data || []).map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
            </select>
            <input className="input" placeholder="https://example.com/offer" value={refForm.targetUrl} onChange={(e) => setRefForm({ ...refForm, targetUrl: e.target.value })} dir="ltr" />
            <p className="text-[11px] text-ink-400">{tr("gr_refExplain")}</p>
            <button className="btn-amber w-full" disabled={!refForm.referrerCustomerId || !refForm.targetUrl}
              onClick={async () => { try { await api.post("/referrals", refForm); setRefM(false); refs.reload(); toast.push(tr("gr_refMinted"), "success"); } catch (e) { toast.push((e as Error).message, "error"); } }}>
              {tr("gr_mint")}
            </button>
          </div>
        </Modal>
      )}

      {attach && (
        <Modal open title={`${tr("gr_attach")} — ${attach.referrerCompany}`} onClose={() => setAttach(null)}>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {(leads.data || []).map((l) => (
              <button key={l.id} className="block w-full rounded-lg px-3 py-2 text-start text-sm text-ink-700 hover:bg-paper-200"
                onClick={async () => { await api.patch(`/referrals/${attach.id}`, { referredLeadId: l.id }); setAttach(null); refs.reload(); toast.push(tr("saved"), "success"); }}>
                {l.company}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {partnerM && (
        <Modal open title={partnerM.id ? tr("edit") : tr("gr_addPartner")} onClose={() => setPartnerM(null)}>
          <div className="space-y-3">
            <input className="input" placeholder={tr("gr_pnName")} value={partnerM.name || ""} onChange={(e) => setPartnerM({ ...partnerM, name: e.target.value })} />
            <input className="input" placeholder={tr("gr_pnNameAr")} value={partnerM.nameAr || ""} onChange={(e) => setPartnerM({ ...partnerM, nameAr: e.target.value })} dir="rtl" />
            <div className="grid grid-cols-2 gap-3">
              <select className="input" value={partnerM.kind} onChange={(e) => setPartnerM({ ...partnerM, kind: e.target.value })}>
                {["DISTRIBUTOR", "RESELLER", "ALLIANCE"].map((k) => <option key={k} value={k}>{tr(`gr_pk_${k}`)}</option>)}
              </select>
              <input className="input" placeholder={tr("gr_region")} value={partnerM.region || ""} onChange={(e) => setPartnerM({ ...partnerM, region: e.target.value })} />
            </div>
            <input className="input kpi-num" type="number" placeholder={tr("gr_coop")} value={partnerM.coopBudgetUsd ?? ""} onChange={(e) => setPartnerM({ ...partnerM, coopBudgetUsd: Number(e.target.value) })} dir="ltr" />
            <button className="btn-amber w-full" disabled={!partnerM.name}
              onClick={async () => {
                try {
                  if (partnerM.id) await api.patch(`/partners/${partnerM.id}`, partnerM);
                  else await api.post("/partners", partnerM);
                  setPartnerM(null); partners.reload(); toast.push(tr("saved"), "success");
                } catch (e) { toast.push((e as Error).message, "error"); }
              }}>{tr("save")}</button>
          </div>
        </Modal>
      )}

      {linkM && (
        <Modal open title={`🔗 ${linkM.name}`} onClose={() => setLinkM(null)}>
          <div className="space-y-3">
            <select className="input" value={linkForm.campaignId} onChange={(e) => setLinkForm({ ...linkForm, campaignId: e.target.value })}>
              <option value="">{tr("gr_pickCampaign")}</option>
              {(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="block text-xs text-ink-500">{tr("gr_share")}: <span className="kpi-num">{linkForm.sharePct}%</span>
              <input type="range" min={0} max={100} step={5} value={linkForm.sharePct} onChange={(e) => setLinkForm({ ...linkForm, sharePct: Number(e.target.value) })} className="mt-1 w-full accent-amber-500" />
            </label>
            <button className="btn-amber w-full" disabled={!linkForm.campaignId}
              onClick={async () => { try { await api.post(`/partners/${linkM.id}/campaigns`, linkForm); setLinkM(null); partners.reload(); toast.push(tr("saved"), "success"); } catch (e) { toast.push((e as Error).message, "error"); } }}>
              {tr("gr_linkCampaign")}
            </button>
          </div>
        </Modal>
      )}

      {spendM && (
        <Modal open title={tr("gr_addSpend")} onClose={() => setSpendM(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <select className="input" value={spendForm.platform} onChange={(e) => setSpendForm({ ...spendForm, platform: e.target.value })}>
                {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
              </select>
              <select className="input" value={spendForm.campaignId} onChange={(e) => setSpendForm({ ...spendForm, campaignId: e.target.value })}>
                <option value="">{tr("gr_noCampaign")}</option>
                {(campaigns.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <input className="input kpi-num" type="number" placeholder={tr("gr_amount")} value={spendForm.amountUsd} onChange={(e) => setSpendForm({ ...spendForm, amountUsd: e.target.value })} dir="ltr" />
            <div className="grid grid-cols-2 gap-3">
              <input className="input kpi-num" type="number" placeholder={tr("gr_impressions")} value={spendForm.impressions} onChange={(e) => setSpendForm({ ...spendForm, impressions: e.target.value })} dir="ltr" />
              <input className="input kpi-num" type="number" placeholder={tr("gr_clicks")} value={spendForm.clicks} onChange={(e) => setSpendForm({ ...spendForm, clicks: e.target.value })} dir="ltr" />
            </div>
            <button className="btn-amber w-full" disabled={!spendForm.amountUsd}
              onClick={async () => {
                try {
                  await api.post("/ad-spend", { ...spendForm, amountUsd: Number(spendForm.amountUsd), impressions: spendForm.impressions ? Number(spendForm.impressions) : undefined, clicks: spendForm.clicks ? Number(spendForm.clicks) : undefined, campaignId: spendForm.campaignId || undefined });
                  setSpendM(false); spend.reload(); toast.push(tr("gr_spendOk"), "success");
                } catch (e) { toast.push((e as Error).message, "error"); }
              }}>{tr("save")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

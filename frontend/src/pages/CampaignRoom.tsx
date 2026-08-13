import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, Empty, SectionTitle, StatusPill } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { fmtDate, fmtMoney, fmtNum } from "../lib/format";

interface Room {
  campaign: { id: string; name: string; nameAr?: string; status: string; objective?: string; ownerName?: string; departmentName?: string; retro?: string; retroAr?: string };
  brief?: { objective?: string; kpiMetric?: string; kpiTarget?: number; learnings?: string } | null;
  items: { table: string; label: string; labelAr?: string; count: number; items: { id: string; title?: string; status?: string }[] }[];
  spend: { budgetUsd: number; spentUsd: number; remainingUsd: number; pacePct: number | null };
  results: { leads: number; won: number; lost: number; wonValueUsd: number; lostReasons: { d: string; v: number }[] };
  kpis: { cplUsd: number | null; roiPct: number | null; itemCount: number };
  allowedTransitions: string[];
  timeline: { startDate?: string; endDate?: string; closedAt?: string };
}
interface Picker { id: string; name: string; nameAr?: string; status: string }
interface LinkKind { table: string; label: string; labelAr?: string }

export default function CampaignRoom() {
  const { id = "" } = useParams();
  const { lang, tr, el } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [room, setRoom] = useState<Room | null>(null);
  const [picker, setPicker] = useState<Picker[]>([]);
  const [linkKinds, setLinkKinds] = useState<LinkKind[]>([]);
  const [retroFacts, setRetroFacts] = useState<Record<string, unknown> | null>(null);
  const [retro, setRetro] = useState("");
  const [retroAr, setRetroAr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [r, p, l] = await Promise.all([
        api.get<Room>(`/campaigns/${id}/room`), api.get<Picker[]>("/campaigns/picker"), api.get<LinkKind[]>("/campaigns/links"),
      ]);
       setRoom(r); setPicker(p.some((x) => x.id === r.campaign.id) ? p : [{ id: r.campaign.id, name: r.campaign.name, nameAr: r.campaign.nameAr, status: r.campaign.status }, ...p]); setLinkKinds(l);
      setRetro(r.campaign.retro || ""); setRetroAr(r.campaign.retroAr || "");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  useEffect(() => { load(); }, [id]);

  const transition = async (to: string) => {
    setBusy(true);
    try { await api.post(`/campaigns/${id}/transition`, { to }); await load(); toast.push(tr("saved"), "success"); }
    catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  };
  const getFacts = async () => {
    try { setRetroFacts(await api.get(`/campaigns/${id}/retro`)); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };
  const draftRetro = async () => {
    setBusy(true);
    try {
      const out = await api.post<{ draft?: string | null; facts: Record<string, unknown>; reason?: string }>(`/campaigns/${id}/retro/draft`, {});
      setRetroFacts(out.facts); if (out.draft) setRetro(out.draft); else toast.push(out.reason || tr("noData"), "error");
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  };
  const saveRetro = async () => {
    setBusy(true);
    try { await api.patch(`/campaigns/${id}/retro`, { retro: retro || null, retroAr: retroAr || null }); await load(); toast.push(tr("saved"), "success"); }
    catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  };

  if (!room) return <div className="py-16 text-center text-ink-500">{tr("loading")}</div>;
  const c = room.campaign;
  const label = lang === "ar" && c.nameAr ? c.nameAr : c.name;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/campaigns" className="text-xs text-steel-600 hover:underline">← {tr("nav_campaigns")}</Link>
          <h1 className="mt-1 text-2xl font-bold text-ink-900">{label}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500"><StatusPill value={c.status} /><span>{c.ownerName || tr("unassigned")}</span><span>{c.departmentName || ""}</span></div>
        </div>
        <select className="input w-auto" value={id} onChange={(e) => { location.href = `/campaigns/${e.target.value}`; }}>
          {picker.map((x) => <option key={x.id} value={x.id}>{lang === "ar" && x.nameAr ? x.nameAr : x.name}</option>)}
        </select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={tr("budget")} value={fmtMoney(room.spend.budgetUsd, "USD", lang)} />
        <Metric label={tr("an_spend")} value={fmtMoney(room.spend.spentUsd, "USD", lang)} sub={room.spend.pacePct == null ? "—" : `${room.spend.pacePct}%`} />
        <Metric label="ROI" value={room.kpis.roiPct == null ? "—" : `${room.kpis.roiPct}%`} />
        <Metric label={tr("camp_leads")} value={fmtNum(room.results.leads, lang)} sub={`${room.results.won} ${el("WON")} · ${room.results.lost} ${el("LOST")}`} />
      </div>

      <Card>
        <SectionTitle action={can("campaigns") && <div className="flex flex-wrap gap-2">{room.allowedTransitions.map((to) => <button key={to} disabled={busy} onClick={() => transition(to)} className="btn-ghost text-xs">{el(to)} →</button>)}</div>}>{tr("status")}</SectionTitle>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-ink-400">{tr("objective")}</div><div className="mt-1 text-ink-700">{c.objective || room.brief?.objective || "—"}</div></div>
          <div><div className="text-xs text-ink-400">{tr("date")}</div><div className="mt-1 text-ink-700">{fmtDate(room.timeline.startDate, lang)} → {fmtDate(room.timeline.endDate, lang)}</div></div>
          <div><div className="text-xs text-ink-400">KPI</div><div className="mt-1 text-ink-700">{room.brief?.kpiMetric || "—"} {room.brief?.kpiTarget ?? ""}</div></div>
        </div>
      </Card>

      <Card>
        <SectionTitle>{lang === "ar" ? "مساحات التنفيذ" : "Execution territories"}</SectionTitle>
        {!room.items.length ? <Empty text={tr("noData")} /> : <div className="grid gap-3 md:grid-cols-2">{room.items.map((g) => (
          <div key={g.table} className="rounded-xl border border-paper-200 bg-paper-100/40 p-3">
            <div className="flex items-center justify-between"><b className="text-sm text-ink-800">{lang === "ar" && g.labelAr ? g.labelAr : g.label}</b><span className="kpi-num text-xs text-ink-500">{g.count}</span></div>
            <div className="mt-2 space-y-1">{g.items.slice(0, 6).map((x) => <div key={x.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-ink-600">{x.title || x.id}</span><StatusPill value={x.status} /></div>)}</div>
          </div>
        ))}</div>}
        <p className="mt-3 text-[11px] text-ink-400">{linkKinds.map((x) => lang === "ar" && x.labelAr ? x.labelAr : x.label).join(" · ")}</p>
      </Card>

      <Card>
        <SectionTitle action={<div className="flex gap-2"><button onClick={getFacts} className="btn-ghost text-xs">{lang === "ar" ? "الحقائق" : "Load facts"}</button>{can("campaigns") && <button onClick={draftRetro} disabled={busy} className="btn-ghost text-xs">✦ {lang === "ar" ? "مسودة مؤسَّسة" : "Grounded draft"}</button>}</div>}>{lang === "ar" ? "الاسترجاع الختامي" : "Retrospective"}</SectionTitle>
        {retroFacts && <pre className="mb-3 max-h-44 overflow-auto rounded-lg bg-ink-950 p-3 text-[10px] text-paper-100" dir="ltr">{JSON.stringify(retroFacts, null, 2)}</pre>}
        <div className="grid gap-3 md:grid-cols-2"><textarea className="input min-h-32" dir="ltr" value={retro} onChange={(e) => setRetro(e.target.value)} placeholder="Retrospective (EN)" /><textarea className="input min-h-32" dir="rtl" value={retroAr} onChange={(e) => setRetroAr(e.target.value)} placeholder="الاسترجاع (AR)" /></div>
        {can("campaigns") && <div className="mt-3 text-end"><button onClick={saveRetro} disabled={busy} className="btn-amber">{tr("save")}</button></div>}
      </Card>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Card><div className="text-[11px] uppercase tracking-wide text-ink-500">{label}</div><div className="kpi-num mt-1 text-2xl text-ink-900">{value}</div>{sub && <div className="text-xs text-ink-500">{sub}</div>}</Card>;
}

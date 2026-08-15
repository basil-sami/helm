import { useSearchParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { useFetch, StatusPill, Field, Select, Modal, Money } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import ExportButton from "../components/ExportButton";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtMoney } from "../lib/format";
import { fmtDate, toDateInput } from "../lib/format";

interface Campaign {
  id: string; name: string; nameAr?: string; objective?: string;
  status: string; channel: string; startDate?: string; endDate?: string;
  budgetUsd: number; budgetSdg: number; businessUnit?: string;
  ownerId?: string; ownerName?: string; leadCount?: number;
}
interface UserRow { id: string; name: string; role: string }

const STATUSES = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED"];
const CHANNELS = ["SOCIAL", "PAID", "EVENT", "PR", "EMAIL", "WEB", "BTL"];
const blank: Partial<Campaign> = { name: "", status: "PLANNING", channel: "SOCIAL", budgetUsd: 0, budgetSdg: 0 };

interface Brief { objective?: string; personaId?: string; productId?: string; keyMessage?: string; keyMessageAr?: string; kpiMetric?: string; kpiTarget?: number; learnings?: string }
interface Roi { spentUsd: number; plannedUsd: number; pipelineUsd: number; wonUsd: number; wonCount: number; leads: number; romiPct: number | null; cplUsd: number | null; links: number; clicks: number; posts: number; avgEr: number }

function BriefPanel({ campaignId }: { campaignId: string }) {
  const { lang, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [brief, setBrief] = useState<Brief>({});
  const [roi, setRoi] = useState<Roi | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: personasList } = useFetch<{ id: string; name: string; nameAr?: string }[]>("/personas");
  const { data: productsList } = useFetch<{ id: string; name: string; nameAr?: string }[]>("/products");
  useEffect(() => {
    api.get<Brief | null>(`/briefs/${campaignId}`).then((b) => setBrief(b || {})).catch(() => {});
    api.get<Roi>(`/analytics/campaign/${campaignId}`).then(setRoi).catch(() => {});
  }, [campaignId]);

  const saveBrief = async () => {
    setBusy(true);
    try { await api.post(`/briefs/${campaignId}`, brief); toast.push(tr("bf_saved"), "success"); }
    catch { toast.push(tr("saveError"), "error"); }
    finally { setBusy(false); }
  };
  const nm = (x: { name: string; nameAr?: string }) => (lang === "ar" && x.nameAr ? x.nameAr : x.name);

  return (
    <div className="space-y-3">
      {roi && (
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-paper-200 bg-paper-100/40 p-3 text-center sm:grid-cols-6">
          {[
            [tr("an_spend"), fmtMoney(roi.spentUsd, "USD", lang)],
            [tr("an_pipeline"), fmtMoney(roi.pipelineUsd, "USD", lang)],
            [tr("an_won"), fmtMoney(roi.wonUsd, "USD", lang)],
            ["ROMI", roi.romiPct != null ? `${roi.romiPct}%` : "—"],
            [tr("bf_clicks"), String(roi.clicks)],
            [`${tr("bf_posts")} ER`, `${roi.avgEr}%`],
          ].map(([l, v]) => (
            <div key={l as string}><div className="text-[10px] uppercase tracking-wide text-ink-500">{l}</div>
              <div className="kpi-num text-sm text-ink-800">{v}</div></div>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-amber-500/25 bg-amber-50/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-800">📋 {tr("bf_title")}</span>
          <span className="text-[11px] text-amber-700">{tr("bf_hint")}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><Field label={tr("bf_objective")}><input className="input" value={brief.objective || ""} onChange={(e) => setBrief({ ...brief, objective: e.target.value })} /></Field></div>
          <Field label={tr("au_persona")}><Select value={brief.personaId || ""} onChange={(v) => setBrief({ ...brief, personaId: v })} placeholder={tr("none")} options={(personasList || []).map((x) => ({ value: x.id, label: nm(x) }))} /></Field>
          <Field label={tr("product")}><Select value={brief.productId || ""} onChange={(v) => setBrief({ ...brief, productId: v })} placeholder={tr("none")} options={(productsList || []).map((x) => ({ value: x.id, label: nm(x) }))} /></Field>
          <Field label={`${tr("au_message")} (AR)`}><input className="input" value={brief.keyMessageAr || ""} onChange={(e) => setBrief({ ...brief, keyMessageAr: e.target.value })} /></Field>
          <Field label={`${tr("au_message")} (EN)`}><input className="input" value={brief.keyMessage || ""} onChange={(e) => setBrief({ ...brief, keyMessage: e.target.value })} /></Field>
          <Field label={tr("bf_kpi")}><input className="input" placeholder="LEADS / WON_USD / ER%" value={brief.kpiMetric || ""} onChange={(e) => setBrief({ ...brief, kpiMetric: e.target.value })} /></Field>
          <Field label={tr("bf_kpiTarget")}><input className="input" type="number" value={brief.kpiTarget ?? ""} onChange={(e) => setBrief({ ...brief, kpiTarget: e.target.value === "" ? undefined : +e.target.value })} /></Field>
          <div className="col-span-2"><Field label={tr("bf_learnings")}><textarea className="input" rows={2} value={brief.learnings || ""} onChange={(e) => setBrief({ ...brief, learnings: e.target.value })} /></Field></div>
        </div>
        {can("campaigns") && <button onClick={saveBrief} disabled={busy} className="btn-amber mt-2 w-full">{tr("save")} — {tr("bf_title")}</button>}
      </div>
    </div>
  );
}

export default function Campaigns() {
  const { lang, tr, el } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useFetch<Campaign[]>("/campaigns");
  // W5·NERVE2 — the war room finally gets its screen; the nerve is its
  // first tenant. Backend has existed since W4·A with no UI consumer —
  // the interrupted-run pattern, caught by asking "who fetches /room?".
  const [room, setRoomState] = useState<Campaign | null>(null);
  const [params, setParams] = useSearchParams();
  const setRoom = (c: Campaign | null) => {
    setRoomState(c);
    setParams(c ? { room: c.id } : {}, { replace: true });
  };
  // W5·NERVE4 — the deep-link: /campaigns?room=<id> opens the drawer, so
  // the Finance Model (and anything else) can point straight at a room.
  useEffect(() => {
    if (!room) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setRoom(null);
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const list = data || [];
      const i = list.findIndex((x) => x.id === room.id);
      if (i < 0) return;
      const step = e.key === "ArrowRight" ? 1 : -1;      // logical order; RTL users read the list top-down anyway
      const nxt = list[i + step];
      if (nxt) setRoom(nxt);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [room, data]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const rid = params.get("room");
    if (rid && !room && data) {
      const c = data.find((x) => x.id === rid);
      if (c) setRoomState(c);
    }
  }, [data]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [bump, setBump] = useState(0);
  const [toState, setToState] = useState<string | null>(null);  // pending transition target
  const [learnings, setLearnings] = useState("");
  const [transErr, setTransErr] = useState("");
  const [alLabel, setAlLabel] = useState("");
  const [alAmount, setAlAmount] = useState("");
  const [alChannel, setAlChannel] = useState("PAID");
  const [alSdg, setAlSdg] = useState("");
  const roomData = useFetch<{
    brief: { kpiMetric?: string; kpiTarget?: number } | null;
    kpis: { cplUsd: number | null; roiPct: number | null; itemCount: number };
    allowedTransitions: string[];
    campaign: { status: string; retro?: string | null; retroAr?: string | null };
  } | null>(room ? `/campaigns/${room.id}/room` : "", [room?.id, bump]);
  const allocs = useFetch<{ id: string; label: string; kind: string; channel: string; amountUsd: number; amountSdg?: number; campaignId?: string }[]>(
    room ? "/budget" : "", [room?.id, bump]);
  const myAllocs = (allocs.data || []).filter((b) => b.kind === "PLANNED" && b.campaignId === room?.id);
  const doTransition = async (to: string) => {
    setTransErr("");
    try {
      await api.post(`/campaigns/${room!.id}/transition`, { to, ...(to === "COMPLETED" && learnings ? { learnings } : {}) });
      setToState(null); setLearnings(""); setRoom({ ...room!, status: to });
      setBump((b) => b + 1); reload(); toast.push(tr("saved"), "success");
    } catch (e) { setTransErr((e as Error).message); }
  };
  const addAlloc = async () => {
    if (!alLabel || !Number(alAmount)) return;
    try {
      await api.post("/budget", { label: alLabel, kind: "PLANNED", channel: alChannel, amountUsd: Number(alAmount),
        ...(Number(alSdg) > 0 ? { amountSdg: Number(alSdg) } : {}), campaignId: room!.id });
      setAlLabel(""); setAlAmount(""); setAlSdg(""); setBump((b) => b + 1);
    } catch { toast.push(tr("saveError"), "error"); }
  };
  const nerve = useFetch<{
    money: { planned: number; committed: number; actual: number; pct: number | null; health: string | null;
             plannedSdg: number; actualSdg: number } | null;
    tissue: Record<string, number | null>;
    objectives: { id: string; label: string; labelAr?: string; status: string }[];
  } | null>(room ? `/nerve/campaigns/${room.id}` : "", [room?.id, bump]);
  const { data: users } = useFetch<UserRow[]>("/users");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Partial<Campaign> | null>(null);
  const [saving, setSaving] = useState(false);

  const list = (data || []).filter((c) => !filter || c.status === filter);

  const save = async () => {
    if (!editing?.name) return;
    setSaving(true);
    try {
      const payload = {
        name: editing.name, nameAr: editing.nameAr, objective: editing.objective,
        channel: editing.channel,
        startDate: editing.startDate, endDate: editing.endDate,
        budgetUsd: editing.budgetUsd, budgetSdg: editing.budgetSdg,
        businessUnit: editing.businessUnit, ownerId: editing.ownerId || null,
      };
      if (editing.id) {
        const previous = data?.find((c) => c.id === editing.id);
        await api.patch(`/campaigns/${editing.id}`, payload);
        if (previous && editing.status && editing.status !== previous.status) {
          await api.post(`/campaigns/${editing.id}/transition`, { to: editing.status });
        }
      }
      else {
        const created = await api.post<Campaign>("/campaigns", { ...payload, status: "PLANNING" });
        setEditing({ ...editing, ...created });
        reload();
        toast.push(tr("saved"), "success");
        toast.push(tr("bf_now"), "success");
        return;
      }
      setEditing(null);
      reload();
      toast.push(tr("saved"), "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await api.del(`/campaigns/${id}`); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };

  const removeMany = async (rows: Campaign[]) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await Promise.all(rows.map((c) => api.del(`/campaigns/${c.id}`))); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setFilter("")} className={`pill ${!filter ? "tab-active" : "bg-paper-200 text-ink-600"}`}>{tr("all")}</button>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`pill ${filter === s ? "tab-active" : "bg-paper-200 text-ink-600"}`}>{el(s)}</button>
          ))}
        </div>
        <div className="flex items-center gap-2"><ExportButton resource="campaigns" /><button onClick={() => setEditing(blank)} className="btn-amber">+ {tr("add")}</button></div>
      </div>

      <DataTable<Campaign>
        rows={list}
        loading={loading}
        rowKey={(c) => c.id}
        initialSort={{ key: "name", dir: "asc" }}
        bulkActions={[{ label: tr("deleteSelected"), tone: "danger", onRun: removeMany }]}
        columns={[
          {
            key: "name", header: tr("name"),
            sortValue: (c) => (lang === "ar" && c.nameAr ? c.nameAr : c.name),
            render: (c) => (
              <div>
                <div className="flex items-center gap-2">
<button onClick={() => setRoom(c)} className="text-start font-medium text-ink-800 hover:underline">{lang === "ar" && c.nameAr ? c.nameAr : c.name}</button>
                  {!!c.leadCount && (
                    <span className="rounded-full bg-steel-500/12 px-2 py-0.5 text-[11px] text-steel-600">{c.leadCount} {tr("camp_leads")}</span>
                  )}
                </div>
                <div className="text-xs text-ink-500">{c.businessUnit} · {fmtDate(c.startDate, lang)} → {fmtDate(c.endDate, lang)}</div>
              </div>
            ),
          },
          { key: "status", header: tr("status"), sortValue: (c) => c.status, render: (c) => <StatusPill value={c.status} /> },
          { key: "channel", header: tr("channel"), sortValue: (c) => c.channel, render: (c) => <span className="text-ink-600">{el(c.channel)}</span> },
          { key: "ownerName", header: tr("owner"), sortValue: (c) => c.ownerName || "", render: (c) => <span className="text-ink-600">{c.ownerName || tr("unassigned")}</span> },
          { key: "budgetUsd", header: tr("budget"), numeric: true, sortValue: (c) => c.budgetUsd, render: (c) => <Money usd={c.budgetUsd} sdg={c.budgetSdg} /> },
        ]}
        rowActions={(c) => (
          <>
            <button onClick={() => setEditing({ ...c, startDate: toDateInput(c.startDate), endDate: toDateInput(c.endDate) })} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>
            <button onClick={() => remove(c.id)} className="ms-3 text-xs text-clay-600 hover:underline">{tr("delete")}</button>
          </>
        )}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? tr("edit") : tr("add")}
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}
      >
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={`${tr("name")} (EN)`}><input className="input" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label={`${tr("name")} (AR)`}><input className="input" value={editing.nameAr || ""} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label={tr("objective")}><input className="input" value={editing.objective || ""} onChange={(e) => setEditing({ ...editing, objective: e.target.value })} /></Field></div>
            <Field label={tr("status")}><Select value={editing.status || "PLANNING"} onChange={(v) => setEditing({ ...editing, status: v })} options={STATUSES.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("channel")}><Select value={editing.channel || "SOCIAL"} onChange={(v) => setEditing({ ...editing, channel: v })} options={CHANNELS.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("startDate")}><input type="date" className="input" value={editing.startDate || ""} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} /></Field>
            <Field label={tr("endDate")}><input type="date" className="input" value={editing.endDate || ""} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} /></Field>
            <Field label={`${tr("budget")} (USD)`}><input type="number" className="input" value={editing.budgetUsd ?? 0} onChange={(e) => setEditing({ ...editing, budgetUsd: Number(e.target.value) })} /></Field>
            <Field label={`${tr("budget")} (SDG)`}><input type="number" className="input" value={editing.budgetSdg ?? 0} onChange={(e) => setEditing({ ...editing, budgetSdg: Number(e.target.value) })} /></Field>
            <Field label={tr("businessUnit")}><input className="input" value={editing.businessUnit || ""} onChange={(e) => setEditing({ ...editing, businessUnit: e.target.value })} /></Field>
            <Field label={tr("owner")}><Select value={editing.ownerId || ""} onChange={(v) => setEditing({ ...editing, ownerId: v })} placeholder={tr("unassigned")} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
             {editing.id ? <div className="col-span-2"><BriefPanel campaignId={editing.id} /></div>
               : <p className="col-span-2 rounded-lg bg-paper-100 p-3 text-xs text-ink-500">{tr("bf_afterSave")}</p>}
          </div>
        )}
      </Modal>

      {/* ── W5·NERVE2 · the campaign room, nerve-first ── */}
      <Modal open={!!room} onClose={() => setRoom(null)}
        title={room ? (lang === "ar" && room.nameAr ? room.nameAr : room.name) : ""}>
        {room && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StatusPill value={room.status} />
              <span className="text-xs text-ink-500">{room.businessUnit} · {el(room.channel)}</span>
            </div>
            {nerve.data?.money && (
              <div className="rounded-xl border border-paper-200 bg-white p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-800">🫀 {tr("fin_title")}</span>
                  {nerve.data.money.health && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                      nerve.data.money.health === "OVER" ? "bg-clay-500/15 text-clay-700"
                      : nerve.data.money.health === "WATCH" ? "bg-amber-500/15 text-amber-700"
                      : "bg-moss-500/12 text-moss-700"}`}>
                      {tr(`fin_h_${nerve.data.money.health}`)}{nerve.data.money.pct != null ? ` ${nerve.data.money.pct}%` : ""}
                    </span>
                  )}
                </div>
                <div className="kpi-num mt-1 text-sm text-ink-700" dir="ltr">
                  {fmtMoney(nerve.data.money.actual, "USD", lang)} + {fmtMoney(nerve.data.money.committed, "USD", lang)} / {fmtMoney(nerve.data.money.planned, "USD", lang)}
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-200" dir="ltr">
                  {(() => { const p = nerve.data!.money!;
                    const load = p.planned > 0 ? Math.min(150, ((p.actual + p.committed) / p.planned) * 100) : 0;
                    const aPct = p.planned > 0 ? Math.min(100, (p.actual / p.planned) * 100) : 0;
                    return (<div className="flex h-full"><div className="bg-ink-800" style={{ width: `${aPct}%` }} /><div className="bg-amber-500/70" style={{ width: `${Math.max(0, load - aPct)}%` }} /></div>);
                  })()}
                </div>
              </div>
            )}
            {nerve.data?.tissue && (
              <div>
                <span className="label">{tr("nerve_tissue")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(nerve.data.tissue).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => (
                    <span key={k} className="rounded-full bg-paper-100 px-2.5 py-1 text-[11px] text-ink-700">
                      <b className="kpi-num">{v}</b> {tr(`nerve_${k}`)}
                    </span>
                  ))}
                  {Object.values(nerve.data.tissue).every((v) => !v) && (
                    <span className="text-xs text-ink-400">{tr("nerve_empty")}</span>
                  )}
                </div>
              </div>
            )}
            {(nerve.data?.objectives?.length ?? 0) > 0 && (
              <div>
                <span className="label">{tr("nerve_serves")}</span>
                <div className="space-y-1">
                  {nerve.data!.objectives.map((o) => (
                    <div key={o.id} className="rounded-lg bg-paper-100 px-2.5 py-1.5 text-xs text-ink-700" dir="auto">
                      🧭 {lang === "ar" && o.labelAr ? o.labelAr : o.label}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── the room's remaining tenants: brief · KPIs · transitions · retro ── */}
            {roomData.data && (
              <>
                <div className={`rounded-lg px-2.5 py-1.5 text-xs ${roomData.data.brief ? "bg-moss-500/10 text-moss-700" : "bg-amber-500/10 text-amber-800"}`} dir="auto">
                  {roomData.data.brief ? `✓ ${tr("nerve_briefOk")}` : `⚠ ${tr("nerve_briefMissing")}`}
                </div>
                {(roomData.data.kpis.cplUsd != null || roomData.data.kpis.roiPct != null) && (
                  <div className="flex flex-wrap gap-3 text-xs text-ink-600" dir="auto">
                    {roomData.data.kpis.cplUsd != null && (
                      <span>{tr("nerve_cpl")}: <b className="kpi-num" dir="ltr">${roomData.data.kpis.cplUsd.toLocaleString()}</b></span>
                    )}
                    {roomData.data.kpis.roiPct != null && (
                      <span>{tr("nerve_roi")}: <b className={`kpi-num ${roomData.data.kpis.roiPct >= 0 ? "text-moss-700" : "text-clay-600"}`} dir="ltr">{roomData.data.kpis.roiPct}%</b></span>
                    )}
                  </div>
                )}
                {can("campaigns", "write") && roomData.data.allowedTransitions.length > 0 && (
                  <div>
                    <span className="label">{tr("nerve_next")}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {roomData.data.allowedTransitions.map((t) => (
                        <button key={t} onClick={() => (t === "COMPLETED" ? setToState(t) : doTransition(t))}
                          className="rounded-full border border-paper-300 bg-paper-100 px-2.5 py-1 text-[11px] text-ink-700 hover:border-amber-500/40 hover:bg-amber-500/[.06]">
                          → {el(t)}
                        </button>
                      ))}
                    </div>
                    {toState === "COMPLETED" && (
                      <div className="mt-2 space-y-1.5">
                        <textarea className="input min-h-16 text-xs" placeholder={tr("nerve_learnings")}
                          value={learnings} onChange={(e) => setLearnings(e.target.value)} />
                        <div className="flex gap-2">
                          <button onClick={() => doTransition("COMPLETED")} className="btn-amber text-xs">✓ {el("COMPLETED")}</button>
                          <button onClick={() => setToState(null)} className="btn-ghost text-xs">{tr("cancel")}</button>
                        </div>
                      </div>
                    )}
                    {transErr && <p className="mt-1.5 text-xs text-clay-600" dir="auto">{transErr}</p>}
                  </div>
                )}
                {(roomData.data.campaign.retro || roomData.data.campaign.retroAr) && (
                  <div>
                    <span className="label">{tr("nerve_retro")}</span>
                    <p className="whitespace-pre-wrap rounded-lg bg-paper-100 px-2.5 py-1.5 text-xs text-ink-700" dir="auto">
                      {lang === "ar" ? (roomData.data.campaign.retroAr || roomData.data.campaign.retro) : (roomData.data.campaign.retro || roomData.data.campaign.retroAr)}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* ── allocations, editable from the room ── */}
            {can("budget", "write") && (
              <div>
                <span className="label">{tr("nerve_alloc")}</span>
                <div className="space-y-1">
                  {myAllocs.map((b) => (
                    <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper-100 px-2.5 py-1.5 text-xs">
                      <span className="min-w-0 truncate text-ink-700" dir="auto">{b.label} <span className="text-[10px] text-ink-400">{el(b.channel)}</span></span>
                      <span className="flex shrink-0 items-center gap-2">
                        <b className="kpi-num" dir="ltr">${Number(b.amountUsd).toLocaleString()}{Number(b.amountSdg) > 0 ? ` · ${Number(b.amountSdg).toLocaleString()} SDG` : ""}</b>
                        <button onClick={async () => { try { await api.del(`/budget/${b.id}`); setBump((x) => x + 1); } catch { toast.push(tr("deleteError"), "error"); } }}
                          className="text-clay-600 hover:text-clay-700">✕</button>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <input className="input h-8 flex-1 text-xs" placeholder={tr("nerve_allocLabel")} value={alLabel} onChange={(e) => setAlLabel(e.target.value)} dir="auto" />
                  <input className="input h-8 w-20 text-xs" placeholder="USD" dir="ltr" type="number" value={alAmount} onChange={(e) => setAlAmount(e.target.value)} />
                  <input className="input h-8 w-24 text-xs" placeholder="SDG" dir="ltr" type="number" value={alSdg} onChange={(e) => setAlSdg(e.target.value)} />
                  <Select value={alChannel} onChange={setAlChannel}
                    options={["SOCIAL", "PAID", "EVENT", "PR", "EMAIL", "WEB", "BTL"].map((c) => ({ value: c, label: el(c) }))} />
                  <button onClick={addAlloc} className="btn-amber text-xs">+</button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

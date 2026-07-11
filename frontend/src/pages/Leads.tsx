import { useState } from "react";
import { useEffect } from "react";
import { useFetch, Card, Field, Select, Modal, SectionTitle } from "../components/ui";
import { KanbanBoard } from "../components/KanbanBoard";
import { useToast } from "../components/Toast";
import ExportButton from "../components/ExportButton";
import { fmtDate } from "../lib/format";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";

import { api } from "../lib/api";
import { fmtMoney } from "../lib/format";

interface Lead {
  productId?: string;
  id: string; company: string; contactName?: string; phone?: string; email?: string;
  source?: string; businessUnit?: string; stage: string; valueUsd: number; valueSdg: number;
  notes?: string; ownerId?: string; ownerName?: string; campaignId?: string; campaignName?: string;
}
interface UserRow { id: string; name: string }
interface CampaignRow { id: string; name: string }

const STAGES = ["NEW", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
const STAGE_COLS = [
  { id: "NEW", accent: "bg-steel-500" },
  { id: "QUALIFIED", accent: "bg-violet-500" },
  { id: "PROPOSAL", accent: "bg-amber-500" },
  { id: "NEGOTIATION", accent: "bg-amber-600" },
  { id: "WON", accent: "bg-moss-500" },
  { id: "LOST", accent: "bg-clay-500" },
];
const blank: Partial<Lead> = { company: "", stage: "NEW", valueUsd: 0, valueSdg: 0 };

interface Activity { id: string; actorName: string; kind: string; body?: string | null; meta?: { from?: string; to?: string; via?: string; count?: number; stage?: string } | null; createdAt: string }

function LeadTimeline({ leadId }: { leadId: string }) {
  const { lang, tr, el } = useI18n();
  const { can } = useAuth();
  const [items, setItems] = useState<Activity[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.get<Activity[]>(`/leads/${leadId}/activities`).then(setItems).catch(() => {});
  useEffect(() => { load(); }, [leadId]);

  const line = (a: Activity) => {
    const m = a.meta || {};
    switch (a.kind) {
      case "CREATED": return tr("tl_CREATED");
      case "STAGE": return `${tr("tl_STAGE")}: ${el(m.from || "")} ← ${el(m.to || "")}`;
      case "CAPTURE": return `${tr("tl_CAPTURE")}${m.via === "EVENT" ? ` (${tr("nav_events")})` : ""}${a.body ? ` — ${a.body}` : ""}`;
      case "TASK": return `${tr("tl_TASK")} (${m.count || 1})`;
      default: return a.body || "";
    }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { await api.post(`/leads/${leadId}/notes`, { body: note.trim() }); setNote(""); load(); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-paper-200 bg-paper-100/40 p-3">
      <SectionTitle>{tr("tl_title")}</SectionTitle>
      {can("leads") && (
        <div className="mb-2 flex gap-2">
          <input className="input flex-1" placeholder={tr("tl_notePh")} value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} />
          <button onClick={addNote} disabled={busy || !note.trim()} className="btn-ghost shrink-0">+ {tr("tl_addNote")}</button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="py-2 text-xs text-ink-400">{tr("tl_empty")}</p>
      ) : (
        <ul className="max-h-44 space-y-1.5 overflow-y-auto">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-xs">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${a.kind === "STAGE" ? "bg-steel-500" : a.kind === "NOTE" ? "bg-amber-500" : a.kind === "CAPTURE" ? "bg-violet-500" : "bg-ink-300"}`} />
              <div className="min-w-0">
                <div className="text-ink-700">{a.kind === "NOTE" ? a.body : line(a)}</div>
                <div className="text-[10px] text-ink-400">{a.actorName} · {fmtDate(a.createdAt, lang)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Leads() {
  const { lang, tr, el } = useI18n();
  const toast = useToast();
  const { can } = useAuth();
  const canWrite = can("leads");
  const { data, loading, reload } = useFetch<Lead[]>("/leads");
  const { data: users } = useFetch<UserRow[]>("/users");
  const { data: campaigns } = useFetch<CampaignRow[]>("/campaigns");
  const { data: productsList } = useFetch<{ id: string; name: string }[]>("/products");
  const [editing, setEditing] = useState<Partial<Lead> | null>(null);
  const [imp, setImp] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const runImport = async () => {
    if (!imp?.trim()) return;
    setSaving(true);
    try {
      const r = await api.post<{ created: number; skipped: number }>("/leads/import", { csv: imp });
      toast.push(`${tr("im_done")}: ${r.created} (+${r.skipped} ⤫)`, "success");
      setImp(null); reload();
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };

  const leads = data || [];

  const save = async () => {
    if (!editing?.company) return;
    setSaving(true);
    try {
      const payload = {
        company: editing.company, contactName: editing.contactName, phone: editing.phone, email: editing.email,
        source: editing.source, businessUnit: editing.businessUnit, stage: editing.stage,
        valueUsd: editing.valueUsd, valueSdg: editing.valueSdg, notes: editing.notes,
        campaignId: editing.campaignId || null, ownerId: editing.ownerId || null,
      };
      if (editing.id) await api.patch(`/leads/${editing.id}`, payload);
      else await api.post("/leads", payload);
      setEditing(null);
      reload();
      toast.push(tr("saved"), "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };

  const move = async (lead: Lead, stage: string) => {
    try { await api.patch(`/leads/${lead.id}`, { stage }); reload(); }
    catch { toast.push(tr("saveError"), "error"); }
  };

  const remove = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await api.del(`/leads/${id}`); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-500">
          {lang === "ar" ? `${leads.length} عميل محتمل` : `${leads.length} leads`}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { navigator.clipboard.writeText(`${location.origin}/api/capture/form`).catch(() => {}); toast.push(tr("cap_copied"), "success"); }} className="btn-ghost" title={tr("cap_hint")}>📥 {tr("cap_copy")}</button>
          {canWrite && <button onClick={() => setImp("")} className="btn-ghost">⇪ {tr("im_btn")}</button>}
          <ExportButton resource="leads" />
          <button onClick={() => setEditing(blank)} className="btn-amber">+ {tr("add")}</button>
        </div>
      </div>

      {loading ? <div className="py-16 text-center text-ink-500">{tr("loading")}</div> : (
        <KanbanBoard<Lead>
          columns={STAGE_COLS.map((s) => ({ id: s.id, title: el(s.id), accent: s.accent }))}
          items={leads}
          itemKey={(l) => l.id}
          itemColumn={(l) => l.stage}
          onMove={(l, stage) => move(l, stage)}
          columnSummary={(col) => (
            <span className="kpi-num text-[11px] text-ink-500">{fmtMoney(col.reduce((a, l) => a + Number(l.valueUsd || 0), 0), "USD", lang)}</span>
          )}
          renderCard={(l) => (
            <>
              <button onClick={() => setEditing(l)} className="text-start font-medium text-ink-800 hover:text-amber-700">{l.company}</button>
              <div className="mt-0.5 text-xs text-ink-500">{l.businessUnit} · {l.contactName || "—"}</div>
              <div className="mt-2 kpi-num text-sm text-ink-700">{fmtMoney(l.valueUsd, "USD", lang)}</div>
              <div className="text-[11px] text-ink-500">{fmtMoney(l.valueSdg, "SDG", lang)}</div>
              {(l.campaignName || l.source === "OSINT") && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {l.source === "OSINT" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] text-violet-600">
                      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
                      {tr("lead_fromSignal")}
                    </span>
                  )}
                  {l.campaignName && (
                    <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] text-amber-700">◆ {l.campaignName}</span>
                  )}
                </div>
              )}
              <div className="mt-2 flex justify-end border-t border-paper-200 pt-2">
                <button onClick={() => remove(l.id)} className="text-[11px] text-clay-600 hover:underline">{tr("delete")}</button>
              </div>
            </>
          )}
        />
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("add")}
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("company")}><input className="input" value={editing.company || ""} onChange={(e) => setEditing({ ...editing, company: e.target.value })} /></Field></div>
            <Field label={tr("contact")}><input className="input" value={editing.contactName || ""} onChange={(e) => setEditing({ ...editing, contactName: e.target.value })} /></Field>
            <Field label={tr("phone")}><input className="input" dir="ltr" value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label={tr("email")}><input className="input" dir="ltr" value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label={tr("source")}><input className="input" value={editing.source || ""} onChange={(e) => setEditing({ ...editing, source: e.target.value })} /></Field>
            <Field label={tr("businessUnit")}><input className="input" value={editing.businessUnit || ""} onChange={(e) => setEditing({ ...editing, businessUnit: e.target.value })} /></Field>
            <Field label={tr("stage")}><Select value={editing.stage || "NEW"} onChange={(v) => setEditing({ ...editing, stage: v })} options={STAGES.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={`${tr("value")} (USD)`}><input type="number" className="input" value={editing.valueUsd ?? 0} onChange={(e) => setEditing({ ...editing, valueUsd: Number(e.target.value) })} /></Field>
            <Field label={`${tr("value")} (SDG)`}><input type="number" className="input" value={editing.valueSdg ?? 0} onChange={(e) => setEditing({ ...editing, valueSdg: Number(e.target.value) })} /></Field>
            <div className="col-span-2"><Field label={tr("owner")}><Select value={editing.ownerId || ""} onChange={(v) => setEditing({ ...editing, ownerId: v })} placeholder={tr("unassigned")} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} /></Field></div>
            <div className="col-span-2"><Field label={tr("lead_campaign")}><Select value={editing.campaignId || ""} onChange={(v) => setEditing({ ...editing, campaignId: v })} placeholder={tr("lead_noCampaign")} options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} /></Field></div>
            <div className="col-span-2"><Field label={tr("product")}><Select value={editing.productId || ""} onChange={(v) => setEditing({ ...editing, productId: v })} placeholder={tr("none")} options={(productsList || []).map((x) => ({ value: x.id, label: x.name }))} /></Field></div>
            <div className="col-span-2"><Field label={tr("notes")}><textarea className="input" rows={2} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field></div>
            {editing.id && <div className="col-span-2"><LeadTimeline leadId={editing.id} /></div>}
          </div>
        )}
      </Modal>

      <Modal open={imp !== null} onClose={() => setImp(null)} title={tr("im_title")}
        footer={<><button onClick={() => setImp(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={runImport} disabled={saving || !imp?.trim()} className="btn-amber">{tr("im_btn")}</button></>}>
        <p className="mb-2 text-xs text-ink-500">{tr("im_hint")}</p>
        <textarea className="input h-44 font-mono text-xs" dir="ltr" value={imp || ""} onChange={(e) => setImp(e.target.value)}
          placeholder={"company,contactname,phone,email,source,valueusd\nBlue Nile Mills,Omar,+249911111111,omar@bnm.sd,EXPO,5000"} />
      </Modal>
    </div>
  );
}

import { useState } from "react";
import { useFetch, Field, Select, Modal, StatusPill, Money } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { DataTable } from "../components/DataTable";
import { useToast } from "../components/Toast";
import ExportButton from "../components/ExportButton";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { useEffect } from "react";
import { fmtDate, toDateInput, daysUntil } from "../lib/format";

interface EventRow {
  id: string; name: string; nameAr?: string; type?: string; venue?: string; city?: string;
  startDate?: string; endDate?: string; status: string; budgetUsd: number; budgetSdg: number;
  ownerId?: string; ownerName?: string;
}
interface UserRow { id: string; name: string }

const STATUSES = ["PLANNED", "CONFIRMED", "RUNNING", "DONE", "CANCELLED"];
const blank: Partial<EventRow> = { name: "", status: "PLANNED", city: "Khartoum", budgetUsd: 0, budgetSdg: 0 };

interface Reg { id: string; leadId: string; company: string; contactName?: string; phone?: string; status: string; checkedInAt?: string }
interface Scorecard { registered: number; attended: number; attendRatePct: number; budgetUsd: number; costPerLeadUsd: number | null }

function RegistrationsPanel({ eventId }: { eventId: string }) {
  const { tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [regs, setRegs] = useState<Reg[]>([]);
  const [score, setScore] = useState<Scorecard | null>(null);
  const [leadSel, setLeadSel] = useState("");
  const { data: leadOpts } = useFetch<{ id: string; company: string }[]>("/leads");
  const load = () => {
    api.get<Reg[]>(`/events/${eventId}/registrations`).then(setRegs).catch(() => {});
    api.get<Scorecard>(`/analytics/event/${eventId}`).then(setScore).catch(() => {});
  };
  useEffect(() => { load(); }, [eventId]);

  const addReg = async () => {
    if (!leadSel) return;
    try { await api.post(`/events/${eventId}/registrations`, { leadId: leadSel }); setLeadSel(""); load(); }
    catch { toast.push(tr("saveError"), "error"); }
  };
  const checkin = async (id: string) => {
    try { await api.patch(`/registrations/${id}/checkin`, {}); load(); }
    catch { toast.push(tr("saveError"), "error"); }
  };
  const copyLink = () => {
    navigator.clipboard.writeText(`${location.origin}/api/capture/form?event=${eventId}`).catch(() => {});
    toast.push(tr("cap_copied"), "success");
  };

  return (
    <div className="rounded-lg border border-paper-200 bg-paper-100/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-800">{tr("ev_regs")} ({regs.length})</span>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {score && <span className="text-ink-500">{tr("ev_attended")}: <b className="kpi-num">{score.attended}</b> ({score.attendRatePct}%){score.costPerLeadUsd != null && <> · {tr("ev_costPerLead")}: <b className="kpi-num">${score.costPerLeadUsd}</b></>}</span>}
          <button onClick={copyLink} className="text-steel-600 hover:underline">🔗 {tr("ev_capLink")}</button>
        </div>
      </div>
      {can("events") && (
        <div className="mt-2 flex gap-2">
          <div className="flex-1"><Select value={leadSel} onChange={setLeadSel} placeholder={tr("proc_lead")}
            options={(leadOpts || []).map((l) => ({ value: l.id, label: l.company }))} /></div>
          <button onClick={addReg} disabled={!leadSel} className="btn-ghost shrink-0">+ {tr("add")}</button>
        </div>
      )}
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {regs.map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 text-xs">
            <span className="truncate text-ink-700">{r.company}{r.phone ? ` · ${r.phone}` : ""}</span>
            {r.status === "ATTENDED"
              ? <span className="pill bg-moss-500/15 text-moss-700">✓ {tr("ev_attended")}</span>
              : can("events") ? <button onClick={() => checkin(r.id)} className="pill bg-amber-500/15 text-amber-700 hover:bg-amber-500/25">{tr("ev_checkin")}</button>
              : <span className="pill bg-paper-200 text-ink-500">{r.status}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Events() {
  const { lang, tr, el } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useFetch<EventRow[]>("/events");
  const { data: users } = useFetch<UserRow[]>("/users");
  const [editing, setEditing] = useState<Partial<EventRow> | null>(null);
  const [saving, setSaving] = useState(false);

  const events = data || [];

  const save = async () => {
    if (!editing?.name) return;
    setSaving(true);
    try {
      const payload = {
        name: editing.name, nameAr: editing.nameAr, type: editing.type, venue: editing.venue, city: editing.city,
        startDate: editing.startDate, endDate: editing.endDate, status: editing.status,
        budgetUsd: editing.budgetUsd, budgetSdg: editing.budgetSdg, ownerId: editing.ownerId || null,
      };
      if (editing.id) await api.patch(`/events/${editing.id}`, payload);
      else await api.post("/events", payload);
      setEditing(null);
      reload();
      toast.push(tr("saved"), "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await api.del(`/events/${id}`); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };
  const removeMany = async (rows: EventRow[]) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await Promise.all(rows.map((e) => api.del(`/events/${e.id}`))); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-500">{lang === "ar" ? `${events.length} فعالية` : `${events.length} events`}</div>
        <div className="flex items-center gap-2"><ExportButton resource="events" /><button onClick={() => setEditing(blank)} className="btn-amber">+ {tr("add")}</button></div>
      </div>

      <DataTable<EventRow>
        rows={events}
        loading={loading}
        rowKey={(e) => e.id}
        initialSort={{ key: "startDate", dir: "asc" }}
        bulkActions={[{ label: tr("deleteSelected"), tone: "danger", onRun: removeMany }]}
        columns={[
          {
            key: "name", header: tr("name"),
            sortValue: (e) => (lang === "ar" && e.nameAr ? e.nameAr : e.name),
            render: (e) => (
              <div>
                <div className="font-medium text-ink-800">{lang === "ar" && e.nameAr ? e.nameAr : e.name}</div>
                <div className="text-xs text-ink-500">{e.type}{e.venue ? ` · ${e.venue}` : ""}</div>
              </div>
            ),
          },
          { key: "city", header: tr("city"), sortValue: (e) => e.city || "", render: (e) => <span className="text-ink-600">{e.city || "—"}</span> },
          {
            key: "startDate", header: tr("date"), sortValue: (e) => e.startDate || "",
            render: (e) => {
              const d = daysUntil(e.startDate);
              return (
                <div className="text-ink-700">
                  {fmtDate(e.startDate, lang)}
                  {d !== null && d >= 0 && <span className="ms-2 text-xs text-ink-400">{lang === "ar" ? `بعد ${d} يوم` : `in ${d}d`}</span>}
                </div>
              );
            },
          },
          { key: "status", header: tr("status"), sortValue: (e) => e.status, render: (e) => <StatusPill value={e.status} /> },
          { key: "budgetUsd", header: tr("budget"), numeric: true, sortValue: (e) => e.budgetUsd, render: (e) => <Money usd={e.budgetUsd} sdg={e.budgetSdg} /> },
          { key: "ownerName", header: tr("owner"), sortValue: (e) => e.ownerName || "", render: (e) => <span className="text-ink-600">{e.ownerName || tr("unassigned")}</span> },
        ]}
        rowActions={(e) => (
          <>
            <button onClick={() => setEditing({ ...e, startDate: toDateInput(e.startDate), endDate: toDateInput(e.endDate) })} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>
            <button onClick={() => remove(e.id)} className="ms-3 text-xs text-clay-600 hover:underline">{tr("delete")}</button>
          </>
        )}
      />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("add")}
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={`${tr("name")} (EN)`}><input className="input" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label={`${tr("name")} (AR)`}><input className="input" value={editing.nameAr || ""} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} /></Field></div>
            <Field label={tr("type")}><input className="input" value={editing.type || ""} onChange={(e) => setEditing({ ...editing, type: e.target.value })} /></Field>
            <Field label={tr("status")}><Select value={editing.status || "PLANNED"} onChange={(v) => setEditing({ ...editing, status: v })} options={STATUSES.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("venue")}><input className="input" value={editing.venue || ""} onChange={(e) => setEditing({ ...editing, venue: e.target.value })} /></Field>
            <Field label={tr("city")}><input className="input" value={editing.city || ""} onChange={(e) => setEditing({ ...editing, city: e.target.value })} /></Field>
            <Field label={tr("startDate")}><input type="date" className="input" value={editing.startDate || ""} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} /></Field>
            <Field label={tr("endDate")}><input type="date" className="input" value={editing.endDate || ""} onChange={(e) => setEditing({ ...editing, endDate: e.target.value })} /></Field>
            <Field label={`${tr("budget")} (USD)`}><input type="number" className="input" value={editing.budgetUsd ?? 0} onChange={(e) => setEditing({ ...editing, budgetUsd: Number(e.target.value) })} /></Field>
            <Field label={`${tr("budget")} (SDG)`}><input type="number" className="input" value={editing.budgetSdg ?? 0} onChange={(e) => setEditing({ ...editing, budgetSdg: Number(e.target.value) })} /></Field>
            <div className="col-span-2"><Field label={tr("owner")}><Select value={editing.ownerId || ""} onChange={(v) => setEditing({ ...editing, ownerId: v })} placeholder={tr("unassigned")} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} /></Field></div>
          </div>
        )}
        {editing?.id && <div className="mt-3"><RegistrationsPanel eventId={editing.id} /></div>}
      </Modal>
    </div>
  );
}

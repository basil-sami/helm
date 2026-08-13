import { useState } from "react";
import { useFetch, Field, Select, Modal, StatusPill } from "../components/ui";
import { KanbanBoard } from "../components/KanbanBoard";
import { useToast } from "../components/Toast";
import ExportButton from "../components/ExportButton";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtDate, toDateInput, daysUntil } from "../lib/format";


interface Task {
  id: string; title: string; status: string; priority: string; dueDate?: string;
  assigneeId?: string; assigneeName?: string; campaignId?: string; campaignName?: string;
}
interface UserRow { id: string; name: string }
interface CampaignRow { id: string; name: string }

const STATUSES = ["TODO", "DOING", "DONE"];
const STATUS_COLS = [
  { id: "TODO", accent: "bg-steel-500" },
  { id: "DOING", accent: "bg-amber-500" },
  { id: "DONE", accent: "bg-moss-500" },
];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const blank: Partial<Task> = { title: "", status: "TODO", priority: "MEDIUM" };

export default function Tasks() {
  const { lang, tr, el } = useI18n();
  const { data, loading, reload } = useFetch<Task[]>("/tasks");
  const { data: users } = useFetch<UserRow[]>("/users");
  const { data: campaigns } = useFetch<CampaignRow[]>("/campaigns");
  const { data: leadOpts } = useFetch<{ id: string; company: string }[]>("/leads");
  const { data: templates } = useFetch<{ id: string; key: string; name: string; nameAr?: string; tasks: { t: { ar: string; en: string }; offset: number; priority: string }[] }[]>("/templates");
  const PROCESS_TEMPLATES = templates || [];
  const toast = useToast();
  const [editing, setEditing] = useState<Partial<Task> | null>(null);
  const [saving, setSaving] = useState(false);
  const [proc, setProc] = useState<{ key: string; anchor: string; campaignId: string; assigneeId: string; leadId: string } | null>(null);

  const tasks = data || [];

  const save = async () => {
    if (!editing?.title) return;
    setSaving(true);
    try {
      const payload = {
        title: editing.title, status: editing.status, priority: editing.priority,
        dueDate: editing.dueDate || null, assigneeId: editing.assigneeId || null, campaignId: editing.campaignId || null,
      };
      if (editing.id) await api.patch(`/tasks/${editing.id}`, payload);
      else await api.post("/tasks", payload);
      setEditing(null);
      reload();
      toast.push(tr("saved"), "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };

  const move = async (task: Task, status: string) => {
    try { await api.patch(`/tasks/${task.id}`, { status }); reload(); }
    catch { toast.push(tr("saveError"), "error"); }
  };
  const remove = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    try { await api.del(`/tasks/${id}`); reload(); toast.push(tr("deleted"), "success"); }
    catch { toast.push(tr("deleteError"), "error"); }
  };

  const startProcess = async () => {
    const tpl = PROCESS_TEMPLATES.find((x) => x.key === proc?.key);
    if (!tpl || !proc) return;
    setSaving(true);
    try {
      const base = new Date(proc.anchor + "T12:00:00");
      const items = tpl.tasks.map((tk) => {
        const due = new Date(base); due.setDate(due.getDate() + tk.offset);
        return { title: lang === "ar" ? tk.t.ar : tk.t.en, priority: tk.priority, dueDate: due.toISOString().slice(0, 10) };
      });
      // One atomic request: all process tasks land together or not at all.
      await api.post("/tasks/batch", {
        processKey: tpl.key, tasks: items,
        campaignId: proc.campaignId || null,
        assigneeId: proc.assigneeId || null,
        leadId: proc.leadId || null,
      });
      setProc(null);
      reload();
      toast.push(`${tpl.tasks.length} — ${tr("proc_created")}`, "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-500">{lang === "ar" ? `${tasks.length} مهمة` : `${tasks.length} tasks`}</div>
        <div className="flex items-center gap-2">
          <ExportButton resource="tasks" />
          <button disabled={!PROCESS_TEMPLATES.length} onClick={() => setProc({ key: PROCESS_TEMPLATES[0].key, anchor: new Date().toISOString().slice(0, 10), campaignId: "", assigneeId: "", leadId: "" })} className="btn-ghost">⚡ {tr("proc_start")}</button>
          <button onClick={() => setEditing(blank)} className="btn-amber">+ {tr("add")}</button>
        </div>
      </div>

      {loading ? <div className="py-16 text-center text-ink-500">{tr("loading")}</div> : (
        <KanbanBoard<Task>
          columns={STATUS_COLS.map((s) => ({ id: s.id, title: el(s.id), accent: s.accent }))}
          items={tasks}
          itemKey={(t) => t.id}
          itemColumn={(t) => t.status}
          onMove={(t, status) => move(t, status)}
          renderCard={(t) => {
            const d = daysUntil(t.dueDate);
            const overdue = d !== null && d < 0 && t.status !== "DONE";
            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => setEditing({ ...t, dueDate: toDateInput(t.dueDate) })} className="text-start text-sm font-medium text-ink-800 hover:text-amber-700">{t.title}</button>
                  <StatusPill value={t.priority} />
                </div>
                <div className="mt-1.5 text-xs text-ink-500">{t.assigneeName || tr("unassigned")}{t.campaignName ? ` · ${t.campaignName}` : ""}</div>
                {t.dueDate && <div className={`mt-1 text-xs ${overdue ? "text-clay-600 font-medium" : "text-ink-500"}`}>{fmtDate(t.dueDate, lang)}</div>}
                <div className="mt-2 flex justify-end border-t border-paper-200 pt-2">
                  <button onClick={() => remove(t.id)} className="text-[11px] text-clay-600 hover:underline">{tr("delete")}</button>
                </div>
              </>
            );
          }}
        />
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("add")}
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
        </>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("title")}><input className="input" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field></div>
            <Field label={tr("status")}><Select value={editing.status || "TODO"} onChange={(v) => setEditing({ ...editing, status: v })} options={STATUSES.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("priority")}><Select value={editing.priority || "MEDIUM"} onChange={(v) => setEditing({ ...editing, priority: v })} options={PRIORITIES.map((s) => ({ value: s, label: el(s) }))} /></Field>
            <Field label={tr("dueDate")}><input type="date" className="input" value={editing.dueDate || ""} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} /></Field>
            <Field label={tr("assignee")}><Select value={editing.assigneeId || ""} onChange={(v) => setEditing({ ...editing, assigneeId: v })} placeholder={tr("unassigned")} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
            <div className="col-span-2"><Field label={tr("campaign")}><Select value={editing.campaignId || ""} onChange={(v) => setEditing({ ...editing, campaignId: v })} placeholder={tr("none")} options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} /></Field></div>
          </div>
        )}
      </Modal>

      <Modal open={!!proc} onClose={() => setProc(null)} title={`⚡ ${tr("proc_title")}`}
        footer={<>
          <button onClick={() => setProc(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={startProcess} disabled={saving} className="btn-amber">{tr("proc_create")}</button>
        </>}>
        {proc && (() => {
          const tpl = PROCESS_TEMPLATES.find((x) => x.key === proc.key) || PROCESS_TEMPLATES[0];
          return (
            <div className="space-y-3">
              <p className="text-sm text-ink-500">{tr("proc_hint")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Field label={tr("proc_template")}>
                    <Select value={proc.key} onChange={(v) => setProc({ ...proc, key: v })}
                      options={PROCESS_TEMPLATES.map((t) => ({ value: t.key, label: lang === "ar" && t.nameAr ? t.nameAr : t.name }))} />
                  </Field>
                </div>
                <Field label={tr("proc_anchor")}>
                  <input type="date" className="input" value={proc.anchor} onChange={(e) => setProc({ ...proc, anchor: e.target.value })} />
                </Field>
                <Field label={tr("assignee")}>
                  <Select value={proc.assigneeId} onChange={(v) => setProc({ ...proc, assigneeId: v })} placeholder={tr("unassigned")}
                    options={(users || []).map((u) => ({ value: u.id, label: u.name }))} />
                </Field>
                <div className="col-span-2">
                  <Field label={tr("campaign")}>
                    <Select value={proc.campaignId} onChange={(v) => setProc({ ...proc, campaignId: v })} placeholder={tr("none")}
                      options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label={tr("proc_lead")}>
                    <Select value={proc.leadId} onChange={(v) => setProc({ ...proc, leadId: v })} placeholder={tr("none")}
                      options={(leadOpts || []).map((l) => ({ value: l.id, label: l.company }))} />
                  </Field>
                </div>
              </div>
              <div className="rounded-lg border border-paper-200 bg-paper-100/50 p-3">
                <div className="mb-1.5 text-xs font-medium text-ink-600">
                  <span className="kpi-num">{tpl.tasks.length}</span> {tr("proc_tasksIn")}
                </div>
                <ul className="max-h-40 space-y-1 overflow-auto text-xs text-ink-600">
                  {tpl.tasks.map((tk, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate">{lang === "ar" ? tk.t.ar : tk.t.en}</span>
                      <span className="kpi-num shrink-0 text-ink-400">+{tk.offset}d</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

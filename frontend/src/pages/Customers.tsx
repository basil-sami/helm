import { useState } from "react";
import { useFetch, Card, Field, Select, Modal, Empty } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { fmtMoney, fmtDate, toDateInput } from "../lib/format";

interface Customer { id: string; company: string; businessUnit?: string; firstWonAt?: string; totalValueUsd: number; status: string; accountOwnerId?: string; ownerName?: string; nextReviewAt?: string; notes?: string }
interface Fb { avg: number | null; count: number }
interface UserRow { id: string; name: string }

const TONE: Record<string, string> = { ACTIVE: "bg-moss-500/15 text-moss-700", DORMANT: "bg-amber-500/15 text-amber-700", CHURNED: "bg-paper-200 text-ink-500" };

export default function Customers() {
  const { lang, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useFetch<Customer[]>("/customers");
  const { data: fb } = useFetch<Fb>("/feedback");
  const { data: users } = useFetch<UserRow[]>("/users");
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editing?.id) return;
    setSaving(true);
    try {
      await api.patch(`/customers/${editing.id}`, {
        businessUnit: editing.businessUnit, status: editing.status, accountOwnerId: editing.accountOwnerId || null,
        nextReviewAt: editing.nextReviewAt || null, totalValueUsd: editing.totalValueUsd, notes: editing.notes,
      });
      setEditing(null); reload();
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };
  const copyFb = (id: string) => {
    navigator.clipboard.writeText(`${location.origin}/api/capture/feedback-form?customer=${id}`).catch(() => {});
    toast.push(tr("lk_copied"), "success");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900">{tr("cu_title")}</h1>
          <p className="text-sm text-ink-500">{tr("cu_sub")}</p>
        </div>
        {fb && fb.count > 0 && (
          <div className="rounded-xl border border-paper-200 bg-white px-4 py-2 text-sm">
            <span className="text-ink-500">{tr("cu_feedback")}: </span>
            <span className="kpi-num text-amber-700">★ {fb.avg}</span>
            <span className="ms-1 text-xs text-ink-400">({fb.count})</span>
          </div>
        )}
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? <div className="py-16 text-center text-ink-500">{tr("loading")}</div>
          : !data?.length ? <Empty text={tr("noData")} /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-paper-200 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-4 py-3 text-start font-medium">{tr("company")}</th>
              <th className="px-4 py-3 text-start font-medium">{tr("cu_value")}</th>
              <th className="px-4 py-3 text-start font-medium">{tr("cu_owner")}</th>
              <th className="px-4 py-3 text-start font-medium">{tr("cu_nextReview")}</th>
              <th className="px-4 py-3 text-start font-medium">{tr("status")}</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-paper-200">
              {data.map((c) => {
                const due = c.nextReviewAt && new Date(c.nextReviewAt) <= new Date();
                return (
                  <tr key={c.id} className="hover:bg-paper-100/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink-800">{c.company}</div>
                      <div className="text-xs text-ink-500">{c.businessUnit || "—"} · {tr("cu_firstWon")}: {c.firstWonAt ? fmtDate(c.firstWonAt, lang) : "—"}</div>
                    </td>
                    <td className="px-4 py-3 kpi-num text-ink-800">{fmtMoney(c.totalValueUsd, "USD", lang)}</td>
                    <td className="px-4 py-3 text-ink-600">{c.ownerName || "—"}</td>
                    <td className={`px-4 py-3 ${due ? "font-medium text-clay-600" : "text-ink-600"}`}>{c.nextReviewAt ? fmtDate(c.nextReviewAt, lang) : "—"}</td>
                    <td className="px-4 py-3"><span className={`pill ${TONE[c.status] || TONE.CHURNED}`}>{tr(c.status === "ACTIVE" ? "ACTIVE_C" : c.status)}</span></td>
                    <td className="px-4 py-3 text-end whitespace-nowrap">
                      <button onClick={() => copyFb(c.id)} className="text-xs text-steel-600 hover:underline">★ {tr("cu_fbLink")}</button>
                      {can("leads") && <button onClick={() => setEditing({ ...c, nextReviewAt: c.nextReviewAt ? toDateInput(c.nextReviewAt) : "" })} className="ms-3 text-xs text-steel-600 hover:underline">{tr("edit")}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.company || ""}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("status")}>
              <Select value={editing.status || "ACTIVE"} onChange={(v) => setEditing({ ...editing, status: v })}
                options={[{ value: "ACTIVE", label: tr("ACTIVE_C") }, { value: "DORMANT", label: tr("DORMANT") }, { value: "CHURNED", label: tr("CHURNED") }]} />
            </Field>
            <Field label={tr("cu_owner")}>
              <Select value={editing.accountOwnerId || ""} onChange={(v) => setEditing({ ...editing, accountOwnerId: v })} placeholder={tr("unassigned")}
                options={(users || []).map((u) => ({ value: u.id, label: u.name }))} />
            </Field>
            <Field label={tr("cu_value")}><input className="input" type="number" value={editing.totalValueUsd ?? 0} onChange={(e) => setEditing({ ...editing, totalValueUsd: +e.target.value })} /></Field>
            <Field label={tr("cu_nextReview")}><input className="input" type="date" value={editing.nextReviewAt || ""} onChange={(e) => setEditing({ ...editing, nextReviewAt: e.target.value })} /></Field>
            <div className="col-span-2"><Field label={tr("notes")}><textarea className="input" rows={2} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

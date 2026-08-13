import { useState } from "react";
import { useFetch, Card, Field, Select, Modal, Empty } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { fmtMoney } from "../lib/format";

interface Product { id: string; name: string; nameAr?: string; businessUnit?: string; category?: string; description?: string; priceMinUsd?: number; priceMaxUsd?: number; status: string }
const blank: Partial<Product> = { name: "", nameAr: "", businessUnit: "", category: "", status: "ACTIVE" };

export default function Products() {
  const { lang, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useFetch<Product[]>("/products");
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editing?.name) return;
    setSaving(true);
    try {
      if (editing.id) await api.patch(`/products/${editing.id}`, editing);
      else await api.post("/products", editing);
      setEditing(null); reload();
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    await api.del(`/products/${id}`).catch(() => toast.push(tr("saveError"), "error"));
    reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900">{tr("pr_title")}</h1>
          <p className="text-sm text-ink-500">{tr("pr_sub")}</p>
        </div>
        {can("campaigns") && <button onClick={() => setEditing(blank)} className="btn-amber">+ {tr("add")}</button>}
      </div>
      <Card className="p-0 overflow-hidden">
        {loading ? <div className="py-16 text-center text-ink-500">{tr("loading")}</div>
          : !data?.length ? <Empty text={tr("noData")} /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-paper-200 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-4 py-3 text-start font-medium">{tr("product")}</th>
              <th className="px-4 py-3 text-start font-medium">{tr("businessUnit")}</th>
              <th className="px-4 py-3 text-start font-medium">{tr("pr_category")}</th>
              <th className="px-4 py-3 text-start font-medium">{tr("pr_price")}</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-paper-200">
              {data.map((p) => (
                <tr key={p.id} className={`hover:bg-paper-100/60 ${p.status === "ARCHIVED" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium text-ink-800">{lang === "ar" && p.nameAr ? p.nameAr : p.name}</td>
                  <td className="px-4 py-3 text-ink-600">{p.businessUnit || "—"}</td>
                  <td className="px-4 py-3 text-ink-600">{p.category || "—"}</td>
                  <td className="px-4 py-3 kpi-num text-ink-700">
                    {p.priceMinUsd != null ? `${fmtMoney(p.priceMinUsd, "USD", lang)} – ${fmtMoney(p.priceMaxUsd || p.priceMinUsd, "USD", lang)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {can("campaigns") && <>
                      <button onClick={() => setEditing(p)} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>
                      <button onClick={() => remove(p.id)} className="ms-3 text-xs text-clay-600 hover:underline">{tr("delete")}</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("add")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name (EN)"><input className="input" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="الاسم (AR)"><input className="input" value={editing.nameAr || ""} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} /></Field>
            <Field label={tr("businessUnit")}><input className="input" value={editing.businessUnit || ""} onChange={(e) => setEditing({ ...editing, businessUnit: e.target.value })} /></Field>
            <Field label={tr("pr_category")}><input className="input" value={editing.category || ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
            <Field label={`${tr("pr_price")} min`}><input className="input" type="number" value={editing.priceMinUsd ?? ""} onChange={(e) => setEditing({ ...editing, priceMinUsd: e.target.value === "" ? undefined : +e.target.value })} /></Field>
            <Field label={`${tr("pr_price")} max`}><input className="input" type="number" value={editing.priceMaxUsd ?? ""} onChange={(e) => setEditing({ ...editing, priceMaxUsd: e.target.value === "" ? undefined : +e.target.value })} /></Field>
            <div className="col-span-2"><Field label={tr("status")}>
              <Select value={editing.status || "ACTIVE"} onChange={(v) => setEditing({ ...editing, status: v })}
                options={[{ value: "ACTIVE", label: tr("ACTIVE_C") }, { value: "ARCHIVED", label: "Archived / مؤرشف" }]} />
            </Field></div>
            <div className="col-span-2"><Field label={tr("notes")}><textarea className="input" rows={2} value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

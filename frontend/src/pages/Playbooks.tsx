import { useState } from "react";
import { useFetch, Card, Modal, SkeletonCards } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";

// ═══ PLAYBOOKS — الأدلة: the platform teaches its own processes ══════

interface Playbook { id: string; title: string; titleAr?: string; body?: string; category: string; published: boolean; updatedAt: string }

const CATS = ["GENERAL", "CAMPAIGNS", "CONTENT", "CRISIS", "SALES", "EVENTS"];

export default function Playbooks() {
  const { tr, lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const w = can("brain");
  const { data, loading, reload } = useFetch<Playbook[]>("/playbooks");
  const [reading, setReading] = useState<Playbook | null>(null);
  const [editing, setEditing] = useState<Partial<Playbook> | null>(null);
  const [cat, setCat] = useState("ALL");

  const rows = (data || []).filter((p) => cat === "ALL" || p.category === cat);

  const save = async () => {
    if (!editing?.title) return;
    try {
      if (editing.id) await api.patch(`/playbooks/${editing.id}`, editing);
      else await api.post("/playbooks", editing);
      setEditing(null); reload(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-900">{tr("pbk_title")}</h1>
          <p className="text-sm text-ink-500">{tr("pbk_sub")}</p>
        </div>
        {w && <button onClick={() => setEditing({ category: "GENERAL", body: "" })} className="btn-amber">+ {tr("pbk_add")}</button>}
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {["ALL", ...CATS].map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`rounded-full px-3 py-1 font-medium transition ${cat === c ? "tab-active" : "bg-paper-200 text-ink-600 hover:bg-paper-300"}`}>
            {c === "ALL" ? tr("pbk_all") : tr(`pbk_cat_${c}`)}
          </button>
        ))}
      </div>

      {loading ? <SkeletonCards count={4} /> : !rows.length ? (
        <Card className="p-8 text-center"><p className="text-sm font-medium text-ink-700">{tr("pbk_none")}</p><p className="mt-1 text-xs text-ink-400">{tr("pbk_noneHint")}</p></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="cursor-pointer" onClick={() => setReading(p)}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-2xl">📖</span>
                  {p.published
                    ? <span className="rounded-full bg-moss-100 px-2 py-0.5 text-[10px] font-bold text-moss-700">{tr("pbk_published")}</span>
                    : <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[10px] text-ink-500">{tr("pbk_draft")}</span>}
                </div>
                <div className="mt-2 font-semibold text-ink-900">{lang === "ar" && p.titleAr ? p.titleAr : p.title}</div>
                <div className="mt-0.5 text-[11px] text-ink-500">{tr(`pbk_cat_${p.category}`)}</div>
              </div>
              {w && (
                <div className="mt-3 flex gap-2 text-[11px]">
                  <button onClick={() => setEditing(p)} className="rounded-lg bg-paper-200 px-2.5 py-1 text-ink-600 hover:bg-paper-300">{tr("edit")}</button>
                  <button onClick={async () => { await api.patch(`/playbooks/${p.id}`, { published: !p.published }); reload(); }}
                    className="rounded-lg bg-paper-200 px-2.5 py-1 text-ink-600 hover:bg-paper-300">
                    {p.published ? tr("pbk_unpublish") : tr("pbk_publish")}
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {reading && (
        <Modal open title={lang === "ar" && reading.titleAr ? reading.titleAr : reading.title} onClose={() => setReading(null)}>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
            {reading.body || tr("pbk_empty")}
          </div>
        </Modal>
      )}

      {editing && (
        <Modal open title={editing.id ? tr("edit") : tr("pbk_add")} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <input className="input" placeholder={tr("pbk_t")} value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            <input className="input" placeholder={tr("pbk_tAr")} value={editing.titleAr || ""} onChange={(e) => setEditing({ ...editing, titleAr: e.target.value })} dir="rtl" />
            <select className="input" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
              {CATS.map((c) => <option key={c} value={c}>{tr(`pbk_cat_${c}`)}</option>)}
            </select>
            <textarea className="input min-h-44 font-mono text-sm" placeholder={tr("pbk_body")} value={editing.body || ""} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            <button onClick={save} className="btn-amber w-full" disabled={!editing.title}>{tr("save")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

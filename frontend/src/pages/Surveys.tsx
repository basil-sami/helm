import { useState } from "react";
import { Card, SectionTitle, Field, Select, Modal, Empty, SkeletonRows, useFetch } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

// ── RESEARCH — surveys that score themselves + insights that rewrite strategy ──

interface Q { key: string; text: string; textAr?: string; type: string; required?: boolean; options?: string[]; max?: number }
interface Survey { id: string; name: string; nameAr?: string; slug: string; kind: string; audience: string;
  questions: Q[] | string; campaignName?: string; productName?: string; productId?: string; campaignId?: string;
  active: boolean; responseCount: number }
interface Stats { kind: string; total: number; last30: number; nps?: number | null; promoters?: number; passives?: number;
  detractors?: number; avgScore?: number; csat?: number | null }
interface Resp { id: string; answers: Record<string, unknown> | string; score?: number; contactName?: string; createdAt: string }
interface Insight { id: string; title: string; titleAr?: string; body?: string; source: string; impact: string; createdAt: string }
interface Opt { id: string; name: string }

const QTYPES = ["SCALE", "TEXT", "CHOICE"];
const parseQs = (v: Q[] | string): Q[] => Array.isArray(v) ? v : (() => { try { return JSON.parse(v || "[]"); } catch { return []; } })();

export default function Surveys() {
  const { lang, tr, el } = useI18n();
  const { can } = useAuth();
  const w = can("research", "write");
  const { data: surveys, reload } = useFetch<Survey[]>("/surveys");
  const { data: products } = useFetch<Opt[]>("/products");
  const [editing, setEditing] = useState<(Partial<Survey> & { qsArr?: Q[] }) | null>(null);
  const [viewing, setViewing] = useState<Survey | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");

  const openEdit = (s?: Survey) => setEditing(s
    ? { ...s, qsArr: parseQs(s.questions) }
    : { kind: "NPS", audience: "ANON", active: true, qsArr: [
        { key: "nps", text: "How likely are you to recommend us?", textAr: "ما احتمال أن توصي بنا؟", type: "SCALE", max: 10, required: true },
        { key: "why", text: "What is the main reason?", textAr: "ما السبب الرئيسي؟", type: "TEXT" },
      ] });
  const save = async () => {
    if (!editing?.name || !editing.qsArr?.length) return;
    setErr("");
    const payload = { ...editing, questions: editing.qsArr };
    delete (payload as Record<string, unknown>).qsArr;
    try {
      if (editing.id) await api.patch(`/surveys/${editing.id}`, payload);
      else await api.post("/surveys", payload);
      setEditing(null); reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const setQ = (i: number, patch: Partial<Q>) => {
    const arr = [...(editing?.qsArr || [])]; arr[i] = { ...arr[i], ...patch };
    setEditing({ ...editing!, qsArr: arr });
  };
  const copyLink = async (s: Survey) => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/s/${s.slug}`); } catch { /* optional */ }
    setCopied(s.id); setTimeout(() => setCopied(""), 1500);
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle action={w && <button onClick={() => openEdit()} className="btn-amber text-xs">+ {tr("sv_new")}</button>}>
          {tr("sv_title")}
        </SectionTitle>
        <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("sv_sub")}</p>
        {!surveys ? <SkeletonRows rows={3} cols={4} /> : surveys.length === 0 ? <Empty text={tr("sv_empty")} /> : (
          <div className="grid gap-2 md:grid-cols-2">
            {surveys.map((s) => (
              <div key={s.id} className="rounded-xl border border-paper-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => w && openEdit(s)} className="text-start font-medium text-ink-800 hover:underline">
                    {lang === "ar" && s.nameAr ? s.nameAr : s.name}
                  </button>
                  <span className="pill bg-steel-500/12 text-[10px] text-steel-600">{s.kind}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-400" dir="ltr">/s/{s.slug}{s.productName ? ` · ${s.productName}` : ""}</div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span className="kpi-num text-ink-700">{s.responseCount} <span className="text-ink-400">{tr("sv_responses")}</span></span>
                  <span className="ms-auto flex gap-2">
                    <button onClick={() => setViewing(s)} className="text-steel-600 hover:underline">{tr("sv_results")}</button>
                    <button onClick={() => copyLink(s)} className="text-steel-600 hover:underline">{copied === s.id ? `✓ ${tr("ag_copied")}` : tr("fm_copyLink")}</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <InsightsCard canWrite={w} />

      {/* Builder */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("sv_new")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("name")} (AR)`}><input className="input" value={editing.nameAr || ""} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} /></Field>
              <Field label={`${tr("name")} (EN)`}><input className="input" dir="ltr" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label={tr("type")}>
                <Select value={editing.kind || "SURVEY"} onChange={(v) => setEditing({ ...editing, kind: v })}
                  options={["SURVEY", "NPS", "CSAT"].map((k) => ({ value: k, label: k }))} />
              </Field>
              <Field label={tr("sv_audience")}>
                <Select value={editing.audience || "ANON"} onChange={(v) => setEditing({ ...editing, audience: v })}
                  options={[{ value: "ANON", label: el("ANON") }, { value: "LINKED", label: el("LINKED") }]} />
              </Field>
              <Field label="Slug"><input className="input" dir="ltr" placeholder={tr("fm_slugAuto")} value={editing.slug || ""} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} /></Field>
            </div>
            <Field label={tr("product")}>
              <Select value={editing.productId || ""} onChange={(v) => setEditing({ ...editing, productId: v || undefined })} placeholder="—"
                options={(products || []).map((p) => ({ value: p.id, label: p.name }))} />
            </Field>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label mb-0">{tr("sv_questions")}</span>
                <button onClick={() => setEditing({ ...editing, qsArr: [...(editing.qsArr || []), { key: `q${(editing.qsArr?.length || 0) + 1}`, text: "", type: "TEXT" }] })}
                  className="btn-ghost text-xs">+ {tr("add")}</button>
              </div>
              <div className="space-y-2">
                {(editing.qsArr || []).map((q, i) => (
                  <div key={i} className="rounded-lg border border-paper-200 bg-paper-100/50 p-2.5">
                    <div className="grid grid-cols-3 gap-2">
                      <input className="input" dir="ltr" placeholder="key" value={q.key} onChange={(e) => setQ(i, { key: e.target.value })} />
                      <Select value={q.type} onChange={(v) => setQ(i, { type: v })} options={QTYPES.map((t) => ({ value: t, label: t }))} />
                      <label className="flex items-center justify-between gap-1 text-xs text-ink-600">
                        <span className="flex items-center gap-1"><input type="checkbox" checked={!!q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> {tr("fm_required")}</span>
                        <button onClick={() => setEditing({ ...editing, qsArr: editing.qsArr!.filter((_, j) => j !== i) })} className="text-clay-600">✕</button>
                      </label>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input className="input" placeholder="السؤال" value={q.textAr || ""} onChange={(e) => setQ(i, { textAr: e.target.value })} />
                      <input className="input" dir="ltr" placeholder="Question" value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} />
                    </div>
                    {q.type === "SCALE" && (
                      <input className="mt-2 input w-28" dir="ltr" type="number" placeholder="max (10)" value={q.max ?? ""} onChange={(e) => setQ(i, { max: Number(e.target.value) || undefined })} />
                    )}
                    {q.type === "CHOICE" && (
                      <input className="mt-2 input" dir="ltr" placeholder={tr("fm_optionsPh")} value={(q.options || []).join(", ")}
                        onChange={(e) => setQ(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} />
                    )}
                  </div>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> {tr("active")}
            </label>
            {err && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{err}</div>}
          </div>
        )}
      </Modal>

      {/* Results */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? (lang === "ar" && viewing.nameAr ? viewing.nameAr : viewing.name) : ""}>
        {viewing && <Results survey={viewing} />}
      </Modal>
    </div>
  );
}

function Results({ survey }: { survey: Survey }) {
  const { lang, tr } = useI18n();
  const { data: stats } = useFetch<Stats>(`/surveys/${survey.id}/stats`, [survey.id]);
  const { data: resps } = useFetch<Resp[]>(`/surveys/${survey.id}/responses`, [survey.id]);
  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {stats.kind === "NPS" && <>
            <ScoreStat label="NPS" value={stats.nps === null || stats.nps === undefined ? "—" : String(stats.nps)} big />
            <ScoreStat label={tr("sv_promoters")} value={`${stats.promoters}`} />
            <ScoreStat label={tr("sv_detractors")} value={`${stats.detractors}`} />
          </>}
          {stats.kind === "CSAT" && <>
            <ScoreStat label="CSAT" value={stats.csat === null || stats.csat === undefined ? "—" : `${stats.csat}%`} big />
            <ScoreStat label={tr("sv_avg")} value={String(stats.avgScore ?? "—")} />
            <ScoreStat label={tr("sv_responses")} value={String(stats.total)} />
          </>}
          {stats.kind === "SURVEY" && <>
            <ScoreStat label={tr("sv_responses")} value={String(stats.total)} big />
            <ScoreStat label={tr("sv_last30")} value={String(stats.last30)} />
            <span />
          </>}
        </div>
      )}
      <div className="max-h-72 space-y-1.5 overflow-y-auto">
        {(resps || []).map((r) => {
          const a: Record<string, unknown> = typeof r.answers === "string" ? JSON.parse(r.answers || "{}") : r.answers;
          return (
            <div key={r.id} className="rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-xs text-ink-400">
                <span>{r.contactName || tr("sv_anon")} · {fmtDate(r.createdAt, lang)}</span>
                {r.score !== null && r.score !== undefined && <span className="kpi-num font-semibold text-ink-700">{r.score}</span>}
              </div>
              <div className="mt-0.5 text-ink-700">{Object.entries(a).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
            </div>
          );
        })}
        {resps && resps.length === 0 && <Empty text={tr("sv_noResp")} />}
      </div>
    </div>
  );
}

function ScoreStat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-paper-200 bg-white px-2 py-2.5">
      <div className={`kpi-num font-semibold text-ink-800 ${big ? "text-2xl" : "text-base"}`}>{value}</div>
      <div className="text-[10px] text-ink-400">{label}</div>
    </div>
  );
}

function InsightsCard({ canWrite }: { canWrite: boolean }) {
  const { lang, tr, el } = useI18n();
  const { data, reload } = useFetch<Insight[]>("/insights");
  const [editing, setEditing] = useState<Partial<Insight> | null>(null);
  const save = async () => {
    if (!editing?.title) return;
    if (editing.id) await api.patch(`/insights/${editing.id}`, editing); else await api.post("/insights", editing);
    setEditing(null); reload();
  };
  return (
    <Card>
      <SectionTitle action={canWrite && <button onClick={() => setEditing({ source: "SURVEY", impact: "MEDIUM" })} className="btn-ghost text-xs">+ {tr("add")}</button>}>
        {tr("ins_title")}
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("ins_sub")}</p>
      <div className="space-y-1.5">
        {(data || []).map((i) => (
          <button key={i.id} onClick={() => canWrite && setEditing(i)} className="block w-full rounded-lg border border-paper-200 bg-white px-3 py-2 text-start hover:bg-paper-100/60">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink-800">{lang === "ar" && i.titleAr ? i.titleAr : i.title}</span>
              <span className={`pill text-[10px] ${i.impact === "HIGH" ? "bg-amber-500/15 text-amber-700" : "bg-paper-200 text-ink-500"}`}>{el(i.impact)}</span>
            </div>
            {i.body && <div className="mt-0.5 line-clamp-2 text-xs text-ink-500">{i.body}</div>}
            <div className="mt-0.5 text-[11px] text-ink-400">{el(i.source)} · {fmtDate(i.createdAt, lang)}</div>
          </button>
        ))}
        {data && data.length === 0 && <Empty text={tr("ins_empty")} />}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={tr("ins_title")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("title")} (AR)`}><input className="input" value={editing.titleAr || ""} onChange={(e) => setEditing({ ...editing, titleAr: e.target.value })} /></Field>
              <Field label={`${tr("title")} (EN)`}><input className="input" dir="ltr" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            </div>
            <Field label={tr("ins_body")}><textarea className="input min-h-20" value={editing.body || ""} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("ins_source")}>
                <Select value={editing.source || "SURVEY"} onChange={(v) => setEditing({ ...editing, source: v })}
                  options={["SURVEY", "LISTENING", "INTERVIEW", "DATA"].map((s) => ({ value: s, label: el(s) }))} />
              </Field>
              <Field label={tr("ins_impact")}>
                <Select value={editing.impact || "MEDIUM"} onChange={(v) => setEditing({ ...editing, impact: v })}
                  options={["LOW", "MEDIUM", "HIGH"].map((s) => ({ value: s, label: el(s) }))} />
              </Field>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

import { useState } from "react";
import { useFetch, Card, SectionTitle, Field, Select, Modal, StatusPill, Empty } from "../components/ui";
import { useToast } from "../components/Toast";
import { useI18n } from "../context/I18nContext";
import { Entities, Cases } from "./IntelEntities";
import { AskListening, LiveSearch } from "./LiveSearch";
import { Themes } from "./IntelThemes";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import ExportButton from "../components/ExportButton";
import { fmtDate, fmtNum } from "../lib/format";

interface Topic {
  id: string; label: string; query: string; lang: string; region: string;
  category: string; sources: string[]; feeds: string[]; active: boolean;
  lastRunAt?: string; signalCount?: number;
}
interface Signal {
  id: string; title: string; url?: string; source?: string; sourceType: string;
  sentimentLabel: string; publishedAt?: string; topicLabel?: string; category?: string;
  credibility?: number; syndicationCount?: number; relevance?: number; corroborated?: boolean; corroborationCount?: number;
}
interface Overview {
  total: number;
  perDay: { date: string; count: number }[];
  bySentiment: { label: string; c: number }[];
  bySource: { source: string; c: number }[];
  byTopic: { label: string; category: string; c: number }[];
  trending: { term: string; count: number }[];
  recent: Signal[];
}

const CATS = ["BRAND", "COMPETITOR", "MARKET", "SECTOR", "CUSTOM"];
const SOURCES = ["GOOGLE_NEWS", "BING_NEWS", "GDELT", "REDDIT"];
type Editing = Partial<Topic> & { feedsText?: string };
const blank: Editing = { label: "", query: "", category: "MARKET", lang: "en", region: "SD", sources: ["GOOGLE_NEWS", "BING_NEWS", "GDELT", "REDDIT"], feedsText: "" };

export default function Intel() {
  const { lang, tr, el } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user?.role === "HEAD" || user?.role === "DIGITAL";
  const { data: topics, reload: reloadTopics } = useFetch<Topic[]>("/osint/topics");
  const { data: overview, reload: reloadOverview } = useFetch<Overview>("/osint/overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [provFor, setProvFor] = useState<string | null>(null);
  const { data: signals, reload: reloadSignals } = useFetch<Signal[]>(
    selected ? `/osint/signals?topicId=${selected}` : "/osint/signals", [selected || ""]
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const list = topics || [];
  const maxDay = Math.max(1, ...(overview?.perDay || []).map((d) => d.count));
  const senti = (lbl: string) => overview?.bySentiment.find((s) => s.label === lbl)?.c || 0;
  const sentiTotal = Math.max(1, senti("POS") + senti("NEG") + senti("NEU"));

  const reloadAll = () => { reloadTopics(); reloadOverview(); reloadSignals(); };

  const save = async () => {
    if (!editing?.label || !editing?.query) return;
    setBusy(true);
    try {
      const feeds = (editing.feedsText || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
      const payload = {
        label: editing.label, query: editing.query, category: editing.category,
        lang: editing.lang, region: editing.region, sources: editing.sources, feeds,
      };
      if (editing.id) await api.patch(`/osint/topics/${editing.id}`, payload);
      else await api.post("/osint/topics", payload);
      setEditing(null);
      reloadTopics();
    } finally { setBusy(false); }
  };

  const refresh = async (id?: string) => {
    setBusy(true); setMsg("");
    try {
      const r = await api.post<{ inserted?: number; results?: { inserted: number }[]; errors?: unknown[] }>(
        id ? `/osint/topics/${id}/refresh` : "/osint/refresh", {}
      );
      const inserted = id ? (r.inserted || 0) : (r.results || []).reduce((a, x) => a + (x.inserted || 0), 0);
      setMsg(`${tr("intel_refreshedMsg")}: +${inserted}`);
      reloadAll();
    } catch (e) {
      setMsg((e as { message?: string })?.message || "Error");
    } finally { setBusy(false); }
  };

  const removeTopic = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    if (selected === id) setSelected(null);
    await api.del(`/osint/topics/${id}`);
    reloadAll();
  };

  const toLead = async (sigId: string) => {
    try {
      await api.post(`/osint/signals/${sigId}/to-lead`, {});
      toast.push(tr("intel_saveAsLead") + " ✓", "success");
    } catch { toast.push(tr("saveError"), "error"); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900">{tr("intel_title")}</h1>
          <p className="text-sm text-ink-500">{tr("intel_subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton resource="signals" />
          {canManage && <button onClick={() => refresh()} disabled={busy} className="btn-ghost">⟳ {tr("intel_refreshAll")}</button>}
          {canManage && <button onClick={() => setEditing(blank)} className="btn-amber">+ {tr("intel_addTopic")}</button>}
        </div>
      </div>

      <ReviewQueue canManage={canManage} />
      <Themes topicId={selected} canManage={canManage} />
      <AskListening />
      <LiveSearch topicId={selected} />
      <SourceRegistry canManage={canManage} />
      {provFor && <Provenance signalId={provFor} canManage={canManage} onClose={() => setProvFor(null)} />}
      <Entities canManage={canManage} />
      <Cases canManage={canManage} />

      <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{tr("intel_ethics")}</div>
      {msg && <div className="rounded-lg bg-paper-200 px-3 py-2 text-sm text-ink-700">{msg}</div>}

      {/* Intelligence dashboard */}
      {overview && overview.total > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <SectionTitle>{tr("intel_volume")}</SectionTitle>
            <div className="flex h-28 items-end gap-1">
              {overview.perDay.map((d) => (
                <div key={d.date} className="flex-1 rounded-t bg-amber-500" style={{ height: `${(d.count / maxDay) * 100}%` }} title={`${d.date}: ${d.count}`} />
              ))}
            </div>
            <div className="mt-2 text-xs text-ink-500">{overview.total} {tr("intel_signals")}</div>
          </Card>

          <Card>
            <SectionTitle>{tr("intel_sentiment")}</SectionTitle>
            <div className="flex h-4 overflow-hidden rounded-full">
              <div className="bg-moss-500" style={{ width: `${(senti("POS") / sentiTotal) * 100}%` }} />
              <div className="bg-paper-300" style={{ width: `${(senti("NEU") / sentiTotal) * 100}%` }} />
              <div className="bg-clay-500" style={{ width: `${(senti("NEG") / sentiTotal) * 100}%` }} />
            </div>
            <div className="mt-3 flex justify-between text-xs">
              <span className="text-moss-600">▲ {el("POS")} {senti("POS")}</span>
              <span className="text-ink-500">● {el("NEU")} {senti("NEU")}</span>
              <span className="text-clay-600">▼ {el("NEG")} {senti("NEG")}</span>
            </div>
          </Card>

          <Card>
            <SectionTitle>{tr("intel_trending")}</SectionTitle>
            {overview.trending.length === 0 ? <Empty text={tr("noData")} /> : (
              <div className="flex flex-wrap gap-1.5">
                {overview.trending.map((t) => (
                  <span key={t.term} className="rounded-full bg-paper-200 px-2.5 py-1 text-xs text-ink-700">
                    {t.term} <span className="text-ink-400">{t.count}</span>
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Topics */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setSelected(null)} className={`pill ${!selected ? "bg-ink-900 text-paper" : "bg-paper-200 text-ink-600"}`}>{tr("all")}</button>
        {list.map((t) => (
          <button key={t.id} onClick={() => setSelected(t.id)}
            className={`group inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${selected === t.id ? "bg-ink-900 text-paper" : "bg-white border border-paper-200 text-ink-700"}`}>
            <span>{t.label}</span>
            <span className={`text-xs ${selected === t.id ? "text-paper-200/70" : "text-ink-400"}`}>{t.signalCount || 0}</span>
          </button>
        ))}
      </div>

      {/* Selected topic toolbar */}
      {selected && (() => {
        const t = list.find((x) => x.id === selected);
        if (!t) return null;
        return (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <StatusPill value={t.category} />
              <span className="font-mono text-xs text-ink-500" dir="ltr">{t.query}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-500">
              <span>{tr("intel_lastRun")}: {t.lastRunAt ? fmtDate(t.lastRunAt, lang) : tr("intel_never")}</span>
              {canManage && <button onClick={() => refresh(t.id)} disabled={busy} className="text-steel-600 hover:underline">{tr("intel_refresh")}</button>}
              {canManage && <button onClick={() => setEditing({ ...t, feedsText: (t.feeds || []).join("\n") })} className="text-steel-600 hover:underline">{tr("edit")}</button>}
              {canManage && <button onClick={() => removeTopic(t.id)} className="text-clay-600 hover:underline">{tr("delete")}</button>}
            </div>
          </div>
        );
      })()}

      {/* Signals feed */}
      <Card className="p-0 overflow-hidden">
        {!signals ? <div className="py-12 text-center text-ink-500">{tr("loading")}</div>
          : signals.length === 0 ? <Empty text={tr("intel_noSignals")} /> : (
          <ul className="divide-y divide-paper-200">
            {signals.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-paper-100/50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusPill value={s.sentimentLabel} />
                    <span className="text-xs text-ink-500">{s.source || el(s.sourceType)} · {fmtDate(s.publishedAt, lang)}</span>
                    {typeof s.credibility === "number" && (
                      <span className={`kpi-num rounded-full px-1.5 py-0.5 text-[10px] ${CRED_TONE[s.credibility] || CRED_TONE[4]}`}
                        title={tr("rv_credHint")} dir="ltr">{tr("rv_cred")} {s.credibility}</span>
                    )}
                    {s.corroborated === false && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700"
                        title={tr("co_hint")}>{tr("co_single")}</span>
                    )}
                    {(s.syndicationCount || 0) > 1 && (
                      <span className="rounded-full bg-moss-100 px-1.5 py-0.5 text-[10px] text-moss-700"
                        title={tr("sr_syndHint")} dir="ltr">×{s.syndicationCount}</span>
                    )}
                  </div>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="mt-1 block font-medium text-ink-800 hover:text-amber-700">{s.title}</a>
                  ) : (
                    <div className="mt-1 font-medium text-ink-800">{s.title}</div>
                  )}
                  {!selected && s.topicLabel && <div className="text-xs text-ink-400">{s.topicLabel}</div>}
                </div>
                <span className="flex shrink-0 gap-1.5">
                  <button onClick={() => setProvFor(s.id)} title={tr("pv_title")}
                    className="rounded-lg border border-paper-300 px-2 py-1 text-xs text-ink-500 hover:bg-paper-100">⚖</button>
                  <button onClick={() => toLead(s.id)} className="rounded-lg border border-paper-300 px-2.5 py-1 text-xs text-ink-600 hover:bg-paper-100">
                    + {tr("intel_saveAsLead")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Add/edit topic modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("intel_addTopic")}
        footer={<>
          <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={save} disabled={busy} className="btn-amber">{tr("save")}</button>
        </>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("name")}><input className="input" value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label={tr("intel_query")}><input className="input" dir="ltr" placeholder='"Your brand" OR "علامتك"' value={editing.query || ""} onChange={(e) => setEditing({ ...editing, query: e.target.value })} /></Field></div>
            <Field label={tr("intel_category")}><Select value={editing.category || "MARKET"} onChange={(v) => setEditing({ ...editing, category: v })} options={CATS.map((c) => ({ value: c, label: el(c) }))} /></Field>
            <Field label={tr("intel_lang")}><Select value={editing.lang || "en"} onChange={(v) => setEditing({ ...editing, lang: v })} options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]} /></Field>
            <Field label={tr("intel_region")}><input className="input" dir="ltr" value={editing.region || "SD"} onChange={(e) => setEditing({ ...editing, region: e.target.value })} /></Field>
            <div className="col-span-2">
              <span className="label">{tr("intel_sources")}</span>
              <div className="flex gap-3">
                {SOURCES.map((s) => {
                  const on = (editing.sources || []).includes(s);
                  return (
                    <button key={s} type="button"
                      onClick={() => setEditing({ ...editing, sources: on ? (editing.sources || []).filter((x) => x !== s) : [...(editing.sources || []), s] })}
                      className={`pill ${on ? "bg-ink-900 text-paper" : "bg-paper-200 text-ink-600"}`}>{el(s)}</button>
                  );
                })}
              </div>
            </div>
            <div className="col-span-2"><Field label={tr("intel_feeds")}>
              <textarea className="input font-mono text-xs" dir="ltr" rows={3} placeholder="https://example.com/feed.xml" value={editing.feedsText || ""} onChange={(e) => setEditing({ ...editing, feedsText: e.target.value })} />
              <p className="mt-1 text-xs text-ink-500">{tr("intel_feedsHint")}</p>
            </Field></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Wave 2·E · the analyst review queue ──────────────────────────────
// Signals the relevance gate could not vouch for wait here. They are
// invisible to every metric until someone rules — which is the point:
// a number nobody stands behind should not reach a board pack.
interface Pending {
  id: string; title: string; snippet?: string; url?: string; source?: string;
  relevance: number; credibility: number; syndicationCount: number; topicLabel: string;
}

const CRED_TONE = ["", "bg-moss-100 text-moss-700", "bg-moss-100 text-moss-700", "bg-amber-500/15 text-amber-700",
  "bg-paper-200 text-ink-600", "bg-clay-100 text-clay-700", "bg-clay-100 text-clay-700"];

function ReviewQueue({ canManage }: { canManage: boolean }) {
  const { tr } = useI18n();
  const toast = useToast();
  const { data, reload } = useFetch<Pending[]>("/osint/review");
  const [open, setOpen] = useState(true);
  const rows = data || [];
  if (!rows.length) return null;

  const rule = async (id: string, status: "CONFIRMED" | "REJECTED") => {
    try {
      await api.post(`/osint/signals/${id}/review`, { status });
      reload();
      toast.push(status === "CONFIRMED" ? tr("rv_confirmed") : tr("rv_rejected"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  return (
    <Card className="border-amber-500/40">
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle>⚖ {tr("rv_title")} <span className="kpi-num ms-1 text-amber-700">{rows.length}</span></SectionTitle>
          <p className="-mt-1 text-sm text-ink-500">{tr("rv_sub")}</p>
        </div>
        <button onClick={() => setOpen(!open)} className="btn-ghost text-xs">{open ? "▾" : "▸"}</button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {rows.slice(0, 12).map((r) => (
            <div key={r.id} className="rounded-xl border border-paper-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-900">{r.title}</div>
                  {r.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{r.snippet}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded-full bg-paper-200 px-1.5 py-0.5 text-ink-600">{r.topicLabel}</span>
                    <span className="kpi-num rounded-full bg-paper-200 px-1.5 py-0.5 text-ink-500" dir="ltr">{r.source}</span>
                    <span className={`kpi-num rounded-full px-1.5 py-0.5 ${CRED_TONE[r.credibility] || CRED_TONE[4]}`}
                      title={tr("rv_credHint")} dir="ltr">{tr("rv_cred")} {r.credibility}</span>
                    <span className="kpi-num rounded-full bg-paper-200 px-1.5 py-0.5 text-ink-500" dir="ltr">
                      {tr("rv_rel")} {Math.round(Number(r.relevance || 0) * 100)}%
                    </span>
                    {r.syndicationCount > 1 && (
                      <span className="rounded-full bg-moss-100 px-1.5 py-0.5 text-moss-700" dir="ltr">×{r.syndicationCount}</span>
                    )}
                    {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-amber-700 hover:underline">↗</a>}
                  </div>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1.5">
                    <button onClick={() => rule(r.id, "CONFIRMED")} className="rounded-lg bg-moss-100 px-2.5 py-1 text-[11px] font-medium text-moss-700">✓ {tr("rv_keep")}</button>
                    <button onClick={() => rule(r.id, "REJECTED")} className="rounded-lg bg-clay-100 px-2.5 py-1 text-[11px] font-medium text-clay-700">✕ {tr("rv_drop")}</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-ink-400">{tr("rv_note")}</p>
        </div>
      )}
    </Card>
  );
}

// ── The source registry: Admiralty reliability, rated by analysts ────
// Sources enter at D — "not usually reliable" — the moment they are first
// seen. Nothing is trusted because it is famous; it is trusted because
// someone here decided it was.
interface Source {
  id: string; domain: string; name?: string; kind: string; reliability: string;
  ownerGroup?: string; signalCount: number; active: boolean;
}
interface Precision { id: string; label: string; reviewThreshold: number; confirmed: number; rejected: number; pending: number }

const GRADES = ["A", "B", "C", "D", "E", "F"];
const GRADE_TONE: Record<string, string> = {
  A: "bg-moss-100 text-moss-700", B: "bg-moss-100 text-moss-700", C: "bg-amber-500/15 text-amber-700",
  D: "bg-paper-200 text-ink-600", E: "bg-clay-100 text-clay-700", F: "bg-clay-100 text-clay-700",
};

function SourceRegistry({ canManage }: { canManage: boolean }) {
  const { tr } = useI18n();
  const toast = useToast();
  const { data, reload } = useFetch<Source[]>("/osint/sources");
  const prec = useFetch<Precision[]>("/osint/precision");
  const [open, setOpen] = useState(false);
  const rows = data || [];
  if (!rows.length) return null;

  const unrated = rows.filter((r) => r.reliability === "D").length;
  const rate = async (id: string, reliability: string) => {
    try {
      await api.patch(`/osint/sources/${id}`, { reliability });
      reload(); toast.push(tr("sr_rated"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  const ruled = (p: Precision) => p.confirmed + p.rejected;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle>🏷 {tr("sr_title")}</SectionTitle>
          <p className="-mt-1 text-sm text-ink-500">{tr("sr_sub")}</p>
        </div>
        <button onClick={() => setOpen(!open)} className="btn-ghost text-xs">
          {unrated > 0 && <span className="kpi-num me-1.5 text-amber-700">{unrated}</span>}{open ? "▾" : "▸"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-4">
          {/* per-topic precision, measured from real rulings */}
          {(prec.data || []).some((p) => ruled(p) > 0) && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{tr("sr_precision")}</div>
              <div className="mt-1 space-y-1">
                {(prec.data || []).filter((p) => ruled(p) > 0 || p.pending > 0).map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-ink-700">{p.label}</span>
                    <span className="flex shrink-0 items-center gap-2" dir="ltr">
                      {ruled(p) > 0 && (
                        <span className="kpi-num font-bold text-ink-900">{Math.round((p.confirmed / ruled(p)) * 100)}%</span>
                      )}
                      <span className="kpi-num text-[10px] text-ink-400">
                        ✓{p.confirmed} ✕{p.rejected}{p.pending ? ` ⏳${p.pending}` : ""}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-ink-400">{tr("sr_precHint")}</p>
              <Tuning />
            </div>
          )}

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{tr("sr_sources")}</div>
            <div className="mt-1 space-y-1">
              {rows.slice(0, 20).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-paper-100">
                  <span className="min-w-0">
                    <span className="kpi-num text-xs text-ink-800" dir="ltr">{r.domain}</span>
                    <span className="kpi-num ms-2 text-[10px] text-ink-400" dir="ltr">{r.signalCount}</span>
                  </span>
                  {canManage ? (
                    <span className="flex shrink-0 gap-0.5">
                      {GRADES.map((g) => (
                        <button key={g} onClick={() => rate(r.id, g)} title={tr(`sr_g_${g}`)}
                          className={`kpi-num h-6 w-6 rounded text-[10px] font-bold transition ${
                            r.reliability === g ? GRADE_TONE[g] : "text-ink-300 hover:bg-paper-200"}`}>{g}</button>
                      ))}
                    </span>
                  ) : (
                    <span className={`kpi-num rounded-full px-2 py-0.5 text-[10px] font-bold ${GRADE_TONE[r.reliability]}`}>{r.reliability}</span>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-400">{tr("sr_note")}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Show your work: the whole chain behind one signal ────────────────
interface Prov {
  signal: { id: string; title: string; snippet?: string; url?: string; source?: string; publishedAt?: string; topicLabel?: string };
  collection: { sourceDomain?: string; reliability?: string; sourceKind?: string; ownerGroup?: string; credibility?: number; relevance?: number };
  dedupe: { clusterId?: string; canonical: boolean; syndicationCount: number; siblings: { id: string; title: string; source?: string; url?: string }[] };
  review: { status: string; by?: string; at?: string };
  sentiment: { score?: number; label?: string; confidence?: number };
  entities: { name: string; nameAr?: string; matchMethod: string; matchedOn: string; confidence: number; sentiment?: number; sentimentLabel?: string; sentimentConfidence: number }[];
  evidence: { fileId: string; sha256: string; size: number; kind: string; capturedAt: string; capturedBy?: string } | null;
}

function Provenance({ signalId, canManage, onClose }: { signalId: string; canManage: boolean; onClose: () => void }) {
  const { tr } = useI18n();
  const toast = useToast();
  const { data, reload } = useFetch<Prov>(`/osint/signals/${signalId}/provenance`, [signalId]);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-3 py-1 text-xs">
      <span className="shrink-0 text-ink-500">{k}</span><span className="text-end text-ink-800">{v}</span>
    </div>
  );
  return (
    <Modal open title={`⚖ ${tr("pv_title")}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm font-medium text-ink-900">{data.signal.title}</div>

        <div className="rounded-xl border border-paper-200 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("pv_collection")}</div>
          <Row k={tr("pv_source")} v={<span dir="ltr">{data.collection.sourceDomain || data.signal.source || "—"}</span>} />
          <Row k={tr("pv_reliability")} v={data.collection.reliability ? `${data.collection.reliability} · ${tr(`sr_g_${data.collection.reliability}`)}` : tr("pv_unrated")} />
          <Row k={tr("pv_credibility")} v={<span className="kpi-num" dir="ltr">{data.collection.credibility ?? "—"}</span>} />
          <Row k={tr("pv_relevance")} v={<span className="kpi-num" dir="ltr">{Math.round(Number(data.collection.relevance || 0) * 100)}%</span>} />
        </div>

        <div className="rounded-xl border border-paper-200 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("pv_dedupe")}</div>
          <Row k={tr("pv_canonical")} v={data.dedupe.canonical ? tr("pv_yes") : tr("pv_copy")} />
          <Row k={tr("pv_syndication")} v={<span className="kpi-num" dir="ltr">×{data.dedupe.syndicationCount || 1}</span>} />
          {data.dedupe.siblings.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {data.dedupe.siblings.slice(0, 5).map((s) => (
                <li key={s.id} className="truncate text-[10px] text-ink-400" dir="ltr">· {s.source || s.title}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-paper-200 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("pv_reading")}</div>
          <Row k={tr("pv_review")} v={`${tr(`pv_r_${data.review.status}`)}${data.review.by ? ` · ${data.review.by}` : ""}`} />
          <Row k={tr("pv_sentiment")} v={
            Number(data.sentiment.confidence) < 0.4
              ? <span className="text-ink-400">{tr("pv_unsure")}</span>
              : <span dir="ltr">{data.sentiment.label} ({Math.round(Number(data.sentiment.confidence) * 100)}%)</span>
          } />
          {data.entities.map((e, i) => (
            <div key={i} className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-paper-100 px-2 py-1 text-[11px]">
              <span className="truncate text-ink-800">{e.name}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-ink-500" dir="ltr">
                <span className="text-[9px]">{tr(`en_a_${e.matchMethod === "HANDLE" ? "HANDLE" : "EXACT"}`)}: {e.matchedOn}</span>
                {Number(e.sentimentConfidence) < 0.4
                  ? <span className="text-ink-400">?</span>
                  : <span className={e.sentimentLabel === "POS" ? "text-moss-600" : e.sentimentLabel === "NEG" ? "text-clay-600" : ""}>
                      {e.sentimentLabel}
                    </span>}
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-paper-200 p-2.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("pv_evidence")}</div>
          {data.evidence ? (
            <>
              <Row k={tr("pv_captured")} v={<span dir="ltr">{String(data.evidence.capturedAt).slice(0, 16).replace("T", " ")}</span>} />
              <Row k={tr("pv_by")} v={data.evidence.capturedBy || "—"} />
              <Row k={tr("pv_kind")} v={data.evidence.kind === "FULL" ? tr("pv_full") : tr("pv_partial")} />
              <Row k="SHA-256" v={<code className="kpi-num text-[9px]" dir="ltr">{data.evidence.sha256?.slice(0, 16)}…</code>} />
            </>
          ) : (
            <>
              <p className="py-1 text-xs text-ink-400">{tr("pv_noEvidence")}</p>
              {canManage && (
                <button disabled={busy} className="btn-ghost w-full text-xs"
                  onClick={async () => {
                    setBusy(true);
                    try { await api.post(`/osint/signals/${signalId}/snapshot`, {}); reload(); toast.push(tr("pv_saved"), "success"); }
                    catch (e) { toast.push((e as Error).message, "error"); }
                    finally { setBusy(false); }
                  }}>🔒 {tr("pv_preserve")}</button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── The system measuring its own accuracy, and saying so ─────────────
interface Tune {
  topicId: string; label: string; threshold: number; ruled: number; enough: boolean; note?: string;
  current?: { precision: number; recall: number };
  recommended?: { threshold: number; precision: number; recall: number };
  gain?: number;
}

function Tuning() {
  const { tr } = useI18n();
  const toast = useToast();
  const { data, reload } = useFetch<Tune[]>("/osint/tuning");
  const rows = (data || []).filter((t) => t.enough && t.gain !== undefined && t.gain > 2);
  if (!rows.length) return null;
  return (
    <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{tr("tn_title")}</div>
      {rows.map((t) => (
        <div key={t.topicId} className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="min-w-0">
            <span className="truncate text-ink-800">{t.label}</span>
            <span className="block text-[10px] text-ink-500" dir="ltr">
              {t.threshold} → {t.recommended!.threshold} · {tr("tn_precision")} {t.current!.precision}% → {t.recommended!.precision}%
            </span>
          </span>
          <button className="shrink-0 rounded-lg bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-700"
            onClick={async () => {
              try {
                await api.post(`/osint/topics/${t.topicId}/threshold`, { threshold: t.recommended!.threshold });
                reload(); toast.push(tr("tn_applied"), "success");
              } catch (e) { toast.push((e as Error).message, "error"); }
            }}>{tr("tn_apply")}</button>
        </div>
      ))}
      <p className="mt-1.5 text-[10px] text-ink-400">{tr("tn_hint")}</p>
    </div>
  );
}

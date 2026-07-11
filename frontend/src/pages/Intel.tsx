import { useState } from "react";
import { useFetch, Card, SectionTitle, Field, Select, Modal, StatusPill, Empty } from "../components/ui";
import { useToast } from "../components/Toast";
import { useI18n } from "../context/I18nContext";
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
                  </div>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer" className="mt-1 block font-medium text-ink-800 hover:text-amber-700">{s.title}</a>
                  ) : (
                    <div className="mt-1 font-medium text-ink-800">{s.title}</div>
                  )}
                  {!selected && s.topicLabel && <div className="text-xs text-ink-400">{s.topicLabel}</div>}
                </div>
                <button onClick={() => toLead(s.id)} className="shrink-0 rounded-lg border border-paper-300 px-2.5 py-1 text-xs text-ink-600 hover:bg-paper-100">
                  + {tr("intel_saveAsLead")}
                </button>
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
            <div className="col-span-2"><Field label={tr("intel_query")}><input className="input" dir="ltr" placeholder='Saria OR "ساريا"' value={editing.query || ""} onChange={(e) => setEditing({ ...editing, query: e.target.value })} /></Field></div>
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

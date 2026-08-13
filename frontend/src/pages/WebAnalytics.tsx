import { useState } from "react";
import { useFetch, Card, Modal, SkeletonCards } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";

// ═══ PULSE.JS — تحليلات الموقع: own your pixel ═══════════════════════

interface Site { id: string; name: string; domain?: string; snippetKey: string; active: boolean; events7d: number }
interface Stats {
  site: Site;
  days: { d: string; views: number; visitors: number }[];
  pages: { path: string; views: number }[];
  sources: { source: string; views: number }[];
}

export default function WebAnalytics() {
  const { tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const w = can("intel");
  const sites = useFetch<Site[]>("/sites");
  const [addM, setAddM] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "" });
  const [snip, setSnip] = useState<Site | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsFor, setStatsFor] = useState<string | null>(null);

  const origin = window.location.origin;
  const snippet = (key: string) => `<script defer src="${origin}/pulse.js" data-key="${key}"></script>`;

  const loadStats = async (s: Site) => {
    setStatsFor(s.id); setStats(null);
    setStats(await api.get<Stats>(`/sites/${s.id}/stats`));
  };

  const maxV = stats ? Math.max(1, ...stats.days.map((d) => d.views)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-900">{tr("web_title")}</h1>
          <p className="text-sm text-ink-500">{tr("web_sub")}</p>
        </div>
        {w && <button onClick={() => { setForm({ name: "", domain: "" }); setAddM(true); }} className="btn-amber">+ {tr("web_add")}</button>}
      </div>

      {sites.loading ? <SkeletonCards count={2} /> : !sites.data?.length ? (
        <Card className="p-8 text-center"><p className="text-sm font-medium text-ink-700">{tr("web_none")}</p><p className="mt-1 text-xs text-ink-400">{tr("web_noneHint")}</p></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sites.data.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-ink-900">🌐 {s.name}</div>
                  <div className="kpi-num mt-0.5 text-xs text-ink-500" dir="ltr">{s.domain || "—"} · {s.snippetKey}</div>
                </div>
                <div className="text-center">
                  <div className="kpi-num text-xl font-bold text-amber-700" dir="ltr">{s.events7d}</div>
                  <div className="text-[10px] text-ink-400">{tr("web_7d")}</div>
                </div>
              </div>
              <div className="mt-3 flex gap-2 text-xs">
                <button onClick={() => loadStats(s)} className="rounded-lg bg-amber-500/15 px-2.5 py-1 font-medium text-amber-700">📊 {tr("web_stats")}</button>
                <button onClick={() => setSnip(s)} className="rounded-lg bg-paper-200 px-2.5 py-1 text-ink-600 hover:bg-paper-300">&lt;/&gt; {tr("web_snippet")}</button>
              </div>

              {statsFor === s.id && (
                <div className="mt-4 border-t border-paper-200 pt-3">
                  {!stats ? <SkeletonCards count={1} /> : (
                    <div className="space-y-4">
                      {/* 14-day bars */}
                      <div>
                        <div className="mb-1 text-[11px] font-semibold text-ink-500">{tr("web_daily")}</div>
                        {!stats.days.length ? <p className="text-xs text-ink-400">{tr("web_quiet")}</p> : (
                          <div className="flex h-16 items-end gap-1" dir="ltr">
                            {stats.days.map((d) => (
                              <div key={d.d} className="group relative flex-1">
                                <div className="rounded-t bg-amber-500/70 transition-all group-hover:bg-amber-500" style={{ height: `${(d.views / maxV) * 56 + 4}px` }} />
                                <div className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-900 px-1.5 py-0.5 text-[9px] text-paper-50 group-hover:block">
                                  {d.views}v · {d.visitors}u
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="mb-1 font-semibold text-ink-500">{tr("web_pages")}</div>
                          {stats.pages.slice(0, 5).map((p) => (
                            <div key={p.path} className="flex justify-between gap-2 py-0.5">
                              <span className="kpi-num truncate text-ink-700" dir="ltr">{p.path}</span>
                              <span className="kpi-num text-ink-500" dir="ltr">{p.views}</span>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div className="mb-1 font-semibold text-ink-500">{tr("web_sources")}</div>
                          {stats.sources.slice(0, 5).map((p) => (
                            <div key={p.source} className="flex justify-between gap-2 py-0.5">
                              <span className="truncate text-ink-700" dir="ltr">{p.source}</span>
                              <span className="kpi-num text-ink-500" dir="ltr">{p.views}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {snip && (
        <Modal open title={`</> ${snip.name}`} onClose={() => setSnip(null)}>
          <div className="space-y-3">
            <p className="text-sm text-ink-600">{tr("web_snipExplain")}</p>
            <pre className="overflow-x-auto rounded-xl bg-ink-900 p-3 text-[11px] leading-relaxed text-paper-100" dir="ltr">{snippet(snip.snippetKey)}</pre>
            <button className="btn-amber w-full"
              onClick={() => { navigator.clipboard.writeText(snippet(snip.snippetKey)); toast.push(tr("copied"), "success"); }}>
              📋 {tr("web_copy")}
            </button>
            <p className="text-[11px] text-ink-400">{tr("web_events")}: <code className="kpi-num" dir="ltr">window.pulse("quote_request")</code></p>
          </div>
        </Modal>
      )}

      {addM && (
        <Modal open title={tr("web_add")} onClose={() => setAddM(false)}>
          <div className="space-y-3">
            <input className="input" placeholder={tr("web_name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="example.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} dir="ltr" />
            <button className="btn-amber w-full" disabled={!form.name}
              onClick={async () => {
                try { await api.post("/sites", form); setAddM(false); sites.reload(); toast.push(tr("web_minted"), "success"); }
                catch (e) { toast.push((e as Error).message, "error"); }
              }}>{tr("save")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

import { useState } from "react";
import { useFetch, Card, SectionTitle } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";

// ═══ LIVE SEARCH (Wave 3·D) ══════════════════════════════════════════
// Two surfaces: asking the corpus a question, and reaching out for more.
// Everything gathered still enters through the same validation pipeline
// as an RSS feed — nothing here shortcuts the review queue.

interface Budget {
  provider: string; active: boolean; monthlyCapUsd: number; costPerUnit: number;
  spentThisMonth: number; pctOfCap: number; free: boolean;
}
interface Ask {
  ok: boolean; answer?: string; abstained?: boolean; reason?: string; corpusSize: number;
  citations?: { id: string; text: string }[]; hint?: string | null;
}
interface Run {
  provider: string; query: string; results: number; ingested: number; quarantined?: number;
  costUsd: number; status: string; detail?: string; runByName?: string; at: string;
}

const TONE: Record<string, string> = {
  OK: "bg-moss-500", CAPPED: "bg-amber-500", FAILED: "bg-clay-500", EMPTY: "bg-ink-300",
};

// ── Ask the corpus ───────────────────────────────────────────────────
export function AskListening() {
  const { tr } = useI18n();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Ask | null>(null);

  const ask = async () => {
    if (!q.trim()) return;
    setBusy(true); setRes(null);
    try { setRes(await api.post<Ask>("/search/ask", { question: q })); }
    catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <SectionTitle>💬 {tr("sq_askTitle")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("sq_askSub")}</p>
      <div className="flex gap-2">
        <input className="input flex-1" placeholder={tr("sq_askPlaceholder")} value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} />
        <button onClick={ask} disabled={busy || !q.trim()} className="btn-amber shrink-0">
          {busy ? "…" : tr("sq_ask")}
        </button>
      </div>

      {res && (
        <div className="mt-3">
          {res.ok ? (
            <>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">{res.answer}</p>
              {!!res.citations?.length && (
                <div className="mt-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("sq_from")}</div>
                  <ul className="mt-1 space-y-0.5">
                    {res.citations.map((c, i) => (
                      <li key={i} className="text-[11px] text-ink-600">· {c.text}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl bg-paper-100 px-3 py-2">
              <p className="text-sm text-ink-600">
                {res.abstained ? tr("sq_abstained") : res.reason}
              </p>
              <p className="mt-1 text-[11px] text-ink-400">
                {tr("sq_corpus")}: <span className="kpi-num" dir="ltr">{res.corpusSize}</span>
                {res.hint ? ` · ${res.hint}` : ""}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Providers, budgets, and what they've been used for ───────────────
export function LiveSearch({ topicId }: { topicId?: string | null }) {
  const { tr } = useI18n();
  const { isAdmin, can } = useAuth();
  const toast = useToast();
  const { data, reload } = useFetch<{ providers: Record<string, Budget> }>("/search/budgets");
  const runs = useFetch<Run[]>("/search/runs");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("WEB");
  const [busy, setBusy] = useState(false);
  const writable = can("intel", "write");
  const providers = Object.values(data?.providers || {});
  if (!providers.length) return null;

  const search = async () => {
    if (!topicId || !query.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; ingested: number; quarantined: number; degradedFrom?: string; error?: string }>(
        `/search/topics/${topicId}/search`, { query, provider });
      if (!r.ok) toast.push(r.error || tr("sq_failed"), "error");
      else {
        toast.push(
          `${r.ingested} ${tr("sq_kept")}${r.quarantined ? ` · ${r.quarantined} ${tr("sq_quarantined")}` : ""}`,
          "success");
        if (r.degradedFrom) toast.push(`${tr("sq_degraded")} ${r.degradedFrom}`, "info");
      }
      reload(); runs.reload();
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle>🔎 {tr("sq_title")}</SectionTitle>
          <p className="-mt-1 text-sm text-ink-500">{tr("sq_sub")}</p>
        </div>
        <button onClick={() => setOpen(!open)} className="btn-ghost text-xs">{open ? "▾" : "▸"}</button>
      </div>

      {open && (
        <div className="mt-3 space-y-4">
          {/* run one */}
          {writable && topicId && (
            <div className="flex flex-wrap gap-2">
              <select className="input w-32" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {providers.filter((p) => p.active).map((p) => (
                  <option key={p.provider} value={p.provider}>{tr(`sq_p_${p.provider}`)}</option>
                ))}
              </select>
              <input className="input flex-1" placeholder={tr("sq_query")} value={query}
                onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
              <button onClick={search} disabled={busy || !query.trim()} className="btn-amber shrink-0">
                {busy ? "…" : tr("sq_run")}
              </button>
            </div>
          )}
          <p className="text-[11px] text-ink-400">{tr("sq_pipelineNote")}</p>

          {/* budgets */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("sq_budgets")}</div>
            <div className="mt-1.5 space-y-2">
              {providers.map((p) => (
                <div key={p.provider}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2 text-ink-700">
                      {tr(`sq_p_${p.provider}`)}
                      {p.free && <span className="rounded-full bg-moss-100 px-1.5 py-0.5 text-[10px] text-moss-700">{tr("sq_free")}</span>}
                      {!p.active && <span className="text-[10px] text-ink-400">{tr("sq_off")}</span>}
                    </span>
                    <span className="kpi-num shrink-0 text-[11px] text-ink-500" dir="ltr">
                      {p.free ? "—" : `$${Number(p.spentThisMonth).toFixed(2)} / $${p.monthlyCapUsd}`}
                    </span>
                  </div>
                  {!p.free && (
                    <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-paper-200">
                      <div className={`h-full rounded-full ${p.pctOfCap >= 100 ? "bg-clay-500" : p.pctOfCap >= 80 ? "bg-amber-500" : "bg-moss-500"}`}
                        style={{ width: `${Math.min(100, p.pctOfCap)}%` }} />
                    </div>
                  )}
                  {isAdmin && !p.free && (
                    <input type="number" className="input mt-1 h-7 text-[11px]" dir="ltr"
                      placeholder={`${tr("sq_cap")} ($)`} defaultValue={p.monthlyCapUsd}
                      onBlur={async (e) => {
                        const v = Number(e.target.value);
                        if (v === Number(p.monthlyCapUsd)) return;
                        try { await api.patch(`/search/budgets/${p.provider}`, { monthlyCapUsd: v }); reload(); toast.push(tr("saved"), "success"); }
                        catch (err) { toast.push((err as Error).message, "error"); }
                      }} />
                  )}
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-ink-400">{tr("sq_capNote")}</p>
          </div>

          {/* history */}
          {!!runs.data?.length && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{tr("sq_recent")}</div>
              <div className="mt-1 space-y-0.5">
                {runs.data.slice(0, 8).map((r, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${TONE[r.status] || "bg-ink-300"}`} />
                      <span className="truncate text-ink-600">{r.query}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-400" dir="ltr">
                      {r.provider} · {r.ingested}/{r.results}
                      {Number(r.costUsd) > 0 ? ` · $${Number(r.costUsd).toFixed(3)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

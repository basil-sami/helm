import { useState } from "react";
import { useFetch, Card, SectionTitle, Modal } from "../components/ui";
import { api } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useToast } from "../components/Toast";

// ═══ ENTITIES · SHARE OF VOICE · CASE FILES (W2·E P2/P3) ═════════════

export interface Entity {
  id: string; kind: string; name: string; nameAr?: string; country?: string;
  isSelf: boolean; active: boolean; aliasCount: number; mentions: number; competitorName?: string;
}
interface Alias { id: string; surface: string; lang: string; kind: string; weight: number }
interface Candidate { id: string; platform: string; handle: string; url?: string; similarity: number; status: string; evidence?: { title?: string; description?: string } }
interface Sov {
  total: number; ownPct: number;
  entities: { id: string; name: string; nameAr?: string; isSelf: boolean; mentions: number;
    sovPct: number; avgSentiment: number | null; pos: number; neg: number; unsure: number }[];
}
interface CaseRow { id: string; title: string; titleAr?: string; question?: string; status: string; ownerName?: string; items: number; summary?: string }
interface CaseItem { id: string; signalId?: string; title?: string; url?: string; source?: string; publishedAt?: string; note?: string; entityName?: string; snapshotFileId?: string; addedByName?: string }

const KINDS = ["ORG", "BRAND", "PRODUCT", "OUTLET", "PUBLIC_FIGURE"];
const ALIAS_KINDS = ["EXACT", "TRANSLITERATION", "ABBREVIATION", "HANDLE", "MISSPELLING"];

// ── Entities + share of voice ────────────────────────────────────────
export function Entities({ canManage }: { canManage: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data, reload } = useFetch<Entity[]>("/osint/entities");
  const sov = useFetch<Sov>("/osint/sov");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<Partial<Entity> | null>(null);
  const [aliasFor, setAliasFor] = useState<Entity | null>(null);
  const [aliases, setAliases] = useState<Alias[] | null>(null);
  const [newAlias, setNewAlias] = useState({ surface: "", lang: "ar", kind: "EXACT" });
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const rows = data || [];

  const loadAliases = async (e: Entity) => {
    setAliasFor(e); setAliases(null); setCands(null);
    setAliases(await api.get<Alias[]>(`/osint/entities/${e.id}/aliases`));
    api.get<Candidate[]>(`/osint/entities/${e.id}/handles`).then(setCands).catch(() => setCands([]));
  };

  const save = async () => {
    if (!adding?.name && !adding?.nameAr) return;
    try {
      await api.post("/osint/entities", adding);
      setAdding(null); reload(); sov.reload(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  const bar = (pct: number, isSelf: boolean) => (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-200">
      <div className={`h-full rounded-full ${isSelf ? "bg-amber-500" : "bg-ink-400"}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle>🎯 {tr("en_title")}</SectionTitle>
          <p className="-mt-1 text-sm text-ink-500">{tr("en_sub")}</p>
        </div>
        <button onClick={() => setOpen(!open)} className="btn-ghost text-xs">{open ? "▾" : "▸"}</button>
      </div>

      {open && (
        <div className="mt-3 space-y-4">
          {/* share of voice, computed from entity links */}
          {sov.data && sov.data.total > 0 && (
            <div>
              <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-ink-400">
                <span>{tr("en_sov")}</span>
                <span className="kpi-num text-amber-700" dir="ltr">{sov.data.ownPct}%</span>
              </div>
              <div className="mt-1.5 space-y-2">
                {sov.data.entities.slice(0, 8).map((e) => (
                  <div key={e.id}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={`truncate ${e.isSelf ? "font-semibold text-amber-700" : "text-ink-700"}`}>
                        {lang === "ar" && e.nameAr ? e.nameAr : e.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2" dir="ltr">
                        {e.pos > 0 && <span className="text-[10px] text-moss-600">▲{e.pos}</span>}
                        {e.neg > 0 && <span className="text-[10px] text-clay-600">▼{e.neg}</span>}
                        {e.unsure > 0 && <span className="text-[10px] text-ink-400" title={tr("en_unsureHint")}>?{e.unsure}</span>}
                        <span className="kpi-num font-bold text-ink-900">{e.sovPct}%</span>
                      </span>
                    </div>
                    <div className="mt-0.5">{bar(e.sovPct, e.isSelf)}</div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-ink-400">{tr("en_sovHint")}</p>
            </div>
          )}

          {/* the entities themselves */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{tr("en_entities")}</span>
              {canManage && (
                <button onClick={() => setAdding({ kind: "ORG" })} className="text-[11px] font-medium text-amber-700 hover:underline">
                  + {tr("en_add")}
                </button>
              )}
            </div>
            <div className="mt-1 space-y-1">
              {rows.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-paper-100">
                  <span className="flex min-w-0 items-center gap-2">
                    {e.isSelf && <span title={tr("en_self")}>⭐</span>}
                    <span className="truncate text-xs text-ink-800">{lang === "ar" && e.nameAr ? e.nameAr : e.name}</span>
                    <span className="rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] text-ink-500">{tr(`en_k_${e.kind}`)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[10px] text-ink-400" dir="ltr">
                    <span>{e.mentions} {tr("en_mentions")}</span>
                    {canManage && (
                      <button onClick={() => loadAliases(e)} className="text-amber-700 hover:underline">
                        {e.aliasCount} {tr("en_aliases")}
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {!rows.length && <p className="text-xs text-ink-400">{tr("en_none")}</p>}
            </div>
            <p className="mt-1.5 text-[10px] text-ink-400">{tr("en_guardrail")}</p>
          </div>
        </div>
      )}

      {adding && (
        <Modal open title={tr("en_add")} onClose={() => setAdding(null)}>
          <div className="space-y-3">
            <input className="input" placeholder={tr("en_name")} value={adding.name || ""} onChange={(e) => setAdding({ ...adding, name: e.target.value })} dir="ltr" />
            <input className="input" placeholder={tr("en_nameAr")} value={adding.nameAr || ""} onChange={(e) => setAdding({ ...adding, nameAr: e.target.value })} dir="rtl" />
            <select className="input" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })}>
              {KINDS.map((k) => <option key={k} value={k}>{tr(`en_k_${k}`)}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" className="accent-amber-500" checked={!!adding.isSelf} onChange={(e) => setAdding({ ...adding, isSelf: e.target.checked })} />
              ⭐ {tr("en_isSelf")}
            </label>
            <p className="text-[11px] text-ink-400">{tr("en_guardrail")}</p>
            <button onClick={save} className="btn-amber w-full">{tr("save")}</button>
          </div>
        </Modal>
      )}

      {aliasFor && (
        <Modal open title={`${aliasFor.name} — ${tr("en_aliases")}`} onClose={() => { setAliasFor(null); reload(); }}>
          <div className="space-y-3">
            <p className="text-xs text-ink-500">{tr("en_aliasHint")}</p>
            {!aliases ? <p className="text-sm text-ink-400">…</p> : (
              <div className="space-y-1">
                {aliases.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper-100 px-2 py-1.5 text-xs">
                    <span className="truncate text-ink-800">{a.surface}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] text-ink-500">{tr(`en_a_${a.kind}`)}</span>
                      <button onClick={async () => { await api.del(`/osint/aliases/${a.id}`); loadAliases(aliasFor); }}
                        className="text-clay-600 hover:underline">✕</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input className="input flex-1" placeholder={tr("en_aliasNew")} value={newAlias.surface}
                onChange={(e) => setNewAlias({ ...newAlias, surface: e.target.value })} />
              <select className="input w-40" value={newAlias.kind} onChange={(e) => setNewAlias({ ...newAlias, kind: e.target.value })}>
                {ALIAS_KINDS.map((k) => <option key={k} value={k}>{tr(`en_a_${k}`)}</option>)}
              </select>
            </div>
            <div className="rounded-xl border border-paper-200 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{tr("dc_title")}</span>
                <button disabled={discovering} className="text-[11px] font-medium text-amber-700 hover:underline"
                  onClick={async () => {
                    setDiscovering(true);
                    try {
                      const r = await api.post<{ candidates: number }>(`/osint/entities/${aliasFor.id}/discover`, {});
                      setCands(await api.get(`/osint/entities/${aliasFor.id}/handles`));
                      toast.push(`${r.candidates} ${tr("dc_found")}`, "success");
                    } catch (e) { toast.push((e as Error).message, "error"); }
                    finally { setDiscovering(false); }
                  }}>{discovering ? tr("dc_searching") : `🔍 ${tr("dc_run")}`}</button>
              </div>
              {(cands || []).filter((c) => c.status === "PENDING").map((c) => (
                <div key={c.id} className="mt-1.5 rounded-lg bg-paper-100 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="kpi-num text-xs text-ink-800" dir="ltr">{c.platform} · @{c.handle}</span>
                      <span className="block truncate text-[10px] text-ink-400">{c.evidence?.title}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="kpi-num text-[10px] text-ink-500" dir="ltr">{Math.round(c.similarity * 100)}%</span>
                      <button onClick={async () => {
                        await api.post(`/osint/handles/${c.id}/decide`, { status: "CONFIRMED" });
                        setCands(await api.get(`/osint/entities/${aliasFor.id}/handles`)); loadAliases(aliasFor);
                      }} className="rounded bg-moss-100 px-2 py-0.5 text-[10px] font-medium text-moss-700">✓</button>
                      <button onClick={async () => {
                        await api.post(`/osint/handles/${c.id}/decide`, { status: "REJECTED" });
                        setCands(await api.get(`/osint/entities/${aliasFor.id}/handles`));
                      }} className="rounded bg-clay-100 px-2 py-0.5 text-[10px] font-medium text-clay-700">✕</button>
                    </span>
                  </div>
                </div>
              ))}
              <p className="mt-1.5 text-[10px] text-ink-400">{tr("dc_hint")}</p>
            </div>

            <button className="btn-amber w-full" disabled={!newAlias.surface}
              onClick={async () => {
                try {
                  await api.post(`/osint/entities/${aliasFor.id}/aliases`, newAlias);
                  setNewAlias({ surface: "", lang: "ar", kind: "EXACT" }); loadAliases(aliasFor);
                } catch (e) { toast.push((e as Error).message, "error"); }
              }}>{tr("en_addAlias")}</button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ── Case files ───────────────────────────────────────────────────────
export function Cases({ canManage }: { canManage: boolean }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data, reload } = useFetch<CaseRow[]>("/osint/cases");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<{ title: string; titleAr: string; question: string } | null>(null);
  const [viewing, setViewing] = useState<CaseRow | null>(null);
  const [items, setItems] = useState<CaseItem[] | null>(null);
  const rows = data || [];

  const load = async (c: CaseRow) => {
    setViewing(c); setItems(null);
    setItems(await api.get<CaseItem[]>(`/osint/cases/${c.id}/items`));
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle>🗂 {tr("cs_title")}</SectionTitle>
          <p className="-mt-1 text-sm text-ink-500">{tr("cs_sub")}</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && open && (
            <button onClick={() => setAdding({ title: "", titleAr: "", question: "" })} className="text-[11px] font-medium text-amber-700 hover:underline">
              + {tr("cs_add")}
            </button>
          )}
          <button onClick={() => setOpen(!open)} className="btn-ghost text-xs">{open ? "▾" : "▸"}</button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-1">
          {!rows.length ? <p className="text-xs text-ink-400">{tr("cs_none")}</p> : rows.map((c) => (
            <button key={c.id} onClick={() => load(c)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-start hover:bg-paper-100">
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink-800">{lang === "ar" && c.titleAr ? c.titleAr : c.title}</span>
                {c.question && <span className="block truncate text-[11px] text-ink-400">{c.question}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="kpi-num text-[10px] text-ink-400" dir="ltr">{c.items}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  c.status === "OPEN" ? "bg-amber-500/15 text-amber-700" : "bg-moss-100 text-moss-700"}`}>
                  {tr(`cs_${c.status}`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {adding && (
        <Modal open title={tr("cs_add")} onClose={() => setAdding(null)}>
          <div className="space-y-3">
            <input className="input" placeholder={tr("cs_t")} value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} />
            <input className="input" placeholder={tr("cs_tAr")} value={adding.titleAr} onChange={(e) => setAdding({ ...adding, titleAr: e.target.value })} dir="rtl" />
            <textarea className="input min-h-20" placeholder={tr("cs_q")} value={adding.question} onChange={(e) => setAdding({ ...adding, question: e.target.value })} />
            <button className="btn-amber w-full" disabled={!adding.title}
              onClick={async () => {
                try { await api.post("/osint/cases", adding); setAdding(null); reload(); toast.push(tr("saved"), "success"); }
                catch (e) { toast.push((e as Error).message, "error"); }
              }}>{tr("cs_open")}</button>
          </div>
        </Modal>
      )}

      {viewing && (
        <Modal open title={lang === "ar" && viewing.titleAr ? viewing.titleAr : viewing.title} onClose={() => { setViewing(null); reload(); }}>
          <div className="space-y-3">
            {viewing.question && <p className="rounded-xl bg-paper-100 px-3 py-2 text-sm text-ink-700">{viewing.question}</p>}
            <div className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{tr("cs_timeline")}</div>
            {!items ? <p className="text-sm text-ink-400">…</p> : !items.length ? (
              <p className="text-xs text-ink-400">{tr("cs_empty")}</p>
            ) : (
              <ol className="space-y-2 border-s-2 border-paper-200 ps-3">
                {items.map((i) => (
                  <li key={i.id}>
                    <div className="text-xs font-medium text-ink-800">{i.title || i.entityName || tr("cs_note")}</div>
                    {i.note && <div className="text-[11px] text-ink-500">{i.note}</div>}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-400" dir="ltr">
                      {i.source && <span>{i.source}</span>}
                      {i.publishedAt && <span>{String(i.publishedAt).slice(0, 10)}</span>}
                      {i.snapshotFileId && <span title={tr("cs_preserved")}>🔒 {tr("cs_evidence")}</span>}
                      {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="text-amber-700 hover:underline">↗</a>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {canManage && viewing.status === "OPEN" && (
              <button className="btn-ghost w-full text-xs"
                onClick={async () => {
                  await api.patch(`/osint/cases/${viewing.id}`, { status: "CLOSED" });
                  setViewing(null); reload(); toast.push(tr("cs_closed"), "success");
                }}>✓ {tr("cs_close")}</button>
            )}
          </div>
        </Modal>
      )}
    </Card>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../context/I18nContext";
import { applyAccent } from "../lib/theme";
import PulseMark from "../components/PulseMark";
import { StatusPill } from "../components/ui";
import { fmtDate } from "../lib/format";

// ── THE PORTAL (/p/:token) — the vendor's workroom ───────────────────
// No account, no password: the link IS the key. The vendor sees only
// their deliverables + briefs + the shared thread + the Brand Center,
// submits links, and gets the ECG confirmation wave — the signature.

interface Deliv { id: string; title: string; status: string; dueDate?: string; revisionCount: number;
  submittedUrl?: string; submittedAt?: string; approvedAt?: string; engagementTitle?: string;
  briefTitle?: string; briefSpec?: string; briefFormat?: string; briefDueDate?: string; briefRefs?: string[] | string }
interface Comment { deliverableId: string; author: string; authorName: string; body: string; createdAt: string }
interface Payload { vendor: { name: string }; org: { orgName?: string; orgNameAr?: string; logoUrl?: string; accentColor?: string } | null;
  deliverables: Deliv[]; comments: Comment[]; brand: { kind: string; label: string; labelAr?: string; value?: string; url?: string }[] }

const OPEN_FOR_SUBMIT = ["BRIEFED", "IN_PROGRESS", "REVISION"];

export default function Portal({ token }: { token: string }) {
  const { lang, tr, setLang } = useI18n();
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");
  const [wave, setWave] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setData(j); setErr("");
      if (j.org?.accentColor) applyAccent(j.org.accentColor);
    } catch (e) { setErr((e as Error).message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const orgName = data?.org ? (lang === "ar" ? data.org.orgNameAr || data.org.orgName : data.org.orgName) : "";

  if (err) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink-950 px-6 text-center">
        <div>
          <PulseMark className="mx-auto mb-4 h-12 w-12 text-ink-500" />
          <h1 className="text-lg font-semibold text-paper-50">{tr("pt_expiredTitle")}</h1>
          <p className="mt-1 text-sm text-paper-50/50">{tr("pt_expiredSub")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-paper-50">
      {/* Signature: the confirmation wave */}
      {wave && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-ink-950/70 backdrop-blur-sm animate-fade-in">
          <div className="text-center">
            <svg viewBox="0 0 200 48" className="mx-auto h-12 w-48 text-amber-500">
              <path d="M0 24 H56 L68 24 74 8 82 40 90 24 H144 L200 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" pathLength={100}
                style={{ strokeDasharray: 100, strokeDashoffset: 100, animation: "pulse-draw 1.1s ease-out forwards" }} />
            </svg>
            <div className="mt-2 text-sm font-medium text-paper-50">{tr("pt_received")}</div>
          </div>
          <style>{`@keyframes pulse-draw { to { stroke-dashoffset: 0; } }`}</style>
        </div>
      )}

      <header className="bg-ink-950 px-5 pb-8 pt-6 text-paper-50">
        <div className="mx-auto flex max-w-2xl items-start justify-between">
          <div className="flex items-center gap-3">
            {data?.org?.logoUrl ? <img src={data.org.logoUrl} alt="" className="h-9 w-9 rounded-xl bg-white/10 object-contain p-1" /> : <PulseMark className="h-9 w-9 text-amber-500" />}
            <div>
              <div className="text-[11px] uppercase tracking-wide text-paper-50/50">{orgName} · {tr("pt_portal")}</div>
              <h1 className="text-lg font-semibold">{data?.vendor.name || "…"}</h1>
            </div>
          </div>
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-paper-50/80 hover:bg-white/10">
            {lang === "ar" ? "EN" : "عربي"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        <p className="text-sm text-ink-500">{tr("pt_welcome")}</p>
        {data && data.deliverables.length === 0 && <p className="py-14 text-center text-ink-400">{tr("pt_empty")}</p>}
        {(data?.deliverables || []).map((d) => (
          <DelivCard key={d.id} d={d} token={token} comments={(data?.comments || []).filter((c) => c.deliverableId === d.id)}
            onDone={() => { setWave(true); setTimeout(() => setWave(false), 1700); load(); }} onComment={load} />
        ))}
        <footer className="flex items-center justify-between border-t border-paper-200 pt-4 text-[11px] text-ink-300">
          <span>Pulse · نبض</span>
          <a href="/brand" target="_blank" rel="noreferrer" className="text-steel-600 hover:underline">{tr("pt_brandLink")} ↗</a>
        </footer>
      </main>
    </div>
  );
}

function DelivCard({ d, token, comments, onDone, onComment }: { d: Deliv; token: string; comments: Comment[]; onDone: () => void; onComment: () => void }) {
  const { lang, tr } = useI18n();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const canSubmit = OPEN_FOR_SUBMIT.includes(d.status);
  const refs: string[] = Array.isArray(d.briefRefs) ? d.briefRefs : (() => { try { return JSON.parse(String(d.briefRefs || "[]")); } catch { return []; } })();

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/deliverables/${d.id}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, note }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Error");
      setUrl(""); setNote(""); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const comment = async () => {
    if (!body.trim()) return;
    await fetch(`/api/portal/${encodeURIComponent(token)}/deliverables/${d.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }),
    });
    setBody(""); onComment();
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink-800">{d.title}</h2>
          <div className="text-xs text-ink-400">
            {d.engagementTitle}
            {d.dueDate && <> · {tr("pt_due")} {fmtDate(d.dueDate, lang)}</>}
            {d.revisionCount > 0 && <> · {tr("pt_round")} {d.revisionCount + 1}</>}
          </div>
        </div>
        <StatusPill value={d.status} />
      </div>

      {(d.briefSpec || d.briefFormat) && (
        <div className="rounded-xl bg-paper-100/70 px-3 py-2.5 text-sm text-ink-700">
          {d.briefTitle && <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{d.briefTitle}</div>}
          {d.briefSpec && <p className="whitespace-pre-wrap">{d.briefSpec}</p>}
          <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-ink-500">
            {d.briefFormat && <span dir="ltr">{d.briefFormat}</span>}
            {d.briefDueDate && <span>{tr("pt_due")} {fmtDate(d.briefDueDate, lang)}</span>}
            {refs.map((r, i) => <a key={i} href={r} target="_blank" rel="noreferrer" className="text-steel-600 hover:underline" dir="ltr">ref {i + 1} ↗</a>)}
          </div>
        </div>
      )}

      {d.submittedUrl && (
        <div className="text-xs text-ink-500">
          {tr("pt_lastSubmission")}: <a href={d.submittedUrl} target="_blank" rel="noreferrer" className="text-steel-600 hover:underline" dir="ltr">{d.submittedUrl}</a>
        </div>
      )}

      {comments.length > 0 && (
        <div className="space-y-1.5">
          {comments.map((c, i) => (
            <div key={i} className={`rounded-xl px-3 py-2 text-sm ${c.author === "VENDOR" ? "bg-amber-500/10 text-ink-800" : "bg-paper-100 text-ink-700"}`}>
              <div className="mb-0.5 text-[11px] text-ink-400">{c.authorName} · {fmtDate(c.createdAt, lang)}</div>
              {c.body}
            </div>
          ))}
        </div>
      )}

      {canSubmit ? (
        <div className="space-y-2 rounded-xl border border-dashed border-paper-300 p-3">
          <div className="text-xs font-medium text-ink-600">{d.status === "REVISION" ? tr("pt_resubmit") : tr("pt_submitWork")}</div>
          <input className="input" dir="ltr" placeholder="https://drive… / https://wetransfer…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input" placeholder={tr("pt_notePh")} value={note} onChange={(e) => setNote(e.target.value)} />
          {err && <div className="rounded-lg bg-clay-500/10 px-3 py-1.5 text-xs text-clay-600">{err}</div>}
          <button onClick={submit} disabled={busy || !url} className="btn-amber w-full disabled:opacity-50">{busy ? "…" : tr("pt_send")}</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input className="input flex-1" placeholder={tr("pt_reply")} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && comment()} />
          <button onClick={comment} className="btn-ghost">{tr("send")}</button>
        </div>
      )}
    </div>
  );
}

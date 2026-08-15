import { useEffect, useRef, useState } from "react";
import { Modal, Select, useFetch } from "./ui";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";

// ═══ UI·DEBT2 · THE IMPORT WIZARD GETS ITS DOOR ═══════════════════════
// W4·B shipped a five-state import machine (UPLOADED → MAPPED →
// VALIDATED → PREVIEWED → COMMITTED) that no page could reach. This is
// its one door, reused by Leads, Contacts, and Customers. The job's
// status IS the stepper — the UI never invents a sixth state, and every
// refusal is the matrix speaking, shown verbatim.

interface Target { entity: string; required: string[]; fields: string[] }
interface Job {
  id: string; entity: string; status: string; filename?: string;
  header: string[]; mapping: Record<string, string>;
  stats?: { rows?: number; valid?: number; invalid?: number; toCreate?: number; willUpdate?: number; duplicates?: number; created?: number; updated?: number; skipped?: number };
  errors?: { row: number; reason: string }[];
}
const STEPS = ["UPLOADED", "MAPPED", "VALIDATED", "PREVIEWED", "COMMITTED"] as const;

export function ImportWizard({ entity, onClose, onDone }:
  { entity: "leads" | "contacts" | "conversions"; onClose: () => void; onDone: () => void }) {
  const { tr } = useI18n();
  const { data: targets } = useFetch<Target[]>("/imports/targets");
  const target = (targets || []).find((t) => t.entity === entity);
  const [job, setJob] = useState<Job | null>(null);
  const [sample, setSample] = useState<string[][]>([]);
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [dedupeOn, setDedupeOn] = useState("");
  const [merge, setMerge] = useState("merge");
  const [consentBasis, setConsentBasis] = useState("");
  const [consentSource, setConsentSource] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMsg(""); }, [job?.status]);

  const call = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true); setMsg("");
    try { return await fn(); }
    catch (e) { setMsg((e as Error).message); return null; }
    finally { setBusy(false); }
  };

  const upload = () => call(async () => {
    const r = await api.post<Job & { sampleRows: string[][] }>("/imports", { entity, csv, filename: filename || undefined });
    setJob(r); setSample(r.sampleRows || []);
  });
  const pickFile = (f: File | null) => {
    if (!f) return;
    setFilename(f.name);
    const rd = new FileReader();
    rd.onload = () => setCsv(String(rd.result || ""));
    rd.readAsText(f);
  };
  const saveMapping = () => call(async () => {
    const r = await api.patch<Job>(`/imports/${job!.id}/mapping`, {
      mapping: job!.mapping, dedupeOn: dedupeOn || null, mergeStrategy: merge,
      consentBasis: consentBasis || null, consentSource: consentSource || null,
    });
    setJob(r);
  });
  const validate = () => call(async () => setJob(await api.post<Job>(`/imports/${job!.id}/validate`, {})));
  const preview = () => call(async () => {
    const r = await api.post<Job & { sample?: Record<string, unknown>[] }>(`/imports/${job!.id}/preview`, {});
    setJob(r);
  });
  const commit = () => call(async () => { setJob(await api.post<Job>(`/imports/${job!.id}/commit`, {})); });
  const cancel = () => call(async () => { if (job) await api.post(`/imports/${job.id}/cancel`, {}); onClose(); });

  const setMap = (field: string, header: string) => {
    const m = { ...(job!.mapping || {}) };
    if (header) m[field] = header; else delete m[field];
    setJob({ ...job!, mapping: m });
  };
  const stepIdx = job ? STEPS.indexOf(job.status as (typeof STEPS)[number]) : -1;
  const st = job?.stats || {};

  return (
    <Modal open onClose={job?.status === "COMMITTED" ? onDone : onClose} title={`⬆ ${tr("imp_title")} — ${tr(`imp_${entity}`)}`}>
      <div className="space-y-3">
        {/* the machine, visible */}
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          {STEPS.map((s, i) => (
            <span key={s} className={`rounded-full px-2 py-0.5 font-semibold ${
              i < stepIdx ? "bg-moss-500/12 text-moss-700" : i === stepIdx ? "bg-amber-500/15 text-amber-700" : "bg-paper-100 text-ink-400"}`}>
              {tr(`imp_s_${s}`)}
            </span>
          ))}
        </div>
        {msg && <p className="rounded-lg bg-clay-500/10 px-2.5 py-1.5 text-xs text-clay-700" dir="auto">{msg}</p>}

        {/* ── 1 · paste or pick the file ── */}
        {!job && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} className="btn-ghost text-xs">📄 {tr("imp_pickFile")}</button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
              {filename && <span className="text-xs text-ink-500" dir="ltr">{filename}</span>}
            </div>
            <textarea className="input min-h-36 font-mono text-[11px]" dir="ltr" placeholder={"company,email,phone\nSaria Solar,info@saria.sd,+2499…"}
              value={csv} onChange={(e) => setCsv(e.target.value)} />
            <p className="text-[11px] text-ink-400">{tr("imp_uploadHint")}</p>
            <button onClick={upload} disabled={busy || csv.trim().length < 3} className="btn-amber text-xs">{tr("imp_upload")}</button>
          </div>
        )}

        {/* ── 2 · mapping: which column feeds which field ── */}
        {job?.status === "UPLOADED" && target && (
          <div className="space-y-2">
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-paper-200 bg-white p-2">
              {target.fields.map((f) => (
                <div key={f} className="grid grid-cols-2 items-center gap-2 text-xs">
                  <span className="text-ink-700" dir="ltr">
                    {target.required.includes(f) && <b className="text-amber-600">● </b>}{f}
                  </span>
                  <Select value={job.mapping[f] || ""} onChange={(v: string) => setMap(f, v)} placeholder="—"
                    options={job.header.map((h) => ({ value: h, label: h }))} />
                </div>
              ))}
            </div>
            {sample.length > 0 && (
              <div className="overflow-x-auto rounded-lg bg-paper-100/70 p-2 text-[10px] text-ink-500" dir="ltr">
                {sample.slice(0, 2).map((r, i) => <div key={i} className="truncate">{r.join(" · ")}</div>)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="label">{tr("imp_dedupeOn")}</span>
                <Select value={dedupeOn} onChange={(v: string) => setDedupeOn(v)} placeholder={tr("none")}
                  options={target.fields.filter((f) => f === "email" || f === "phone").map((f) => ({ value: f, label: f }))} />
              </div>
              <div>
                <span className="label">{tr("imp_merge")}</span>
                <Select value={merge} onChange={(v: string) => setMerge(v)}
                  options={[{ value: "merge", label: tr("imp_mergeMerge") }, { value: "skip", label: tr("imp_mergeSkip") }]} />
              </div>
            </div>
            {entity === "contacts" && (
              <div className="grid grid-cols-2 gap-2">
                <input className="input h-9 text-xs" dir="auto" placeholder={tr("imp_consentBasis")} value={consentBasis} onChange={(e) => setConsentBasis(e.target.value)} />
                <input className="input h-9 text-xs" dir="auto" placeholder={tr("imp_consentSource")} value={consentSource} onChange={(e) => setConsentSource(e.target.value)} />
              </div>
            )}
            <button onClick={saveMapping} disabled={busy} className="btn-amber text-xs">{tr("imp_saveMapping")}</button>
          </div>
        )}

        {/* ── 3 · validate ── */}
        {job?.status === "MAPPED" && (
          <button onClick={validate} disabled={busy} className="btn-amber text-xs">🔎 {tr("imp_validate")}</button>
        )}
        {(job?.status === "VALIDATED" || job?.status === "PREVIEWED" || job?.status === "COMMITTED") && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-lg bg-paper-100 px-2 py-1">{tr("imp_rows")}: <b className="kpi-num">{st.rows ?? "—"}</b></span>
            <span className="rounded-lg bg-moss-500/12 px-2 py-1 text-moss-700">{tr("imp_valid")}: <b className="kpi-num">{st.valid ?? "—"}</b></span>
            {(st.invalid || 0) > 0 && <span className="rounded-lg bg-clay-500/10 px-2 py-1 text-clay-700">{tr("imp_invalid")}: <b className="kpi-num">{st.invalid}</b></span>}
            {job.status !== "VALIDATED" && st.willUpdate != null && <span className="rounded-lg bg-amber-500/10 px-2 py-1 text-amber-700">{tr("imp_willUpdate")}: <b className="kpi-num">{st.willUpdate}</b></span>}
          </div>
        )}
        {(job?.errors || []).length > 0 && job?.status !== "COMMITTED" && (
          <div className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-clay-500/20 bg-clay-500/5 p-2 text-[11px] text-clay-700">
            {job!.errors!.slice(0, 20).map((e, i) => <div key={i} dir="auto">{tr("imp_row")} {e.row}: {e.reason}</div>)}
          </div>
        )}

        {/* ── 4 · preview → 5 · commit ── */}
        {job?.status === "VALIDATED" && (
          <button onClick={preview} disabled={busy} className="btn-amber text-xs">👁 {tr("imp_preview")}</button>
        )}
        {job?.status === "PREVIEWED" && (
          <button onClick={commit} disabled={busy} className="btn-amber text-xs">✓ {tr("imp_commit")}</button>
        )}
        {job?.status === "COMMITTED" && (
          <div className="rounded-xl bg-moss-500/10 p-3 text-center text-sm text-moss-700">
            ✓ {tr("imp_done")} — {tr("imp_created")} <b className="kpi-num">{st.created ?? 0}</b> · {tr("imp_updated")} <b className="kpi-num">{st.updated ?? 0}</b> · {tr("imp_skipped")} <b className="kpi-num">{st.skipped ?? 0}</b>
          </div>
        )}

        <div className="flex justify-between pt-1">
          {job && job.status !== "COMMITTED"
            ? <button onClick={cancel} className="text-xs text-clay-600 hover:underline">{tr("imp_cancel")}</button> : <span />}
          {job?.status === "COMMITTED" && <button onClick={onDone} className="btn-amber text-xs">{tr("imp_close")}</button>}
        </div>
      </div>
    </Modal>
  );
}

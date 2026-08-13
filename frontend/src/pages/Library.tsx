import { useCallback, useEffect, useRef, useState } from "react";
import { Card, SectionTitle, Modal, SkeletonCards } from "../components/ui";
import { api, uploadFile, type UploadedFile } from "../lib/api";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";

// ═══ MEDIA LIBRARY — مكتبة الوسائط ═══════════════════════════════════
// Every file the organisation owns, in one place: what it is, where it
// is used, and whether it is safe to remove.

interface FileRow {
  id: string; name: string; mime: string; size: number; kind: string; driver: string;
  public: boolean; entity?: string | null; entityId?: string | null; url: string;
  sha256?: string; createdAt: string;
}
interface Page { total: number; bytes: number; items: FileRow[] }
interface Usage { kind: string; id: string; label: string }

const KINDS = ["ALL", "IMAGE", "VIDEO", "DOC", "AUDIO", "ARCHIVE"];
const GLYPH: Record<string, string> = { IMAGE: "🖼", VIDEO: "🎬", DOC: "📄", AUDIO: "🎵", ARCHIVE: "🗜", OTHER: "📦" };
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function Library() {
  const { tr, lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const writable = can("content", "write");

  const [page, setPage] = useState<Page | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState<FileRow | null>(null);
  const [usage, setUsage] = useState<Usage[] | null>(null);
  const [rename, setRename] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (kind !== "ALL") qs.set("kind", kind);
    setPage(await api.get<Page>(`/files?${qs}`));
  }, [q, kind]);

  useEffect(() => { const t = setTimeout(() => { load().catch(() => {}); }, 250); return () => clearTimeout(t); }, [load]);

  const send = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    let done = 0;
    for (const f of list) {
      try { await uploadFile(f, { entity: "library", public: true }); done++; }
      catch (e) { toast.push(`${f.name}: ${(e as Error).message}`, "error"); }
    }
    setBusy(false);
    if (done) toast.push(`${done} ${tr("lib_uploaded")}`, "success");
    load();
  };

  const openFile = async (f: FileRow) => {
    setOpen(f); setRename(f.name); setUsage(null);
    try { setUsage(await api.get<Usage[]>(`/files/${f.id}/usage`)); } catch { setUsage([]); }
  };

  const remove = async (force = false) => {
    if (!open) return;
    try {
      await api.del(`/files/${open.id}${force ? "?force=true" : ""}`);
      setOpen(null); load(); toast.push(tr("lib_deleted"), "success");
    } catch (e) {
      const msg = (e as Error).message;
      if (/in use/i.test(msg)) toast.push(tr("lib_inUse"), "error");
      else toast.push(msg, "error");
    }
  };

  const copy = (f: FileRow) => {
    navigator.clipboard.writeText(`${window.location.origin}${f.url}`);
    toast.push(tr("copied"), "success");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-900">{tr("lib_title")}</h1>
          <p className="text-sm text-ink-500">{tr("lib_sub")}</p>
        </div>
        {page && (
          <div className="text-xs text-ink-500">
            <span className="kpi-num font-bold text-ink-900" dir="ltr">{page.total}</span> {tr("lib_files")} ·{" "}
            <span className="kpi-num" dir="ltr">{mb(page.bytes)}</span>
          </div>
        )}
      </div>

      {/* ── the drop zone ── */}
      {writable && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${
            drag ? "border-amber-500 bg-amber-500/10" : "border-paper-300 hover:border-amber-500/60 hover:bg-paper-100"}`}>
          <input ref={inputRef} type="file" multiple className="hidden"
            onChange={(e) => { send(e.target.files || []); if (inputRef.current) inputRef.current.value = ""; }} />
          <div className="text-2xl">{busy ? "⏳" : "↥"}</div>
          <div className="mt-1 text-sm font-medium text-ink-700">{busy ? tr("lib_uploading") : tr("lib_drop")}</div>
          <div className="mt-0.5 text-[11px] text-ink-400">{tr("lib_cap")}</div>
        </div>
      )}

      {/* ── search + families ── */}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs flex-1" placeholder={tr("lib_search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1.5 text-xs">
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1 font-medium transition ${
                kind === k ? "bg-ink-900 text-paper-50" : "bg-paper-200 text-ink-600 hover:bg-paper-300"}`}>
              {k === "ALL" ? tr("lib_all") : `${GLYPH[k]} ${tr(`lib_k_${k}`)}`}
            </button>
          ))}
        </div>
      </div>

      {/* ── the grid ── */}
      {!page ? <SkeletonCards count={4} /> : !page.items.length ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-ink-500">{q || kind !== "ALL" ? tr("lib_noMatch") : tr("lib_empty")}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {page.items.map((f) => (
            <button key={f.id} onClick={() => openFile(f)}
              className="group overflow-hidden rounded-2xl border border-paper-200 bg-white text-start shadow-soft transition hover:border-amber-500/50 hover:shadow-md">
              <div className="flex h-28 items-center justify-center bg-paper-100">
                {f.kind === "IMAGE"
                  ? <img src={f.url} alt={f.name} loading="lazy" className="h-full w-full object-cover" />
                  : <span className="text-3xl opacity-70">{GLYPH[f.kind] || GLYPH.OTHER}</span>}
              </div>
              <div className="p-2.5">
                <div className="truncate text-xs font-medium text-ink-800" title={f.name}>{f.name}</div>
                <div className="mt-0.5 flex items-center justify-between text-[10px] text-ink-400">
                  <span className="kpi-num" dir="ltr">{mb(f.size)}</span>
                  {!f.public && <span title={tr("lib_private")}>🔒</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── the file itself ── */}
      {open && (
        <Modal open title={open.name} onClose={() => setOpen(null)}>
          <div className="space-y-3">
            {open.kind === "IMAGE" && (
              <img src={open.url} alt={open.name} className="mx-auto max-h-64 rounded-xl border border-paper-200 object-contain" />
            )}
            <div className="grid grid-cols-2 gap-2 text-xs text-ink-600">
              <div>{tr("lib_size")}: <span className="kpi-num" dir="ltr">{mb(open.size)}</span></div>
              <div className="truncate" dir="ltr">{open.mime}</div>
              <div>{tr("lib_added")}: <span dir="ltr">{new Date(open.createdAt).toLocaleDateString(lang === "ar" ? "ar" : "en")}</span></div>
              <div>{open.public ? tr("lib_public") : tr("lib_private")}</div>
            </div>

            {writable && (
              <div className="flex items-center gap-2">
                <input className="input flex-1" value={rename} onChange={(e) => setRename(e.target.value)} />
                <button className="btn-ghost text-xs" disabled={rename === open.name}
                  onClick={async () => {
                    try {
                      const r = await api.patch<FileRow>(`/files/${open.id}`, { name: rename });
                      setOpen({ ...open, name: r.name }); load(); toast.push(tr("saved"), "success");
                    } catch (e) { toast.push((e as Error).message, "error"); }
                  }}>{tr("save")}</button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <code className="kpi-num flex-1 truncate rounded-lg bg-paper-200 px-2 py-1.5 text-[11px] text-ink-700" dir="ltr">{open.url}</code>
              <button onClick={() => copy(open)} className="btn-ghost text-xs">📋</button>
              <a href={open.url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">↗</a>
            </div>

            {/* where it is used — the question a library must answer */}
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink-400">{tr("lib_usage")}</div>
              {usage === null ? <p className="mt-1 text-xs text-ink-400">…</p>
                : !usage.length ? <p className="mt-1 text-xs text-ink-400">{tr("lib_unused")}</p> : (
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-700">
                    {usage.map((u, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] text-ink-500">{tr(`lib_u_${u.kind}`)}</span>
                        <span className="truncate">{u.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </div>

            {writable && (
              <div className="flex gap-2 border-t border-paper-200 pt-3">
                <button onClick={async () => {
                  try {
                    const r = await api.patch<FileRow>(`/files/${open.id}`, { public: !open.public });
                    setOpen({ ...open, public: r.public, url: r.url }); load();
                  } catch (e) { toast.push((e as Error).message, "error"); }
                }} className="btn-ghost text-xs">{open.public ? `🔒 ${tr("lib_makePrivate")}` : `🌐 ${tr("lib_makePublic")}`}</button>
                <button onClick={() => remove(usage !== null && usage.length > 0)}
                  className="text-xs text-clay-600 hover:underline">
                  {usage?.length ? tr("lib_deleteAnyway") : tr("delete")}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

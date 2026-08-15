import { useState } from "react";
import { Card, SectionTitle, Field, Select, Modal, StatusPill, Empty, SkeletonRows, useFetch } from "../components/ui";
import { TemplateBar, LandingPreview, LP_TEMPLATES, slugify } from "../components/Builder";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { api } from "../lib/api";

// ── LANDING PAGES — block-based bilingual pages at /l/:slug ──────────
// Every campaign gets a page with a tracked form and zero developer.

interface Block { kind: string; heading?: string; headingAr?: string; sub?: string; subAr?: string;
  body?: string; bodyAr?: string; label?: string; labelAr?: string;
  items?: { t: string; tAr?: string; d?: string; dAr?: string }[] }
interface Page { id: string; slug: string; title: string; titleAr?: string; blocks: Block[] | string;
  formId?: string; formName?: string; campaignId?: string; campaignName?: string; status: string; views: number
  theme?: { primary?: string };}
interface FormRow { id: string; name: string }
interface Campaign { id: string; name: string }

const KINDS = ["HERO", "TEXT", "FEATURES", "CTA"];
const parseBlocks = (v: Block[] | string): Block[] => Array.isArray(v) ? v : (() => { try { return JSON.parse(v || "[]"); } catch { return []; } })();

export default function Pages() {
  const { tr, el } = useI18n();
  const { can } = useAuth();
  const w = can("automate", "write");
  const { data: pages, reload } = useFetch<Page[]>("/landing-pages");
  const { data: forms } = useFetch<FormRow[]>("/forms");
  const { data: campaigns } = useFetch<Campaign[]>("/campaigns");
  const [editing, setEditing] = useState<(Partial<Page> & { blocksArr?: Block[] }) | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [qr, setQr] = useState<{ dataUrl: string; slug: string } | null>(null);
  const showQr = async (p: Page) => {
    try { const d = await api.get<{ dataUrl: string }>(`/landing-pages/${p.id}/qr`); setQr({ dataUrl: d.dataUrl, slug: p.slug }); }
    catch { /* toast below if present */ }
  };

  const openEdit = (p?: Page) => setEditing(p
    ? { ...p, blocksArr: parseBlocks(p.blocks) }
    : { status: "DRAFT", blocksArr: [{ kind: "HERO", heading: "", headingAr: "" }, { kind: "CTA", label: "", labelAr: "" }] });
  const save = async () => {
    if (!editing?.title) return;
    setErr("");
    const payload = { ...editing, blocks: editing.blocksArr, slug: editing.slug || slugify(editing.title || editing.titleAr || "", "page") };
    delete (payload as Record<string, unknown>).blocksArr;
    try {
      if (editing.id) await api.patch(`/landing-pages/${editing.id}`, payload);
      else await api.post("/landing-pages", payload);
      setEditing(null); reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const copyLink = async (p: Page) => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/l/${p.slug}`); } catch { /* optional */ }
    setCopied(p.id); setTimeout(() => setCopied(""), 1500);
  };
  const setB = (i: number, patch: Partial<Block>) => {
    const arr = [...(editing?.blocksArr || [])]; arr[i] = { ...arr[i], ...patch };
    setEditing({ ...editing!, blocksArr: arr });
  };
  const applyTpl = (t: (typeof LP_TEMPLATES)[number]) => {
    if (editing?.blocksArr?.length && editing.blocksArr.some((b: Block) => b.heading || b.body || b.label) && !confirm(tr("bl_replaceConfirm"))) return;
    setEditing({ ...editing!,
      title: editing?.title || t.title, titleAr: editing?.titleAr || t.titleAr,
      blocksArr: t.blocks.map((b) => ({ ...b })) as Block[] });
  };
  const move = (i: number, dir: -1 | 1) => {
    const arr = [...(editing?.blocksArr || [])];
    const j = i + dir; if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setEditing({ ...editing!, blocksArr: arr });
  };

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle action={w && <button onClick={() => openEdit()} className="btn-amber text-xs">+ {tr("lp_new")}</button>}>
          {tr("lp_title")}
        </SectionTitle>
        <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("lp_sub")}</p>
        {!pages ? <SkeletonRows rows={3} cols={4} /> : pages.length === 0 ? <Empty text={tr("lp_empty")} /> : (
          <div className="grid gap-2 md:grid-cols-2">
            {pages.map((p) => (
              <div key={p.id} className="rounded-xl border border-paper-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => w && openEdit(p)} className="text-start font-medium text-ink-800 hover:underline">{p.title}</button>
                  <StatusPill value={p.status} />
                </div>
                <div className="mt-0.5 text-xs text-ink-400" dir="ltr">/l/{p.slug}{p.formName ? ` · ${p.formName}` : ""}</div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span className="kpi-num text-ink-700">{p.views} <span className="text-ink-400">{tr("lp_views")}</span></span>
                  <span className="ms-auto flex gap-2">
                    {p.status === "PUBLISHED" && <a href={`/l/${p.slug}`} target="_blank" rel="noreferrer" className="text-steel-600 hover:underline">{tr("lp_open")} ↗</a>}
                    <button onClick={() => showQr(p)} className="rounded-lg bg-ink-900 px-2 py-0.5 text-[10px] font-medium text-paper-50">⬛ QR</button>
                    <button onClick={() => copyLink(p)} className="text-steel-600 hover:underline">{copied === p.id ? `✓ ${tr("ag_copied")}` : tr("fm_copyLink")}</button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? tr("edit") : tr("lp_new")}
        footer={<><button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={save} className="btn-amber">{tr("save")}</button></>}>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={`${tr("title")} (AR)`}><input className="input" value={editing.titleAr || ""} onChange={(e) => setEditing({ ...editing, titleAr: e.target.value })} /></Field>
              <Field label={`${tr("title")} (EN)`}><input className="input" dir="ltr" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Slug"><input className="input" dir="ltr" placeholder={tr("fm_slugAuto")} value={editing.slug || ""} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} /></Field>
              <Field label={tr("fm_title")}>
                <Select value={editing.formId || ""} onChange={(v) => setEditing({ ...editing, formId: v || undefined })} placeholder="—"
                  options={(forms || []).map((f) => ({ value: f.id, label: f.name }))} />
              </Field>
              <Field label={tr("status")}>
                <Select value={editing.status || "DRAFT"} onChange={(v) => setEditing({ ...editing, status: v })}
                  options={["DRAFT", "PUBLISHED", "ARCHIVED"].map((s) => ({ value: s, label: el(s) }))} />
              </Field>
            </div>
            <Field label={tr("lp_themeColor")}>
              <input type="color" className="h-9 w-full cursor-pointer rounded-lg border border-paper-200 bg-white"
                value={(editing.theme as { primary?: string } | undefined)?.primary || "#f59e0b"}
                onChange={(e) => setEditing({ ...editing, theme: { ...(editing.theme as object || {}), primary: e.target.value } })} />
            </Field>
            <Field label={tr("campaign")}>
              <Select value={editing.campaignId || ""} onChange={(v) => setEditing({ ...editing, campaignId: v || undefined })} placeholder="—"
                options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <TemplateBar tpls={LP_TEMPLATES} onApply={applyTpl} />
            <div className="gap-4 md:grid md:grid-cols-[1fr,300px]">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label mb-0">{tr("lp_blocks")}</span>
                <span className="flex gap-1">
                  {KINDS.map((k) => (
                    <button key={k} onClick={() => setEditing({ ...editing, blocksArr: [...(editing.blocksArr || []), { kind: k, items: k === "FEATURES" ? [{ t: "" }] : undefined }] })}
                      className="rounded-lg border border-paper-300 px-2 py-0.5 text-[11px] text-ink-600 hover:bg-paper-100">+ {k}</button>
                  ))}
                </span>
              </div>
              <div className="space-y-2">
                {(editing.blocksArr || []).map((b, i) => (
                  <div key={i} className="rounded-lg border border-paper-200 bg-paper-100/50 p-2.5">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="pill bg-paper-200 text-[10px] text-ink-600">{b.kind}</span>
                      <span className="flex gap-1 text-ink-400">
                        <button onClick={() => move(i, -1)}>↑</button><button onClick={() => move(i, 1)}>↓</button>
                        <button onClick={() => setEditing({ ...editing, blocksArr: editing.blocksArr!.filter((_, j) => j !== i) })} className="text-clay-600">✕</button>
                      </span>
                    </div>
                    {b.kind === "HERO" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input className="input" placeholder="عنوان" value={b.headingAr || ""} onChange={(e) => setB(i, { headingAr: e.target.value })} />
                          <input className="input" dir="ltr" placeholder="Heading" value={b.heading || ""} onChange={(e) => setB(i, { heading: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input className="input" placeholder="وصف" value={b.subAr || ""} onChange={(e) => setB(i, { subAr: e.target.value })} />
                          <input className="input" dir="ltr" placeholder="Subheading" value={b.sub || ""} onChange={(e) => setB(i, { sub: e.target.value })} />
                        </div>
                      </div>
                    )}
                    {b.kind === "TEXT" && (
                      <div className="grid grid-cols-2 gap-2">
                        <textarea className="input min-h-16" placeholder="نص" value={b.bodyAr || ""} onChange={(e) => setB(i, { bodyAr: e.target.value })} />
                        <textarea className="input min-h-16" dir="ltr" placeholder="Body" value={b.body || ""} onChange={(e) => setB(i, { body: e.target.value })} />
                      </div>
                    )}
                    {b.kind === "CTA" && (
                      <div className="grid grid-cols-2 gap-2">
                        <input className="input" placeholder="نص الزر" value={b.labelAr || ""} onChange={(e) => setB(i, { labelAr: e.target.value })} />
                        <input className="input" dir="ltr" placeholder="Button label" value={b.label || ""} onChange={(e) => setB(i, { label: e.target.value })} />
                      </div>
                    )}
                    {b.kind === "FEATURES" && (
                      <div className="space-y-1.5">
                        {(b.items || []).map((it, k) => (
                          <div key={k} className="grid grid-cols-2 gap-2">
                            <input className="input" placeholder="ميزة" value={it.tAr || ""} onChange={(e) => { const items = [...(b.items || [])]; items[k] = { ...items[k], tAr: e.target.value }; setB(i, { items }); }} />
                            <input className="input" dir="ltr" placeholder="Feature" value={it.t} onChange={(e) => { const items = [...(b.items || [])]; items[k] = { ...items[k], t: e.target.value }; setB(i, { items }); }} />
                          </div>
                        ))}
                        <button onClick={() => setB(i, { items: [...(b.items || []), { t: "" }] })} className="btn-ghost text-xs">+ {tr("add")}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {err && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{err}</div>}
            <div className="mt-3 md:mt-0">
              <LandingPreview theme={editing.theme as { primary?: string } | undefined} blocks={(editing.blocksArr || []) as import("../components/Builder").LandingBlock[]} title={editing.title} titleAr={editing.titleAr} hasForm={!!editing.formId} />
            </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!qr} onClose={() => setQr(null)} title={qr ? `/l/${qr.slug}` : ""}>
        {qr && (
          <div className="text-center">
            <img src={qr.dataUrl} alt="QR" className="mx-auto h-52 w-52 rounded-xl border border-paper-200 bg-white p-2" />
            <p className="mt-2 text-xs text-ink-500" dir="auto">{tr("lk_qrHint")}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

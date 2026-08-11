import { useMemo, useState } from "react";
import { useFetch, Card, Field, Select, Modal, SectionTitle } from "../components/ui";
import { useToast } from "../components/Toast";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

// ═══ PUBLISH — the composer, the queue, and the bio pages ════════════

interface ContentItem { id: string; title: string; status: string; channel: string }
interface Variant { id: string; contentId: string; platform: string; caption?: string | null; captionAr?: string | null; hashtags: string | string[]; format: string; contentTitle?: string }
interface Slot {
  id: string; variantId: string; scheduledAt: string; assigneeId?: string | null; status: string;
  linkCode?: string | null; publishedPostId?: string | null; notifiedAt?: string | null;
  platform: string; caption?: string | null; captionAr?: string | null; format: string;
  contentId: string; contentTitle: string; assigneeName?: string | null; linkUrl?: string | null;
  externalUrl?: string | null; publishError?: string | null;
}
interface UserRow { id: string; name: string }
interface LinkRow { id: string; code: string; url: string }
interface CopyRow { id: string; text: string; textAr?: string | null; kind: string; approved: boolean }
interface BioPage { id: string; slug: string; title: string; titleAr?: string | null; theme: string | { accent?: string }; active: boolean }
interface BioLink { id: string; pageId: string; label: string; labelAr?: string | null; linkCode: string; sort: number; active: boolean; url?: string; clicks?: number }

const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "X", "TIKTOK", "LINKEDIN", "YOUTUBE", "WHATSAPP"];
const FORMATS = ["POST", "REEL", "STORY", "ARTICLE", "AD"];
const P = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-paper-200 text-ink-600",
  QUEUED: "bg-amber-100 text-amber-700",
  AWAITING_APPROVAL: "bg-paper-300 text-ink-700",
  READY: "bg-moss-100 text-moss-700",
  NOTIFIED: "bg-moss-100 text-moss-700",
  PUBLISHED: "bg-ink-900 text-paper-50",
  SKIPPED: "bg-clay-100 text-clay-700",
};

// ── The composer: one modal, content → variant → slot ────────────────
function ComposerModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { data: content } = useFetch<ContentItem[]>("/content", [open]);
  const { data: variants } = useFetch<Variant[]>("/content-variants", [open]);
  const { data: users } = useFetch<UserRow[]>("/users", [open]);
  const { data: links } = useFetch<LinkRow[]>("/links", [open]);
  const { data: copyBank } = useFetch<CopyRow[]>("/copy-bank", [open]); // studio-flagged: null when off
  const [contentId, setContentId] = useState("");
  const [variantId, setVariantId] = useState("");           // "" → new variant
  const [nv, setNv] = useState({ platform: "INSTAGRAM", format: "POST", caption: "", captionAr: "", hashtags: "" });
  const [slot, setSlot] = useState({ scheduledAt: "", assigneeId: "", linkCode: "", queue: true });
  const [saving, setSaving] = useState(false);

  const approved = (content || []).filter((c) => ["APPROVED", "PUBLISHED"].includes(c.status));
  const myVariants = (variants || []).filter((v) => v.contentId === contentId);
  const approvedCopy = (copyBank || []).filter((c) => c.approved);

  const insertCopy = (id: string) => {
    const c = approvedCopy.find((x) => x.id === id);
    if (!c) return;
    setNv((s) => ({
      ...s,
      caption: s.caption ? `${s.caption}\n${c.text}` : c.text,
      captionAr: c.textAr ? (s.captionAr ? `${s.captionAr}\n${c.textAr}` : c.textAr) : s.captionAr,
    }));
  };

  const save = async () => {
    if (!contentId || !slot.scheduledAt) { toast.push(tr("pb_needBasics"), "error"); return; }
    setSaving(true);
    try {
      let vid = variantId;
      if (!vid) {
        const v = await api.post<Variant>("/content-variants", {
          contentId, platform: nv.platform, format: nv.format,
          caption: nv.caption || null, captionAr: nv.captionAr || null,
          hashtags: nv.hashtags.split(",").map((h) => h.trim().replace(/^#/, "")).filter(Boolean),
        });
        vid = v.id;
      }
      await api.post("/scheduled-posts", {
        variantId: vid, scheduledAt: new Date(slot.scheduledAt).toISOString(),
        assigneeId: slot.assigneeId || null, linkCode: slot.linkCode || null,
        status: slot.queue ? "QUEUED" : "DRAFT",
      });
      toast.push(tr("saved"), "success");
      onSaved(); onClose();
      setContentId(""); setVariantId("");
      setNv({ platform: "INSTAGRAM", format: "POST", caption: "", captionAr: "", hashtags: "" });
      setSlot({ scheduledAt: "", assigneeId: "", linkCode: "", queue: true });
    } catch (e) { toast.push((e as Error).message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={tr("pb_new")}
      footer={<><button onClick={onClose} className="btn-ghost">{tr("cancel")}</button>
        <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button></>}>
      <div className="space-y-3">
        <Field label={tr("pb_content")}>
          <Select value={contentId} onChange={(v) => { setContentId(v); setVariantId(""); }} placeholder={tr("pb_pickApproved")}
            options={approved.map((c) => ({ value: c.id, label: c.title }))} />
        </Field>
        {contentId && (
          <>
            <Field label={tr("pb_variant")}>
              <Select value={variantId} onChange={setVariantId} placeholder={tr("pb_newVariant")}
                options={myVariants.map((v) => ({ value: v.id, label: `${v.platform} · ${v.format}` }))} />
            </Field>
            {!variantId && (
              <div className="rounded-xl border border-paper-200 bg-paper-50 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={tr("pb_platform")}><Select value={nv.platform} onChange={(v) => setNv({ ...nv, platform: v })} options={PLATFORMS.map((p) => ({ value: p, label: p }))} /></Field>
                  <Field label={tr("pb_format")}><Select value={nv.format} onChange={(v) => setNv({ ...nv, format: v })} options={FORMATS.map((f) => ({ value: f, label: f }))} /></Field>
                </div>
                <Field label={`${tr("pb_caption")} (AR)`}><textarea className="input mt-2" rows={2} dir="rtl" value={nv.captionAr} onChange={(e) => setNv({ ...nv, captionAr: e.target.value })} /></Field>
                <Field label={`${tr("pb_caption")} (EN)`}><textarea className="input" rows={2} dir="ltr" value={nv.caption} onChange={(e) => setNv({ ...nv, caption: e.target.value })} /></Field>
                <Field label={tr("pb_hashtags")}><input className="input" dir="ltr" placeholder="solar, sudan" value={nv.hashtags} onChange={(e) => setNv({ ...nv, hashtags: e.target.value })} /></Field>
                {approvedCopy.length > 0 && (
                  <Field label={tr("pb_copyBank")}>
                    <Select value="" onChange={insertCopy} placeholder={tr("pb_copyBankPick")}
                      options={approvedCopy.map((c) => ({ value: c.id, label: `${c.kind} · ${(lang === "ar" && c.textAr ? c.textAr : c.text).slice(0, 60)}` }))} />
                  </Field>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("pb_when")}><input type="datetime-local" className="input" dir="ltr" value={slot.scheduledAt} onChange={(e) => setSlot({ ...slot, scheduledAt: e.target.value })} /></Field>
              <Field label={tr("pb_owner")}><Select value={slot.assigneeId} onChange={(v) => setSlot({ ...slot, assigneeId: v })} placeholder={tr("unassigned")} options={(users || []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
            </div>
            <Field label={tr("pb_link")}>
              <Select value={slot.linkCode} onChange={(v) => setSlot({ ...slot, linkCode: v })} placeholder={tr("none")}
                options={(links || []).map((l) => ({ value: l.code, label: `/r/${l.code} → ${l.url.slice(0, 40)}` }))} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" checked={slot.queue} onChange={(e) => setSlot({ ...slot, queue: e.target.checked })} />
              {tr("pb_queueNow")}
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── The queue ────────────────────────────────────────────────────────
function QueueTab() {
  const { tr, lang, el } = useI18n();
  const toast = useToast();
  const { data: slots, reload } = useFetch<Slot[]>("/scheduled-posts");
  const [composing, setComposing] = useState(false);
  const [publishing, setPublishing] = useState<Slot | null>(null);
  const [pm, setPm] = useState({ reach: 0, impressions: 0, engagement: 0, clicks: 0, url: "" });

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); reload(); } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const patch = (id: string, status: string) => act(() => api.patch(`/scheduled-posts/${id}`, { status }));
  const share = async (s: Slot) => {
    const caption = (lang === "ar" && s.captionAr ? s.captionAr : s.caption) || s.contentTitle;
    const text = s.linkCode ? `${caption}\n${location.origin}/r/${s.linkCode}` : caption;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast.push(tr("pb_copied"), "success"); }
    } catch { /* user cancelled the sheet */ }
  };
  const doPublish = async () => {
    if (!publishing) return;
    await act(() => api.post(`/scheduled-posts/${publishing.id}/publish`, pm));
    setPublishing(null); setPm({ reach: 0, impressions: 0, engagement: 0, clicks: 0, url: "" });
  };

  const upcoming = (slots || []).filter((s) => !["PUBLISHED", "SKIPPED"].includes(s.status));
  const done = (slots || []).filter((s) => ["PUBLISHED", "SKIPPED"].includes(s.status)).slice(-8).reverse();

  const Row = ({ s }: { s: Slot }) => (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[s.status]}`}>{el(s.status)}</span>
          <span className="text-[11px] font-semibold text-ink-500" dir="ltr">{s.platform} · {s.format}</span>
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-ink-800">{s.contentTitle}</div>
        <div className="text-[11px] text-ink-500" dir="ltr">
          {fmtDate(s.scheduledAt)} {s.assigneeName ? `· ${s.assigneeName}` : ""} {s.linkCode ? `· /r/${s.linkCode}` : ""}
        </div>
        {s.externalUrl && (
          <a href={s.externalUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-[11px] font-medium text-moss-700 hover:underline" dir="ltr">
            ↗ {tr("pb_live")}
          </a>
        )}
        {s.publishError && (
          <div className="mt-1 rounded-lg bg-clay-100 px-2 py-1 text-[11px] text-clay-700">⚠ {s.publishError}</div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {s.status === "DRAFT" && <button className="btn-ghost text-xs" onClick={() => patch(s.id, "QUEUED")}>{tr("pb_queue")}</button>}
        {s.status === "QUEUED" && (
          <>
            <button className="btn-ghost text-xs" onClick={() => act(() => api.post(`/scheduled-posts/${s.id}/request-approval`, {}))}>{tr("pb_reqApproval")}</button>
            <button className="btn-ghost text-xs" onClick={() => patch(s.id, "READY")}>{tr("pb_markReady")}</button>
          </>
        )}
        {["READY", "NOTIFIED"].includes(s.status) && (
          <>
            <button className="btn-ghost text-xs" onClick={() => share(s)}>{tr("pb_share")}</button>
            <button className="btn-amber text-xs" onClick={() => setPublishing(s)}>{tr("pb_publish")}</button>
          </>
        )}
        {["QUEUED", "READY", "NOTIFIED"].includes(s.status) && <button className="text-[11px] text-clay-600 hover:underline" onClick={() => patch(s.id, "SKIPPED")}>{tr("pb_skip")}</button>}
        {s.status === "SKIPPED" && <button className="btn-ghost text-xs" onClick={() => patch(s.id, "QUEUED")}>{tr("pb_requeue")}</button>}
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>{tr("pb_queueTitle")}</SectionTitle>
        <button className="btn-amber" onClick={() => setComposing(true)}>{tr("pb_new")}</button>
      </div>
      <Card className="p-4">
        {upcoming.length === 0
          ? <p className="text-sm text-ink-500">{tr("pb_emptyQueue")}</p>
          : <ul className="divide-y divide-paper-200">{upcoming.map((s) => <Row key={s.id} s={s} />)}</ul>}
      </Card>
      {done.length > 0 && (
        <Card className="p-4">
          <SectionTitle>{tr("pb_recent")}</SectionTitle>
          <ul className="divide-y divide-paper-200">{done.map((s) => <Row key={s.id} s={s} />)}</ul>
        </Card>
      )}

      <ComposerModal open={composing} onClose={() => setComposing(false)} onSaved={reload} />

      <Modal open={!!publishing} onClose={() => setPublishing(null)} title={tr("pb_publishTitle")}
        footer={<><button onClick={() => setPublishing(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={doPublish} className="btn-amber">{tr("pb_publish")}</button></>}>
        <p className="mb-2 text-xs text-ink-500">{tr("pb_publishHint")}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={tr("pb_reach")}><input type="number" className="input" dir="ltr" value={pm.reach} onChange={(e) => setPm({ ...pm, reach: Number(e.target.value) })} /></Field>
          <Field label={tr("pb_impressions")}><input type="number" className="input" dir="ltr" value={pm.impressions} onChange={(e) => setPm({ ...pm, impressions: Number(e.target.value) })} /></Field>
          <Field label={tr("pb_engagement")}><input type="number" className="input" dir="ltr" value={pm.engagement} onChange={(e) => setPm({ ...pm, engagement: Number(e.target.value) })} /></Field>
          <Field label={tr("pb_clicks")}><input type="number" className="input" dir="ltr" value={pm.clicks} onChange={(e) => setPm({ ...pm, clicks: Number(e.target.value) })} /></Field>
          <div className="col-span-2"><Field label="URL"><input className="input" dir="ltr" value={pm.url} onChange={(e) => setPm({ ...pm, url: e.target.value })} /></Field></div>
        </div>
      </Modal>
    </div>
  );
}

// ── Bio pages ────────────────────────────────────────────────────────
function BioTab() {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const { can } = useAuth();
  const writable = can("publish", "write");
  const { data: pages, reload: reloadPages } = useFetch<BioPage[]>("/bio-pages");
  const { data: allLinks, reload: reloadLinks } = useFetch<BioLink[]>("/bio-links");
  const { data: tracked } = useFetch<LinkRow[]>("/links");
  const [sel, setSel] = useState<string>("");
  const [np, setNp] = useState<{ title: string; titleAr: string; slug: string; accent: string } | null>(null);
  const [nl, setNl] = useState<{ label: string; labelAr: string; linkCode: string; sort: number } | null>(null);

  const page = (pages || []).find((p) => p.id === (sel || pages?.[0]?.id));
  const links = (allLinks || []).filter((l) => l.pageId === page?.id);

  const savePage = async () => {
    if (!np?.title) return;
    try {
      await api.post("/bio-pages", { title: np.title, titleAr: np.titleAr || null, slug: np.slug || undefined, theme: np.accent ? { accent: np.accent } : {} });
      setNp(null); reloadPages(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const saveLink = async () => {
    if (!nl?.label || !nl.linkCode || !page) return;
    try {
      await api.post("/bio-links", { pageId: page.id, label: nl.label, labelAr: nl.labelAr || null, linkCode: nl.linkCode, sort: nl.sort });
      setNl(null); reloadLinks(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };
  const copyUrl = (slug: string) => {
    navigator.clipboard.writeText(`${location.origin}/b/${slug}`).catch(() => {});
    toast.push(tr("pb_copied"), "success");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <SectionTitle>{tr("pb_bioPages")}</SectionTitle>
          {writable && <button className="btn-amber text-xs" onClick={() => setNp({ title: "", titleAr: "", slug: "", accent: "" })}>{tr("add")}</button>}
        </div>
        <ul className="mt-2 divide-y divide-paper-200">
          {(pages || []).map((p) => (
            <li key={p.id} className={`flex items-center justify-between py-2 ${page?.id === p.id ? "" : "opacity-70"}`}>
              <button className="text-start" onClick={() => setSel(p.id)}>
                <div className="text-sm font-medium text-ink-800">{lang === "ar" && p.titleAr ? p.titleAr : p.title}</div>
                <div className="font-mono text-[11px] text-amber-700" dir="ltr">/b/{p.slug}</div>
              </button>
              <div className="flex items-center gap-2">
                {!p.active && <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[10px]">{tr("pb_off")}</span>}
                <button className="btn-ghost text-xs" onClick={() => copyUrl(p.slug)}>{tr("pb_copyUrl")}</button>
                {writable && (
                  <button className="text-[11px] text-ink-500 hover:underline"
                    onClick={async () => { await api.patch(`/bio-pages/${p.id}`, { active: !p.active }); reloadPages(); }}>
                    {p.active ? tr("pb_disable") : tr("pb_enable")}
                  </button>
                )}
              </div>
            </li>
          ))}
          {(pages || []).length === 0 && <p className="py-2 text-sm text-ink-500">{tr("empty")}</p>}
        </ul>
      </Card>

      <Card className="p-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <SectionTitle>{page ? `${tr("pb_linksOf")} /b/${page.slug}` : tr("pb_links")}</SectionTitle>
          {writable && page && <button className="btn-amber text-xs" onClick={() => setNl({ label: "", labelAr: "", linkCode: "", sort: links.length + 1 })}>{tr("add")}</button>}
        </div>
        <ul className="mt-2 divide-y divide-paper-200">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium text-ink-800">{lang === "ar" && l.labelAr ? l.labelAr : l.label}</span>
                <span className="ms-2 font-mono text-[11px] text-amber-700" dir="ltr">/r/{l.linkCode}</span>
                {!l.active && <span className="ms-2 rounded-full bg-paper-200 px-2 py-0.5 text-[10px]">{tr("pb_off")}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="kpi-num text-xs text-ink-600" dir="ltr">{l.clicks ?? 0} {tr("pb_taps")}</span>
                {writable && (
                  <button className="text-[11px] text-ink-500 hover:underline"
                    onClick={async () => { await api.patch(`/bio-links/${l.id}`, { active: !l.active }); reloadLinks(); }}>
                    {l.active ? tr("pb_disable") : tr("pb_enable")}
                  </button>
                )}
              </div>
            </li>
          ))}
          {page && links.length === 0 && <p className="py-2 text-sm text-ink-500">{tr("pb_noLinks")}</p>}
        </ul>
      </Card>

      <Modal open={!!np} onClose={() => setNp(null)} title={tr("pb_newPage")}
        footer={<><button onClick={() => setNp(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={savePage} className="btn-amber">{tr("save")}</button></>}>
        {np && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${tr("pb_pageTitle")} (AR)`}><input className="input" dir="rtl" value={np.titleAr} onChange={(e) => setNp({ ...np, titleAr: e.target.value })} /></Field>
            <Field label={`${tr("pb_pageTitle")} (EN)`}><input className="input" dir="ltr" value={np.title} onChange={(e) => setNp({ ...np, title: e.target.value })} /></Field>
            <Field label="Slug"><input className="input" dir="ltr" placeholder="spring-launch" value={np.slug} onChange={(e) => setNp({ ...np, slug: e.target.value })} /></Field>
            <Field label={tr("pb_accent")}><input type="color" className="input h-10" value={np.accent || "#c98a2b"} onChange={(e) => setNp({ ...np, accent: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!nl} onClose={() => setNl(null)} title={tr("pb_newLink")}
        footer={<><button onClick={() => setNl(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={saveLink} className="btn-amber">{tr("save")}</button></>}>
        {nl && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${tr("pb_label")} (AR)`}><input className="input" dir="rtl" value={nl.labelAr} onChange={(e) => setNl({ ...nl, labelAr: e.target.value })} /></Field>
            <Field label={`${tr("pb_label")} (EN)`}><input className="input" dir="ltr" value={nl.label} onChange={(e) => setNl({ ...nl, label: e.target.value })} /></Field>
            <div className="col-span-2">
              <Field label={tr("pb_link")}>
                <Select value={nl.linkCode} onChange={(v) => setNl({ ...nl, linkCode: v })} placeholder={tr("pb_pickLink")}
                  options={(tracked || []).map((t) => ({ value: t.code, label: `/r/${t.code} → ${t.url.slice(0, 40)}` }))} />
              </Field>
            </div>
            <Field label={tr("pb_sort")}><input type="number" className="input" dir="ltr" value={nl.sort} onChange={(e) => setNl({ ...nl, sort: Number(e.target.value) })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────
export default function Publish() {
  const { tr } = useI18n();
  const [tab, setTab] = useState<"queue" | "bio">("queue");
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {([["queue", tr("pb_tabQueue")], ["bio", tr("pb_tabBio")]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${tab === id ? "tab-active" : "bg-paper-200 text-ink-600 hover:bg-paper-300"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "queue" ? <QueueTab /> : <BioTab />}
    </div>
  );
}

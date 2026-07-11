import { useState } from "react";
import { useFetch, Card, Field, Select, Modal, SectionTitle, Empty } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

interface Contact { id: string; name: string; outlet?: string; role?: string; phone?: string; email?: string; beat?: string; tier?: string }
interface Press { id: string; title: string; contactId?: string; contactName?: string; outlet?: string; campaignId?: string; status: string; url?: string; publishedAt?: string; matchedSignals?: number; matchedSentiment?: number | null }
interface Inf { id: string; name: string; platform?: string; handle?: string; audience?: number; niche?: string; rateUsd?: number; rating?: number; phone?: string }
interface Collab { id: string; influencerId: string; influencerName?: string; platform?: string; campaignId?: string; deliverable?: string; costUsd: number; linkCode?: string; status: string; clicks?: number | null }
interface CampaignRow { id: string; name: string }

const P_TONE: Record<string, string> = { PITCHED: "bg-steel-500/12 text-steel-600", PROMISED: "bg-amber-500/15 text-amber-700", PUBLISHED: "bg-moss-500/15 text-moss-700", DECLINED: "bg-paper-200 text-ink-500" };
const wa = (p?: string) => (p ? `https://wa.me/${p.replace(/[^\d]/g, "")}` : null);

export default function Media() {
  const { lang, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data: contacts, reload: rC } = useFetch<Contact[]>("/media-contacts");
  const { data: press, reload: rP } = useFetch<Press[]>("/press");
  const { data: infs, reload: rI } = useFetch<Inf[]>("/influencers");
  const { data: collabs, reload: rX } = useFetch<Collab[]>("/collabs");
  const { data: campaigns } = useFetch<CampaignRow[]>("/campaigns");
  const [mc, setMc] = useState<Partial<Contact> | null>(null);
  const [pi, setPi] = useState<Partial<Press> | null>(null);
  const [inf, setInf] = useState<Partial<Inf> | null>(null);
  const [co, setCo] = useState<Partial<Collab> | null>(null);
  const [saving, setSaving] = useState(false);

  const saveGen = (obj: Record<string, unknown> | null, path: string, close: () => void, reload: () => void) => async () => {
    if (!obj) return;
    setSaving(true);
    try {
      obj.id ? await api.patch(`${path}/${obj.id}`, obj) : await api.post(path, obj);
      close(); reload();
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900">{tr("md_title")}</h1>
        <p className="text-sm text-ink-500">{tr("md_sub")}</p>
      </div>

      {/* Contacts */}
      <Card>
        <div className="flex items-center justify-between">
          <SectionTitle>{tr("md_contacts")}</SectionTitle>
          {can("social") && <button onClick={() => setMc({ name: "", tier: "TIER2" })} className="btn-ghost text-xs">+ {tr("add")}</button>}
        </div>
        {!contacts?.length ? <Empty text={tr("noData")} /> : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {contacts.map((c) => (
              <div key={c.id} className="rounded-lg border border-paper-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-ink-800">{c.name}</div>
                    <div className="text-xs text-ink-500">{c.outlet} · {c.beat || c.role || "—"}</div>
                  </div>
                  <span className="pill bg-paper-200 text-[10px] text-ink-500">{c.tier}</span>
                </div>
                <div className="mt-2 flex gap-3 text-xs">
                  {wa(c.phone) && <a href={wa(c.phone)!} target="_blank" rel="noreferrer" className="text-moss-600 hover:underline">WhatsApp ↗</a>}
                  {can("social") && <button onClick={() => setMc(c)} className="text-steel-600 hover:underline">{tr("edit")}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Press pipeline */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4">
          <SectionTitle>{tr("md_press")}</SectionTitle>
          {can("social") && <button onClick={() => setPi({ title: "", status: "PITCHED" })} className="btn-ghost text-xs">+ {tr("add")}</button>}
        </div>
        {!press?.length ? <Empty text={tr("noData")} /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <tbody className="divide-y divide-paper-200">
              {press.map((p) => (
                <tr key={p.id} className="hover:bg-paper-100/60">
                  <td className="px-5 py-3">
                    <div className="font-medium text-ink-800">{p.title}</div>
                    <div className="text-xs text-ink-500">{p.contactName || "—"}{p.outlet ? ` · ${p.outlet}` : ""}</div>
                  </td>
                  <td className="px-4 py-3"><span className={`pill ${P_TONE[p.status]}`}>{tr(p.status)}</span></td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {p.status === "PUBLISHED" && (p.matchedSignals || 0) > 0
                      ? <>{tr("md_matched")}: <span className="kpi-num">{p.matchedSignals}</span>{p.matchedSentiment != null && <span className={p.matchedSentiment >= 0 ? "text-moss-600" : "text-clay-600"}> ({p.matchedSentiment > 0 ? "+" : ""}{Math.round(p.matchedSentiment * 100) / 100})</span>}</>
                      : p.publishedAt ? fmtDate(p.publishedAt, lang) : "—"}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-steel-600 hover:underline">↗</a>}
                    {can("social") && <button onClick={() => setPi(p)} className="ms-3 text-xs text-steel-600 hover:underline">{tr("edit")}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      {/* Influencers + collabs */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <SectionTitle>{tr("md_influencers")}</SectionTitle>
            {can("social") && <button onClick={() => setInf({ name: "" })} className="btn-ghost text-xs">+ {tr("add")}</button>}
          </div>
          {!infs?.length ? <Empty text={tr("noData")} /> : infs.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b border-paper-100 py-2 last:border-0">
              <div>
                <div className="text-sm font-medium text-ink-800">{i.name} <span className="text-xs text-ink-400">@{i.handle}</span></div>
                <div className="text-xs text-ink-500">{i.platform} · {(i.audience || 0).toLocaleString()} {tr("md_audience")} · ${i.rateUsd || 0}</div>
              </div>
              <div className="flex gap-3 text-xs">
                {wa(i.phone) && <a href={wa(i.phone)!} target="_blank" rel="noreferrer" className="text-moss-600 hover:underline">WA</a>}
                {can("social") && <>
                  <button onClick={() => setCo({ influencerId: i.id, status: "PLANNED", costUsd: i.rateUsd || 0 })} className="text-amber-700 hover:underline">+ {tr("md_collab")}</button>
                  <button onClick={() => setInf(i)} className="text-steel-600 hover:underline">{tr("edit")}</button>
                </>}
              </div>
            </div>
          ))}
        </Card>
        <Card>
          <SectionTitle>{tr("md_collab")}</SectionTitle>
          {!collabs?.length ? <Empty text={tr("noData")} /> : collabs.map((c) => (
            <div key={c.id} className="flex items-center justify-between border-b border-paper-100 py-2 last:border-0">
              <div>
                <div className="text-sm font-medium text-ink-800">{c.influencerName} <span className="text-xs text-ink-400">· {c.deliverable || "—"}</span></div>
                <div className="text-xs text-ink-500">${c.costUsd} {c.linkCode && <>· /r/{c.linkCode} → <span className="kpi-num">{c.clicks ?? 0}</span> {tr("lk_clicks")}</>}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="pill bg-paper-200 text-[10px] text-ink-500">{c.status}</span>
                {can("social") && <button onClick={() => setCo(c)} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>}
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Modals */}
      <Modal open={!!mc} onClose={() => setMc(null)} title={tr("md_contacts")}
        footer={<><button onClick={() => setMc(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={saveGen(mc, "/media-contacts", () => setMc(null), rC)} disabled={saving} className="btn-amber">{tr("save")}</button></>}>
        {mc && <div className="grid grid-cols-2 gap-3">
          <Field label={tr("name")}><input className="input" value={mc.name || ""} onChange={(e) => setMc({ ...mc, name: e.target.value })} /></Field>
          <Field label={tr("md_outlet")}><input className="input" value={mc.outlet || ""} onChange={(e) => setMc({ ...mc, outlet: e.target.value })} /></Field>
          <Field label={tr("phone")}><input className="input" dir="ltr" value={mc.phone || ""} onChange={(e) => setMc({ ...mc, phone: e.target.value })} /></Field>
          <Field label={tr("md_beat")}><input className="input" value={mc.beat || ""} onChange={(e) => setMc({ ...mc, beat: e.target.value })} /></Field>
          <div className="col-span-2"><Field label={tr("md_tier")}>
            <Select value={mc.tier || "TIER2"} onChange={(v) => setMc({ ...mc, tier: v })} options={["TIER1","TIER2","TIER3"].map((t) => ({ value: t, label: t }))} /></Field></div>
        </div>}
      </Modal>
      <Modal open={!!pi} onClose={() => setPi(null)} title={tr("md_press")}
        footer={<><button onClick={() => setPi(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={saveGen(pi, "/press", () => setPi(null), rP)} disabled={saving} className="btn-amber">{tr("save")}</button></>}>
        {pi && <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Field label={tr("title")}><input className="input" value={pi.title || ""} onChange={(e) => setPi({ ...pi, title: e.target.value })} /></Field></div>
          <Field label={tr("md_contacts")}><Select value={pi.contactId || ""} onChange={(v) => setPi({ ...pi, contactId: v })} placeholder={tr("none")} options={(contacts || []).map((c) => ({ value: c.id, label: `${c.name} (${c.outlet || "—"})` }))} /></Field>
          <Field label={tr("status")}><Select value={pi.status || "PITCHED"} onChange={(v) => setPi({ ...pi, status: v, publishedAt: v === "PUBLISHED" && !pi.publishedAt ? new Date().toISOString() : pi.publishedAt })} options={["PITCHED","PROMISED","PUBLISHED","DECLINED"].map((s) => ({ value: s, label: tr(s) }))} /></Field>
          <Field label={tr("campaign")}><Select value={pi.campaignId || ""} onChange={(v) => setPi({ ...pi, campaignId: v })} placeholder={tr("none")} options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="URL"><input className="input" dir="ltr" value={pi.url || ""} onChange={(e) => setPi({ ...pi, url: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Modal open={!!inf} onClose={() => setInf(null)} title={tr("md_influencers")}
        footer={<><button onClick={() => setInf(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={saveGen(inf, "/influencers", () => setInf(null), rI)} disabled={saving} className="btn-amber">{tr("save")}</button></>}>
        {inf && <div className="grid grid-cols-2 gap-3">
          <Field label={tr("name")}><input className="input" value={inf.name || ""} onChange={(e) => setInf({ ...inf, name: e.target.value })} /></Field>
          <Field label="Handle"><input className="input" dir="ltr" value={inf.handle || ""} onChange={(e) => setInf({ ...inf, handle: e.target.value })} /></Field>
          <Field label={tr("platform")}><input className="input" value={inf.platform || ""} onChange={(e) => setInf({ ...inf, platform: e.target.value })} /></Field>
          <Field label={tr("md_audience")}><input className="input" type="number" value={inf.audience ?? ""} onChange={(e) => setInf({ ...inf, audience: +e.target.value })} /></Field>
          <Field label={tr("md_rate")}><input className="input" type="number" value={inf.rateUsd ?? ""} onChange={(e) => setInf({ ...inf, rateUsd: +e.target.value })} /></Field>
          <Field label={tr("phone")}><input className="input" dir="ltr" value={inf.phone || ""} onChange={(e) => setInf({ ...inf, phone: e.target.value })} /></Field>
        </div>}
      </Modal>
      <Modal open={!!co} onClose={() => setCo(null)} title={tr("md_collab")}
        footer={<><button onClick={() => setCo(null)} className="btn-ghost">{tr("cancel")}</button><button onClick={saveGen(co, "/collabs", () => setCo(null), rX)} disabled={saving} className="btn-amber">{tr("save")}</button></>}>
        {co && <div className="grid grid-cols-2 gap-3">
          <Field label={tr("md_deliverable")}><input className="input" value={co.deliverable || ""} onChange={(e) => setCo({ ...co, deliverable: e.target.value })} /></Field>
          <Field label={tr("md_rate")}><input className="input" type="number" value={co.costUsd ?? 0} onChange={(e) => setCo({ ...co, costUsd: +e.target.value })} /></Field>
          <Field label={tr("campaign")}><Select value={co.campaignId || ""} onChange={(v) => setCo({ ...co, campaignId: v })} placeholder={tr("none")} options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label={`${tr("lk_code")} (/r/…)`}><input className="input font-mono" dir="ltr" value={co.linkCode || ""} onChange={(e) => setCo({ ...co, linkCode: e.target.value.toLowerCase() })} /></Field>
          <div className="col-span-2"><Field label={tr("status")}>
            <Select value={co.status || "PLANNED"} onChange={(v) => setCo({ ...co, status: v })} options={["PLANNED","LIVE","DONE","CANCELLED"].map((s) => ({ value: s, label: s }))} /></Field></div>
        </div>}
      </Modal>
    </div>
  );
}

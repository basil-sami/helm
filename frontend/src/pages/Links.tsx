import { useState } from "react";
import { useFetch, Card, Field, Select, Empty } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/Toast";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

interface Link { id: string; code: string; url: string; campaignId?: string; campaignName?: string; channel?: string; clicks: number; lastClickAt?: string; createdAt: string }
interface CampaignRow { id: string; name: string }
interface Presets { sources: string[]; mediums: string[]; campaigns: { id: string; utm: string }[] }
interface Qr { code: string; url: string; dataUrl: string }

export default function Links() {
  const { lang, tr } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useFetch<Link[]>("/links");
  const { data: campaigns } = useFetch<CampaignRow[]>("/campaigns");
  const { data: presets } = useFetch<Presets>("/links/presets");
  const [form, setForm] = useState({ url: "", code: "", campaignId: "", channel: "" });
  const [utm, setUtm] = useState({ source: "", medium: "", campaign: "", content: "", term: "" });
  const [qr, setQr] = useState<Qr | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!/^https?:\/\/.+/.test(form.url)) return toast.push(tr("saveError"), "error");
    setSaving(true);
    try {
      await api.post("/links", { ...form, campaignId: form.campaignId || null, code: form.code || undefined });
      setForm({ url: "", code: "", campaignId: "", channel: "" });
      reload();
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setSaving(false); }
  };
  const compose = async () => {
    try { const out = await api.post<{ url: string }>("/links/compose", { url: form.url, utm }); setForm({ ...form, url: out.url }); }
    catch (e) { toast.push((e as Error).message, "error"); }
  };
  const copy = (code: string) => {
    navigator.clipboard.writeText(`${location.origin}/r/${code}`).catch(() => {});
    toast.push(tr("lk_copied"), "success");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900">{tr("lk_title")}</h1>
        <p className="text-sm text-ink-500">{tr("lk_sub")}</p>
      </div>

      {can("campaigns") && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2"><Field label={tr("lk_dest")}><input className="input" dir="ltr" placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field></div>
            <Field label={tr("lk_code")}><input className="input font-mono" dir="ltr" placeholder="expo26" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })} /></Field>
            <Field label={tr("campaign")}><Select value={form.campaignId} onChange={(v) => setForm({ ...form, campaignId: v })} placeholder={tr("none")} options={(campaigns || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
            <Field label={tr("channel")}><input className="input" placeholder="WHATSAPP" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-ink-400">{tr("lk_captureHint")}</p>
            <button onClick={create} disabled={saving} className="btn-amber">+ {tr("add")}</button>
          </div>
          <div className="mt-4 border-t border-paper-200 pt-4"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6"><Field label="utm_source"><Select value={utm.source} onChange={(source) => setUtm({ ...utm, source })} placeholder="—" options={(presets?.sources || []).map((x) => ({ value: x, label: x }))} /></Field><Field label="utm_medium"><Select value={utm.medium} onChange={(medium) => setUtm({ ...utm, medium })} placeholder="—" options={(presets?.mediums || []).map((x) => ({ value: x, label: x }))} /></Field><Field label="utm_campaign"><input className="input" dir="ltr" value={utm.campaign} onChange={(e) => setUtm({ ...utm, campaign: e.target.value })} list="utm-campaigns" /><datalist id="utm-campaigns">{(presets?.campaigns || []).map((x) => <option key={x.id} value={x.utm} />)}</datalist></Field><Field label="utm_content"><input className="input" dir="ltr" value={utm.content} onChange={(e) => setUtm({ ...utm, content: e.target.value })} /></Field><Field label="utm_term"><input className="input" dir="ltr" value={utm.term} onChange={(e) => setUtm({ ...utm, term: e.target.value })} /></Field><button onClick={compose} disabled={!form.url} className="btn-ghost self-end">{lang === "ar" ? "تركيب UTM" : "Compose UTM"}</button></div></div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        {loading ? <div className="py-16 text-center text-ink-500">{tr("loading")}</div>
          : !data?.length ? <Empty text={tr("noData")} /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-paper-200 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-4 py-3 text-start font-medium">/r/…</th>
              <th className="px-4 py-3 text-start font-medium">{tr("campaign")}</th>
              <th className="px-4 py-3 text-start font-medium">{tr("channel")}</th>
              <th className="px-4 py-3 text-start font-medium">{tr("lk_clicks")}</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-paper-200">
              {data.map((l) => (
                <tr key={l.id} className="hover:bg-paper-100/60">
                  <td className="px-4 py-3">
                    <div className="font-mono text-amber-700">/r/{l.code}</div>
                    <div className="max-w-56 truncate font-mono text-[11px] text-ink-400" dir="ltr">{l.url}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-600">{l.campaignName || "—"}</td>
                  <td className="px-4 py-3 text-ink-600">{l.channel || "—"}</td>
                  <td className="px-4 py-3"><span className="kpi-num text-ink-800">{l.clicks}</span>
                    {l.lastClickAt && <span className="ms-2 text-[11px] text-ink-400">{fmtDate(l.lastClickAt, lang)}</span>}</td>
                  <td className="px-4 py-3 text-end">
                     <button onClick={() => copy(l.code)} className="text-xs text-steel-600 hover:underline">{tr("lk_copy")}</button>
                     <button onClick={async () => { try { setQr(await api.get<Qr>(`/links/${l.id}/qr`)); } catch (e) { toast.push((e as Error).message, "error"); } }} className="ms-3 text-xs text-steel-600 hover:underline">QR</button>
                    {can("campaigns") && <button onClick={async () => { if (confirm(tr("confirmDelete"))) { await api.del(`/links/${l.id}`); reload(); } }} className="ms-3 text-xs text-clay-600 hover:underline">{tr("delete")}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {qr && <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/55 p-4" onClick={() => setQr(null)}><div onClick={(e) => e.stopPropagation()}><Card className="max-w-sm text-center"><img src={qr.dataUrl} alt={`QR ${qr.code}`} className="mx-auto w-full max-w-64" /><a href={qr.dataUrl} download={`${qr.code}.png`} className="btn-amber mt-3 inline-block">{lang === "ar" ? "تنزيل QR" : "Download QR"}</a></Card></div></div>}
    </div>
  );
}

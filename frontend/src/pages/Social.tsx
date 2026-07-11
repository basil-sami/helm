import { useState } from "react";
import { useFetch, Card, SectionTitle, Field, Select, Modal, StatusPill, Empty } from "../components/ui";
import { useToast } from "../components/Toast";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import ExportButton from "../components/ExportButton";
import { fmtNum, fmtDate } from "../lib/format";

interface PostRow {
  id: string; contentId?: string; contentTitle?: string; pillar?: string; campaignId?: string;
  platform: string; url?: string; linkCode?: string; publishedAt: string;
  reach: number; impressions: number; engagement: number; clicks: number;
}

interface Account {
  id: string; platform: string; handle: string; displayName?: string;
  status: string; latestFollowers?: number; metricCount?: number; connectedAt?: string;
}
interface Metric {
  id: string; date: string; followers: number; posts: number; impressions: number;
  reach: number; engagement: number; clicks: number; spendUsd: number; source: string;
}

const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "X", "LINKEDIN", "YOUTUBE", "TIKTOK"];
const METRIC_FIELDS: (keyof Metric)[] = ["followers", "posts", "impressions", "reach", "engagement", "clicks", "spendUsd"];

function platformGlyph(p: string) {
  const map: Record<string, string> = { INSTAGRAM: "IG", FACEBOOK: "f", X: "X", LINKEDIN: "in", YOUTUBE: "▶", TIKTOK: "♪" };
  return map[p] || p.slice(0, 2);
}

export default function Social() {
  const { lang, tr, el } = useI18n();
  const toast = useToast();
  const { can } = useAuth();
  const canWrite = can("social");
  const { data: accounts, loading, reload } = useFetch<Account[]>("/social/accounts");
  const { data: posts, reload: reloadPosts } = useFetch<PostRow[]>("/posts");
  const { data: contentList } = useFetch<{ id: string; title: string }[]>("/content");
  const [post, setPost] = useState<Partial<PostRow> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [connect, setConnect] = useState<Partial<Account> & { accessToken?: string } | null>(null);
  const [metricModal, setMetricModal] = useState<Partial<Metric> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const list = accounts || [];
  const account = list.find((a) => a.id === selected) || null;

  const { data: metrics, reload: reloadMetrics } = useFetch<Metric[]>(
    selected ? `/social/metrics?accountId=${selected}` : "/social/metrics", [selected || ""]
  );
  const rows = (selected ? metrics : [])?.slice(0, 60) || [];

  const saveConnect = async () => {
    if (!connect?.platform || !connect?.handle) return;
    setBusy(true);
    try {
      await api.post("/social/accounts", {
        platform: connect.platform, handle: connect.handle,
        displayName: connect.displayName, accessToken: connect.accessToken,
      });
      setConnect(null);
      reload();
      toast.push(tr("saved"), "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setBusy(false); }
  };

  const disconnect = async (id: string) => {
    if (!confirm(tr("confirmDelete"))) return;
    try {
      await api.del(`/social/accounts/${id}`);
      if (selected === id) setSelected(null);
      reload();
      toast.push(tr("deleted"), "success");
    } catch { toast.push(tr("deleteError"), "error"); }
  };

  const addMetric = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.post("/social/metrics", { accountId: selected, ...metricModal });
      setMetricModal(null);
      reloadMetrics();
      reload();
      toast.push(tr("saved"), "success");
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setBusy(false); }
  };

  const runImport = async () => {
    if (!selected || !importText.trim()) return;
    setBusy(true);
    try {
      const parsed = parseCsv(importText);
      const r = await api.post<{ inserted: number }>("/social/metrics/import", {
        accountId: selected, source: "CSV", rows: parsed,
      });
      setSyncMsg(`${tr("soc_imported")}: ${r.inserted}`);
      setImportOpen(false);
      setImportText("");
      reloadMetrics();
      reload();
    } finally { setBusy(false); }
  };

  const sync = async () => {
    if (!selected) return;
    setBusy(true);
    setSyncMsg("");
    try {
      await api.post(`/social/accounts/${selected}/sync`, {});
      reloadMetrics();
      reload();
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setSyncMsg(err.status === 422 ? tr("soc_syncNeedsApp") : (err.message || tr("loginError")));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900">{tr("soc_title")}</h1>
          <p className="text-sm text-ink-500">{list.length} {lang === "ar" ? "حساب" : "accounts"}</p>
        </div>
        <button onClick={() => setConnect({ platform: "INSTAGRAM" })} className="btn-amber">+ {tr("soc_connect")}</button>
      </div>

      {/* Account cards */}
      {loading ? <div className="py-10 text-center text-ink-500">{tr("loading")}</div>
        : list.length === 0 ? <Card><Empty text={tr("soc_noAccounts")} /></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((a) => (
            <button key={a.id} onClick={() => { setSelected(a.id); setSyncMsg(""); }}
              className={`rounded-xl2 border bg-white p-4 text-start transition ${selected === a.id ? "border-amber-500 ring-2 ring-amber-500/20" : "border-paper-200 hover:border-amber-500/40"}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-900 text-sm font-bold text-paper">{platformGlyph(a.platform)}</span>
                  <div>
                    <div className="font-semibold text-ink-900">{el(a.platform)}</div>
                    <div className="text-xs text-ink-500" dir="ltr">{a.handle}</div>
                  </div>
                </div>
                <StatusPill value={a.status} />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-paper-200 pt-2 text-xs text-ink-500">
                <span>{tr("soc_followers")}: <span className="kpi-num text-ink-700">{fmtNum(a.latestFollowers || 0, lang)}</span></span>
                <span>{a.metricCount || 0} {tr("soc_metrics")}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Selected account panel */}
      {account && (
        <Card>
          <SectionTitle action={
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setMetricModal({ date: new Date().toISOString().slice(0, 10) })} className="btn-ghost text-xs">+ {tr("soc_addMetric")}</button>
              <button onClick={() => setImportOpen(true)} className="btn-ghost text-xs">↥ {tr("soc_import")}</button>
              <button onClick={sync} disabled={busy} className="btn-ghost text-xs">⟳ {tr("soc_sync")}</button>
              <ExportButton resource="metrics" />
              <button onClick={() => disconnect(account.id)} className="text-xs text-clay-600 hover:underline">{tr("delete")}</button>
            </div>
          }>
            {el(account.platform)} · <span dir="ltr">{account.handle}</span>
          </SectionTitle>

          {syncMsg && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{syncMsg}</div>}

          {rows.length === 0 ? <Empty text={tr("noData")} /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-paper-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-3 py-2 text-start font-medium">{tr("date")}</th>
                  <th className="px-3 py-2 text-end font-medium">{tr("soc_followers")}</th>
                  <th className="px-3 py-2 text-end font-medium">{tr("soc_posts")}</th>
                  <th className="px-3 py-2 text-end font-medium">{tr("soc_reach")}</th>
                  <th className="px-3 py-2 text-end font-medium">{tr("soc_engagement")}</th>
                  <th className="px-3 py-2 text-end font-medium">{tr("soc_clicks")}</th>
                  <th className="px-3 py-2 text-start font-medium">{tr("source")}</th>
                </tr></thead>
                <tbody className="divide-y divide-paper-200">
                  {rows.map((m) => (
                    <tr key={m.id} className="hover:bg-paper-100/60">
                      <td className="px-3 py-2 text-ink-700">{fmtDate(m.date, lang)}</td>
                      <td className="px-3 py-2 text-end kpi-num text-ink-800">{fmtNum(m.followers, lang)}</td>
                      <td className="px-3 py-2 text-end kpi-num text-ink-600">{fmtNum(m.posts, lang)}</td>
                      <td className="px-3 py-2 text-end kpi-num text-ink-600">{fmtNum(m.reach, lang)}</td>
                      <td className="px-3 py-2 text-end kpi-num text-ink-600">{fmtNum(m.engagement, lang)}</td>
                      <td className="px-3 py-2 text-end kpi-num text-ink-600">{fmtNum(m.clicks, lang)}</td>
                      <td className="px-3 py-2"><StatusPill value={m.source} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Connect modal */}
      <Modal open={!!connect} onClose={() => setConnect(null)} title={tr("soc_connect")}
        footer={<>
          <button onClick={() => setConnect(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={saveConnect} disabled={busy} className="btn-amber">{tr("save")}</button>
        </>}>
        {connect && (
          <div className="space-y-3">
            <Field label={tr("soc_platform")}>
              <Select value={connect.platform || "INSTAGRAM"} onChange={(v) => setConnect({ ...connect, platform: v })}
                options={PLATFORMS.map((p) => ({ value: p, label: el(p) }))} />
            </Field>
            <Field label={tr("soc_handle")}>
              <input className="input" dir="ltr" placeholder="@saria.industrial" value={connect.handle || ""} onChange={(e) => setConnect({ ...connect, handle: e.target.value })} />
            </Field>
            <Field label={tr("soc_displayName")}>
              <input className="input" value={connect.displayName || ""} onChange={(e) => setConnect({ ...connect, displayName: e.target.value })} />
            </Field>
            <Field label={tr("soc_accessToken")}>
              <input className="input" dir="ltr" type="password" value={connect.accessToken || ""} onChange={(e) => setConnect({ ...connect, accessToken: e.target.value })} />
              <p className="mt-1 text-xs text-ink-500">{tr("soc_tokenHint")}</p>
            </Field>
          </div>
        )}
      </Modal>

      {/* Manual metric modal */}
      <Modal open={!!metricModal} onClose={() => setMetricModal(null)} title={tr("soc_addMetric")}
        footer={<>
          <button onClick={() => setMetricModal(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={addMetric} disabled={busy} className="btn-amber">{tr("save")}</button>
        </>}>
        {metricModal && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("date")}><input type="date" className="input" value={metricModal.date || ""} onChange={(e) => setMetricModal({ ...metricModal, date: e.target.value })} /></Field></div>
            {METRIC_FIELDS.map((f) => (
              <Field key={f} label={tr(`soc_${f === "spendUsd" ? "spend" : f}`)}>
                <input type="number" className="input" value={(metricModal[f] as number) ?? ""} onChange={(e) => setMetricModal({ ...metricModal, [f]: Number(e.target.value) })} />
              </Field>
            ))}
          </div>
        )}
      </Modal>

      {/* CSV import modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={tr("soc_import")}
        footer={<>
          <button onClick={() => setImportOpen(false)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={runImport} disabled={busy} className="btn-amber">{tr("soc_import")}</button>
        </>}>
        <p className="mb-2 text-xs text-ink-500">{tr("soc_importHelp")}</p>
        <textarea className="input font-mono text-xs" rows={8} dir="ltr"
          placeholder={"2026-06-01,12000,4,50000,42000,300,80,120\n2026-06-02,12080,5,53000,44000,360,95,0"}
          value={importText} onChange={(e) => setImportText(e.target.value)} />
      </Modal>

      {/* ── Post performance: the plan (content) meets the measurement (posts) ── */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <SectionTitle>{tr("po_title")}</SectionTitle>
            <p className="-mt-1 text-xs text-ink-500">{tr("po_sub")}</p>
          </div>
          {canWrite && <button onClick={() => setPost({ platform: "FACEBOOK", publishedAt: new Date().toISOString().slice(0, 10) })} className="btn-ghost text-xs">+ {tr("po_add")}</button>}
        </div>
        {!posts?.length ? <Empty text={tr("noData")} /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-paper-200 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-3 py-2 text-start font-medium">{tr("po_title")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("platform")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("po_er")}</th>
              <th className="px-3 py-2 text-start font-medium">{tr("lk_clicks")}</th>
              <th className="px-3 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-paper-200">
              {posts.map((p) => {
                const den = p.reach > 0 ? p.reach : p.impressions;
                const er = den > 0 ? Math.round((p.engagement / den) * 10000) / 100 : 0;
                return (
                  <tr key={p.id} className="hover:bg-paper-100/60">
                    <td className="px-3 py-2">
                      <div className="max-w-52 truncate font-medium text-ink-800">{p.contentTitle || p.url || "—"}</div>
                      <div className="text-[11px] text-ink-400">{p.pillar ? `${p.pillar} · ` : ""}{fmtDate(p.publishedAt, lang)}</div>
                    </td>
                    <td className="px-3 py-2 text-ink-600">{p.platform}</td>
                    <td className="px-3 py-2"><span className={`kpi-num ${er >= 1 ? "text-moss-600" : "text-ink-700"}`}>{er}%</span></td>
                    <td className="px-3 py-2 kpi-num text-ink-700">{p.clicks}</td>
                    <td className="px-3 py-2 text-end">
                      {canWrite && <button onClick={() => setPost(p)} className="text-xs text-steel-600 hover:underline">{tr("edit")}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>

      <Modal open={!!post} onClose={() => setPost(null)} title={tr("po_add")}
        footer={<><button onClick={() => setPost(null)} className="btn-ghost">{tr("cancel")}</button>
          <button onClick={async () => {
            if (!post) return;
            try {
              if (post.id) await api.patch(`/posts/${post.id}`, post);
              else await api.post("/posts", post);
              setPost(null); reloadPosts();
            } catch { toast.push(tr("saveError"), "error"); }
          }} className="btn-amber">{tr("save")}</button></>}>
        {post && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label={tr("nav_calendar")}>
              <Select value={post.contentId || ""} onChange={(v) => setPost({ ...post, contentId: v })} placeholder={tr("none")}
                options={(contentList || []).map((c) => ({ value: c.id, label: c.title }))} /></Field></div>
            <Field label={tr("platform")}><input className="input" value={post.platform || ""} onChange={(e) => setPost({ ...post, platform: e.target.value.toUpperCase() })} /></Field>
            <Field label={`${tr("lk_code")} (/r/…)`}><input className="input font-mono" dir="ltr" value={post.linkCode || ""} onChange={(e) => setPost({ ...post, linkCode: e.target.value.toLowerCase() })} /></Field>
            <Field label="Reach"><input className="input" type="number" value={post.reach ?? 0} onChange={(e) => setPost({ ...post, reach: +e.target.value })} /></Field>
            <Field label="Impressions"><input className="input" type="number" value={post.impressions ?? 0} onChange={(e) => setPost({ ...post, impressions: +e.target.value })} /></Field>
            <Field label="Engagement"><input className="input" type="number" value={post.engagement ?? 0} onChange={(e) => setPost({ ...post, engagement: +e.target.value })} /></Field>
            <Field label={tr("lk_clicks")}><input className="input" type="number" value={post.clicks ?? 0} onChange={(e) => setPost({ ...post, clicks: +e.target.value })} /></Field>
            <Field label="URL"><input className="input" dir="ltr" value={post.url || ""} onChange={(e) => setPost({ ...post, url: e.target.value })} /></Field>
            <Field label={tr("date")}><input className="input" type="date" value={(post.publishedAt || "").slice(0, 10)} onChange={(e) => setPost({ ...post, publishedAt: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

// Parse pasted CSV (optional header) into metric row objects.
function parseCsv(text: string) {
  const cols = ["date", "followers", "posts", "impressions", "reach", "engagement", "clicks", "spendUsd"];
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  const out: Record<string, string | number>[] = [];
  for (const line of lines) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells[0]?.toLowerCase() === "date") continue; // skip header
    const row: Record<string, string | number> = {};
    cols.forEach((c, i) => {
      const v = cells[i];
      if (v === undefined || v === "") return;
      row[c] = c === "date" ? v : Number(v);
    });
    if (row.date || Object.keys(row).length) out.push(row);
  }
  return out;
}

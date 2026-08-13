import { useState, useEffect } from "react";
import { Card, SectionTitle, Field, useFetch, UploadButton } from "../components/ui";
import { useI18n } from "../context/I18nContext";
import { useToast } from "../components/Toast";
import Departments from "./Departments";
import { useBranding } from "../context/BrandingContext";
import { api, download } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { applyAccent, PULSE_ACCENT } from "../lib/theme";

interface Setting {
  orgName: string; orgNameAr: string; usdToSdgRate: number;
  staleLeadDays?: number; customerReviewDays?: number;
  logoUrl?: string | null; accentColor?: string;
  localCurrency?: string; localCurrencyAr?: string;
  businessUnits?: string[] | string; modules?: Record<string, boolean> | string;
  onboarded?: boolean;
}

const ACCENT_PRESETS = [PULSE_ACCENT, "#C2603E", "#5E8B5A", "#3F7191", "#7A6CA8", "#3E8F8A"];
const MODULE_LIST: { key: string; nameKey: string; descKey: string }[] = [
  { key: "brain", nameKey: "mod_brain", descKey: "mod_brain_d" },
  { key: "intel", nameKey: "mod_intel", descKey: "mod_intel_d" },
  { key: "listening", nameKey: "mod_listening", descKey: "mod_listening_d" },
  { key: "social", nameKey: "mod_social", descKey: "mod_social_d" },
  { key: "media", nameKey: "mod_media", descKey: "mod_media_d" },
  { key: "events", nameKey: "mod_events", descKey: "mod_events_d" },
  { key: "planning", nameKey: "mod_planning", descKey: "mod_planning_d" },
  { key: "studio", nameKey: "mod_studio", descKey: "mod_studio_d" },
  { key: "agency", nameKey: "mod_agency", descKey: "mod_agency_d" },
  { key: "automate", nameKey: "mod_automate", descKey: "mod_automate_d" },
  { key: "research", nameKey: "mod_research", descKey: "mod_research_d" },
  { key: "publish", nameKey: "mod_publish", descKey: "mod_publish_d" },
  { key: "reach", nameKey: "mod_reach", descKey: "mod_reach_d" },
];
const asArr = (v?: string[] | string): string[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return []; } }
  return [];
};
const asObj = (v?: Record<string, boolean> | string): Record<string, boolean> => {
  if (v && typeof v === "object") return v as Record<string, boolean>;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return {}; } }
  return {};
};

export default function Settings() {
  const { lang, tr } = useI18n();
  const { refresh } = useBranding();
  const [setting, setSetting] = useState<Setting | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [buInput, setBuInput] = useState("");

  useEffect(() => {
    api.get<Setting>("/settings").then((s) =>
      setSetting({ ...s, businessUnits: asArr(s.businessUnits), modules: asObj(s.modules) })
    );
  }, []);

  const save = async () => {
    if (!setting) return;
    setSaving(true); setErr("");
    try {
      const r = await api.patch<Setting>("/settings", setting);
      setSetting({ ...r, businessUnits: asArr(r.businessUnits), modules: asObj(r.modules) });
      applyAccent(r.accentColor);
      await refresh(); // rail, login screen & currency labels pick the change up
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setSaving(false); }
  };

  if (!setting) return <div className="py-20 text-center text-ink-500">{tr("loading")}</div>;
  const units = asArr(setting.businessUnits);
  const mods = asObj(setting.modules);
  const addBu = () => {
    const v = buInput.trim();
    if (v && !units.includes(v)) setSetting({ ...setting, businessUnits: [...units, v] });
    setBuInput("");
  };

  return (
    <div className="max-w-xl space-y-4">
      <Card>
        <SectionTitle>{tr("nav_settings")}</SectionTitle>
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{tr("set_headOnly")}</p>

        <div className="space-y-5">
          {/* ── Identity & branding ─────────────────────────────── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">{tr("set_branding")}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={tr("set_orgNameAr")}>
                  <input className="input" value={setting.orgNameAr} onChange={(e) => setSetting({ ...setting, orgNameAr: e.target.value })} />
                </Field>
                <Field label={tr("set_orgName")}>
                  <input className="input" dir="ltr" value={setting.orgName} onChange={(e) => setSetting({ ...setting, orgName: e.target.value })} />
                </Field>
              </div>
              <Field label={tr("ob_logo")}>
                <div className="flex items-center gap-2">
                  <input className="input flex-1" dir="ltr" placeholder="https://…/logo.png" value={setting.logoUrl || ""}
                    onChange={(e) => setSetting({ ...setting, logoUrl: e.target.value })} />
                  <UploadButton entity="brand" isPublic onDone={(f) => setSetting({ ...setting, logoUrl: f.url })} />
                </div>
              </Field>
              <div>
                <span className="label">{tr("ob_accent")}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {ACCENT_PRESETS.map((hex) => (
                    <button key={hex} onClick={() => setSetting({ ...setting, accentColor: hex })} aria-label={hex}
                      className={`h-7 w-7 rounded-full border-2 transition ${(setting.accentColor || "").toUpperCase() === hex.toUpperCase() ? "border-ink-900 scale-110" : "border-transparent"}`}
                      style={{ background: hex }} />
                  ))}
                  <input type="color" value={setting.accentColor || PULSE_ACCENT}
                    onChange={(e) => setSetting({ ...setting, accentColor: e.target.value })}
                    className="h-7 w-9 cursor-pointer rounded border border-paper-300 bg-white p-0.5" aria-label={tr("ob_accent")} />
                </div>
                <p className="mt-1.5 text-xs text-ink-400">{tr("ob_accent_hint")}</p>
              </div>
            </div>
          </div>

          {/* ── Currency ────────────────────────────────────────── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">{tr("set_currency")}</h3>
            <div className="grid grid-cols-3 gap-3">
              <Field label={tr("ob_currency_code")}>
                <input className="input font-mono uppercase" dir="ltr" maxLength={5} value={setting.localCurrency || "SDG"}
                  onChange={(e) => setSetting({ ...setting, localCurrency: e.target.value.toUpperCase() })} />
              </Field>
              <Field label={tr("ob_currency_ar")}>
                <input className="input" value={setting.localCurrencyAr || ""}
                  onChange={(e) => setSetting({ ...setting, localCurrencyAr: e.target.value })} />
              </Field>
              <Field label={tr("set_exchange")}>
                <input type="number" className="input" dir="ltr" value={setting.usdToSdgRate}
                  onChange={(e) => setSetting({ ...setting, usdToSdgRate: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="mt-2 rounded-lg bg-paper-100 px-3 py-2 text-sm text-ink-600">
              1 USD = <span className="kpi-num text-ink-800">{fmtMoney(setting.usdToSdgRate, "SDG", lang)}</span>
            </div>
          </div>

          {/* ── Business units ──────────────────────────────────── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">{tr("set_bu")}</h3>
            <div className="flex gap-2">
              <input className="input" placeholder={tr("ob_bu_placeholder")} value={buInput}
                onChange={(e) => setBuInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addBu())} />
              <button onClick={addBu} className="btn-ghost shrink-0">+ {tr("add")}</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {units.map((u) => (
                <span key={u} className="pill bg-amber-50 text-amber-700">
                  {u}
                  <button onClick={() => setSetting({ ...setting, businessUnits: units.filter((x) => x !== u) })}
                    className="ms-1 text-amber-700/70 hover:text-amber-700" aria-label={tr("delete")}>✕</button>
                </span>
              ))}
              {units.length === 0 && <span className="text-xs text-ink-300">—</span>}
            </div>
          </div>

          {/* ── Modules ─────────────────────────────────────────── */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-700">{tr("set_modules")}</h3>
            <p className="mb-2 text-xs text-ink-500">{tr("ob_modules_hint")}</p>
            <div className="space-y-1.5">
              {MODULE_LIST.map((m) => {
                const on = mods[m.key] !== false;
                return (
                  <button key={m.key} onClick={() => setSetting({ ...setting, modules: { ...mods, [m.key]: !on } })}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-start transition ${on ? "border-amber-500/40 bg-amber-50/60" : "border-paper-200 bg-white opacity-70"}`}>
                    <span>
                      <span className="block text-sm font-medium text-ink-800">{tr(m.nameKey)}</span>
                      <span className="block text-xs text-ink-500">{tr(m.descKey)}</span>
                    </span>
                    <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-amber-500" : "bg-paper-300"}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "start-[1.125rem]" : "start-0.5"}`} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Ops thresholds ──────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${tr("n_SWEEP_STALE_LEADS")} (${tr("date")})`}>
              <input className="input" type="number" min={1} value={setting.staleLeadDays ?? 3} onChange={(e) => setSetting({ ...setting, staleLeadDays: +e.target.value })} />
            </Field>
            <Field label={`${tr("cu_nextReview")} (${tr("date")})`}>
              <input className="input" type="number" min={7} value={setting.customerReviewDays ?? 90} onChange={(e) => setSetting({ ...setting, customerReviewDays: +e.target.value })} />
            </Field>
          </div>

          {err && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{err}</div>}
          <div className="flex items-center gap-3 pt-1">
            <button onClick={save} disabled={saving} className="btn-amber">{tr("save")}</button>
            {saved && <span className="text-sm text-moss-600">✓ {tr("set_saved")}</span>}
          </div>
        </div>
      </Card>

      <Departments />
      <AiRail />
      <StorageCard />
      <MailRail />
      <Integrations />
      <TemplatesManager />
      <AuditTrail />
      <SovereignBackup />
    </div>
  );
}

interface Tpl { id: string; key: string; name: string; nameAr?: string; builtin: boolean; tasks: { t: { ar: string; en: string }; offset: number; priority: string }[] }

function TemplatesManager() {
  const { lang, tr } = useI18n();
  const { data, reload } = useFetch<Tpl[]>("/templates");
  const [editing, setEditing] = useState<{ id?: string; key: string; name: string; nameAr: string; tasksJson: string } | null>(null);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!editing) return;
    let tasks;
    try { tasks = JSON.parse(editing.tasksJson); } catch { setErr("JSON?"); return; }
    try {
      if (editing.id) await api.patch(`/templates/${editing.id}`, { name: editing.name, nameAr: editing.nameAr, tasks });
      else await api.post("/templates", { key: editing.key, name: editing.name, nameAr: editing.nameAr, tasks });
      setEditing(null); setErr(""); reload();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div><SectionTitle>{tr("tp_title")}</SectionTitle><p className="-mt-1 text-sm text-ink-500">{tr("tp_sub")}</p></div>
        <button onClick={() => setEditing({ key: "", name: "", nameAr: "", tasksJson: '[\n  {"t":{"ar":"مهمة","en":"Task"},"offset":0,"priority":"HIGH"}\n]' })} className="btn-ghost text-xs">+ {tr("tp_add")}</button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {(data || []).map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm">
            <div>
              <span className="font-medium text-ink-800">{lang === "ar" && t.nameAr ? t.nameAr : t.name}</span>
              <span className="ms-2 font-mono text-[11px] text-ink-400">{t.key} · {t.tasks.length}</span>
            </div>
            {t.builtin ? <span className="pill bg-paper-200 text-[10px] text-ink-500" title={tr("tp_locked")}>🔒</span> : (
              <div className="flex gap-2 text-xs">
                <button onClick={() => setEditing({ id: t.id, key: t.key, name: t.name, nameAr: t.nameAr || "", tasksJson: JSON.stringify(t.tasks, null, 1) })} className="text-steel-600 hover:underline">{tr("edit")}</button>
                <button onClick={async () => { if (confirm(tr("confirmDelete"))) { await api.del(`/templates/${t.id}`).catch(() => {}); reload(); } }} className="text-clay-600 hover:underline">{tr("delete")}</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <div className="mt-3 space-y-2 rounded-lg border border-paper-200 bg-paper-100/40 p-3">
          <div className="grid grid-cols-3 gap-2">
            <Field label="key"><input className="input font-mono" dir="ltr" disabled={!!editing.id} value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} /></Field>
            <Field label="Name"><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="الاسم"><input className="input" value={editing.nameAr} onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })} /></Field>
          </div>
          <Field label={tr("tp_tasksJson")}>
            <textarea className="input h-36 font-mono text-xs" dir="ltr" value={editing.tasksJson} onChange={(e) => setEditing({ ...editing, tasksJson: e.target.value })} />
          </Field>
          {err && <p className="text-xs text-clay-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="btn-ghost">{tr("cancel")}</button>
            <button onClick={save} className="btn-amber">{tr("save")}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

interface AuditRow { id: string; actorName: string; action: string; entity: string; entityId?: string; createdAt: string }

function AuditTrail() {
  const { lang, tr } = useI18n();
  const { data, loading } = useFetch<AuditRow[]>("/audit?limit=60");
  return (
    <Card>
      <SectionTitle>{tr("audit_title")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("audit_subtitle")}</p>
      {loading ? (
        <div className="skeleton h-24" />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-ink-500">{tr("audit_empty")}</p>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border border-paper-200">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-paper-200">
              {data.map((a) => (
                <tr key={a.id} className="hover:bg-paper-100/60">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-ink-400">{fmtDate(a.createdAt, lang)}</td>
                  <td className="px-3 py-2 font-medium text-ink-700">{a.actorName}</td>
                  <td className="px-3 py-2"><span className="pill bg-steel-500/12 font-mono text-[11px] text-steel-600">{a.action}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SovereignBackup() {
  const { tr } = useI18n();
  const grab = () => download("/export/backup", `pulse-backup-${new Date().toISOString().slice(0, 10)}.json`).catch(() => {});
  return (
    <Card>
      <SectionTitle>{tr("bk_title")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("bk_subtitle")}</p>
      <button onClick={grab} className="btn-ghost">⬇ {tr("bk_download")}</button>
    </Card>
  );
}

// ── Wave 2·A · outbound mail: an HTTP provider or your own SMTP ──────
interface MailCfg {
  provider?: string; host?: string; port?: number; secure?: boolean; user?: string;
  from?: string; fromName?: string; apiUrl?: string; hasPass?: boolean; hasKey?: boolean;
}

function MailRail() {
  const { tr } = useI18n();
  const toast = useToast();
  const [m, setM] = useState<MailCfg | null>(null);
  const [pass, setPass] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [adv, setAdv] = useState(false);

  useEffect(() => { api.get<{ mail?: MailCfg }>("/settings").then((s) => setM(s.mail || {})); }, []);
  if (!m) return null;

  const mode = m.provider || (m.hasKey ? "RESEND" : m.host ? "SMTP" : "");
  const live = mode === "RESEND" ? !!(m.hasKey || key) && !!m.from : mode === "SMTP" ? !!m.host && !!m.user && (!!m.hasPass || !!pass) && !!m.from : false;

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.patch<{ mail: MailCfg }>("/settings", {
        mail: { ...m, provider: mode, pass: pass || undefined, apiKey: key || undefined },
      });
      setM(r.mail || {}); setPass(""); setKey(""); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ status: string; configured: boolean; to: string }>("/mail/test", {});
      toast.push(
        r.status === "SENT" ? `${tr("ml_sentTo")} ${r.to}` : r.status === "LOGGED" ? tr("ml_logged") : tr("ml_failed"),
        r.status === "FAILED" ? "error" : "success");
    } catch (e) { toast.push((e as Error).message, "error"); } finally { setBusy(false); }
  };

  const Tab = ({ id, label, hint }: { id: string; label: string; hint: string }) => (
    <button onClick={() => setM({ ...m, provider: id })}
      className={`flex-1 rounded-xl border px-3 py-2.5 text-start transition ${mode === id ? "border-amber-500 bg-amber-500/10" : "border-paper-200 hover:bg-paper-100"}`}>
      <div className={`text-sm font-semibold ${mode === id ? "text-amber-700" : "text-ink-800"}`}>{label}</div>
      <div className="mt-0.5 text-[11px] text-ink-500">{hint}</div>
    </button>
  );

  return (
    <Card>
      <SectionTitle>{tr("ml_title")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("ml_sub")}</p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Tab id="RESEND" label={tr("ml_resend")} hint={tr("ml_resendHint")} />
        <Tab id="SMTP" label={tr("ml_smtp")} hint={tr("ml_smtpHint")} />
      </div>

      {!live && <div className="mt-3 rounded-xl bg-paper-200 px-3 py-2 text-xs text-ink-600">{tr("ml_logMode")}</div>}

      {mode === "RESEND" && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label={tr("ml_apiKey")}>
            <input className="input" dir="ltr" type="password" placeholder={m.hasKey ? "••••••••" : "re_..."} value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Field label={tr("ml_from")}><input className="input" dir="ltr" placeholder="pulse@company.com" value={m.from || ""} onChange={(e) => setM({ ...m, from: e.target.value })} /></Field>
          <Field label={tr("ml_fromName")}><input className="input" value={m.fromName || ""} onChange={(e) => setM({ ...m, fromName: e.target.value })} /></Field>
        </div>
      )}

      {mode === "SMTP" && (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label={tr("ml_host")}><input className="input" dir="ltr" placeholder="smtp.gmail.com" value={m.host || ""} onChange={(e) => setM({ ...m, host: e.target.value })} /></Field>
            <Field label={tr("ml_port")}><input className="input kpi-num" dir="ltr" type="number" placeholder="587" value={m.port ?? 587} onChange={(e) => setM({ ...m, port: Number(e.target.value) })} /></Field>
            <Field label={tr("ml_user")}><input className="input" dir="ltr" value={m.user || ""} onChange={(e) => setM({ ...m, user: e.target.value })} /></Field>
            <Field label={tr("ml_pass")}>
              <input className="input" dir="ltr" type="password" placeholder={m.hasPass ? "••••••••" : ""} value={pass} onChange={(e) => setPass(e.target.value)} />
            </Field>
            <Field label={tr("ml_from")}><input className="input" dir="ltr" placeholder="pulse@company.com" value={m.from || ""} onChange={(e) => setM({ ...m, from: e.target.value })} /></Field>
            <Field label={tr("ml_fromName")}><input className="input" value={m.fromName || ""} onChange={(e) => setM({ ...m, fromName: e.target.value })} /></Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" className="accent-amber-500" checked={!!m.secure} onChange={(e) => setM({ ...m, secure: e.target.checked })} />
            {tr("ml_secure")}
          </label>
        </>
      )}

      {mode && (
        <div className="mt-3">
          <button onClick={() => setAdv(!adv)} className="text-[11px] text-ink-500 hover:text-ink-700">{adv ? "▾" : "▸"} {tr("ml_advanced")}</button>
          {adv && (
            <div className="mt-2">
              <Field label={tr("ml_apiUrl")}>
                <input className="input" dir="ltr" placeholder="https://api.resend.com/emails" value={m.apiUrl || ""} onChange={(e) => setM({ ...m, apiUrl: e.target.value })} />
              </Field>
              <p className="mt-1 text-[11px] text-ink-400">{tr("ml_apiUrlHint")}</p>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-ink-400">{mode === "SMTP" ? tr("ml_hint") : tr("ml_resendWhy")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={save} disabled={busy} className="btn-amber">{tr("save")}</button>
        <button onClick={test} disabled={busy} className="btn-ghost">✉ {tr("ml_test")}</button>
      </div>
    </Card>
  );
}

// ── Wave 2·B · integrations: secrets in, webhook URLs out ────────────
interface WaCfg { verifyToken?: string; appSecret?: string; apiUrl?: string; hasVerifyToken?: boolean; hasAppSecret?: boolean }

function Integrations() {
  const { tr } = useI18n();
  const toast = useToast();
  const [wa, setWa] = useState<WaCfg | null>(null);
  const [vt, setVt] = useState("");
  const [sec, setSec] = useState("");
  const runs = useFetch<{ id: string; platform: string; kind: string; status: string; detail?: string; at: string }[]>("/integration-runs");

  useEffect(() => { api.get<{ integrations?: Record<string, WaCfg> }>("/settings").then((s) => setWa(s.integrations?.wa || {})); }, []);
  if (!wa) return null;

  const hook = `${window.location.origin}/api/public/hooks/wa`;
  const save = async () => {
    try {
      const r = await api.patch<{ integrations?: Record<string, WaCfg> }>("/settings", {
        integrations: { wa: { ...wa, verifyToken: vt || undefined, appSecret: sec || undefined } },
      });
      setWa(r.integrations?.wa || {}); setVt(""); setSec(""); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  return (
    <Card>
      <SectionTitle>{tr("cn_title")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("cn_sub")}</p>

      <div className="rounded-xl border border-paper-200 p-3">
        <div className="text-sm font-semibold text-ink-800">💬 {tr("cn_wa")}</div>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <Field label={tr("cn_verifyToken")}>
            <input className="input" dir="ltr" type="password" placeholder={wa.hasVerifyToken ? "••••••••" : ""} value={vt} onChange={(e) => setVt(e.target.value)} />
          </Field>
          <Field label={tr("cn_appSecret")}>
            <input className="input" dir="ltr" type="password" placeholder={wa.hasAppSecret ? "••••••••" : ""} value={sec} onChange={(e) => setSec(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <div className="text-xs text-ink-500">{tr("cn_hookUrl")}</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="kpi-num flex-1 truncate rounded-lg bg-paper-200 px-2 py-1.5 text-[11px] text-ink-700" dir="ltr">{hook}</code>
            <button onClick={() => { navigator.clipboard.writeText(hook); toast.push(tr("copied"), "success"); }} className="btn-ghost text-xs">📋</button>
          </div>
        </div>
        <button onClick={save} className="btn-amber mt-3">{tr("save")}</button>
      </div>

      <div className="mt-4">
        <div className="text-xs font-bold uppercase tracking-wide text-ink-400">{tr("cn_runs")}</div>
        {!runs.data?.length ? <p className="mt-1 text-sm text-ink-400">{tr("cn_noRuns")}</p> : (
          <div className="mt-1 space-y-1">
            {runs.data.slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${r.status === "OK" ? "bg-moss-500" : "bg-clay-500"}`} />
                  <span className="kpi-num text-ink-600" dir="ltr">{r.platform} · {r.kind}</span>
                </span>
                <span className="truncate text-[11px] text-ink-400">{r.detail || ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Wave 2·C · where the bytes actually live ─────────────────────────
function StorageCard() {
  const { tr } = useI18n();
  const { data } = useFetch<{ driver: string; files: number; bytes: number; maxBytes: number }>("/storage");
  if (!data) return null;
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  return (
    <Card>
      <SectionTitle>{tr("sto_title")}</SectionTitle>
      <p className="-mt-1 text-sm text-ink-500">
        {data.driver === "SUPABASE" ? tr("sto_supabase") : tr("sto_db")}
      </p>
      <div className="mt-3 flex flex-wrap gap-6 text-sm">
        <div><div className="kpi-num text-lg font-bold text-ink-900" dir="ltr">{data.files}</div><div className="text-[11px] text-ink-500">{tr("sto_files")}</div></div>
        <div><div className="kpi-num text-lg font-bold text-ink-900" dir="ltr">{mb(data.bytes)}</div><div className="text-[11px] text-ink-500">{tr("sto_used")}</div></div>
        <div><div className="kpi-num text-lg font-bold text-ink-900" dir="ltr">{mb(data.maxBytes)}</div><div className="text-[11px] text-ink-500">{tr("sto_max")}</div></div>
      </div>
      <p className="mt-2 text-[11px] text-ink-400">{tr("sto_hint")}</p>
    </Card>
  );
}

// ── Wave 3·C · the AI rail: what it costs, and what it refused ───────
interface AiStatus {
  configured: boolean; model: string; monthlyCapUsd: number; spentThisMonth: number; pctOfCap: number;
  byStatus: Record<string, number>;
  recent: { feature: string; status: string; costUsd: number; latencyMs?: number; detail?: string; at: string }[];
}

function AiRail() {
  const { tr } = useI18n();
  const toast = useToast();
  const { data, reload } = useFetch<AiStatus>("/ai/status");
  const [key, setKey] = useState("");
  const [cap, setCap] = useState("");
  if (!data) return null;

  const save = async () => {
    try {
      await api.patch("/settings", {
        integrations: { ai: { ...(key ? { apiKey: key } : {}), ...(cap ? { monthlyCapUsd: Number(cap) } : {}), enabled: true } },
      });
      setKey(""); setCap(""); reload(); toast.push(tr("saved"), "success");
    } catch (e) { toast.push((e as Error).message, "error"); }
  };

  const tone = data.pctOfCap >= 100 ? "bg-clay-500" : data.pctOfCap >= 80 ? "bg-amber-500" : "bg-moss-500";

  return (
    <Card>
      <SectionTitle>{tr("ai_title")}</SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-500">{tr("ai_sub")}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={tr("ai_key")}>
          <input className="input" dir="ltr" type="password" placeholder={data.configured ? "••••••••" : "sk-ant-…"}
            value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label={tr("ai_cap")}>
          <input className="input" dir="ltr" type="number" placeholder={String(data.monthlyCapUsd)}
            value={cap} onChange={(e) => setCap(e.target.value)} />
        </Field>
      </div>
      <button onClick={save} className="btn-amber mt-3">{tr("save")}</button>

      {data.configured && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-600">{tr("ai_spend")}</span>
            <span className="kpi-num text-ink-900" dir="ltr">
              ${data.spentThisMonth.toFixed(2)} / ${data.monthlyCapUsd}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-paper-200">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, data.pctOfCap)}%` }} />
          </div>
          {data.pctOfCap >= 80 && <p className="mt-1 text-[11px] text-amber-700">{tr("ai_near")}</p>}

          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-500">
            {Object.entries(data.byStatus).map(([k, v]) => (
              <span key={k}>{tr(`ai_st_${k}`)}: <span className="kpi-num font-bold text-ink-800" dir="ltr">{v}</span></span>
            ))}
          </div>

          <div className="mt-3 space-y-1">
            {data.recent.slice(0, 8).map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    r.status === "OK" || r.status === "CACHED" ? "bg-moss-500"
                      : r.status === "FAILED" ? "bg-clay-500" : "bg-ink-300"}`} />
                  <span className="kpi-num truncate text-ink-600" dir="ltr">{r.feature}</span>
                </span>
                <span className="shrink-0 text-[10px] text-ink-400" dir="ltr">
                  {r.status}{Number(r.costUsd) > 0 ? ` · $${Number(r.costUsd).toFixed(4)}` : ""}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-ink-400">{tr("ai_laws")}</p>
        </div>
      )}
    </Card>
  );
}

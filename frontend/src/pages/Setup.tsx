import { useState } from "react";
import { useI18n } from "../context/I18nContext";
import { api, tokenStore } from "../lib/api";
import { t } from "../locales/dict";
import PulseMark, { EcgLoader } from "../components/PulseMark";

// ── The Pulse installer (Wave 0) ─────────────────────────────────────
// Shown only while the instance has ZERO users. One minute of setup:
// name the organization, create the first admin, and the platform is live.
// The server permanently locks this door the moment the first user exists.

export default function Setup() {
  const { lang, tr, toggle } = useI18n();
  const [form, setForm] = useState({ orgName: "", orgNameAr: "", name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    setError("");
    if (form.password.length < 8) return setError(tr("setup_pw_short"));
    if (form.password !== form.confirm) return setError(tr("setup_pw_mismatch"));
    setBusy(true);
    try {
      const r = await api.post<{ token: string }>("/setup", {
        name: form.name, email: form.email, password: form.password,
        orgName: form.orgName || undefined, orgNameAr: form.orgNameAr || undefined,
      });
      tokenStore.set(r.token);
      // Clean bootstrap: auth + branding re-read everything from the server.
      window.location.assign("/");
    } catch (e) {
      setError((e as Error).message || tr("login_serverError"));
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Welcome panel */}
      <div className="relative hidden overflow-hidden bg-ink-900 text-paper lg:flex lg:flex-col lg:justify-between p-12">
        <div className="absolute inset-0 bg-grid opacity-[0.25]" style={{ ["--grid-line" as string]: "rgba(255,255,255,0.06)" }} />
        <div className="relative flex items-center gap-3">
          <PulseMark size={44} />
          <div>
            <div className="text-lg font-bold tracking-wide">{tr("appName")}</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-paper-200/50">{tr("appTagline")}</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-snug">{tr("setup_welcome")}</h1>
          <p className="mt-4 text-sm leading-relaxed text-paper-200/60">{tr("setup_sub")}</p>
          <div className="mt-8 text-amber-500/80"><EcgLoader /></div>
        </div>
        <div className="relative text-xs text-paper-200/40">{tr("poweredBy")}</div>
      </div>

      {/* Installer form */}
      <div className="flex items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-ink-900">{tr("setup_admin_title")}</h2>
              <p className="mt-1 text-sm text-ink-500">{tr("setup_done_next")}</p>
            </div>
            <button onClick={toggle} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-paper-300 bg-white text-sm font-semibold text-ink-700 hover:bg-paper-100">
              {t.langToggle[lang]}
            </button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">{tr("set_orgNameAr")}</span>
                <input className="input" value={form.orgNameAr} onChange={set("orgNameAr")} />
              </label>
              <label className="block">
                <span className="label">{tr("set_orgName")}</span>
                <input className="input" dir="ltr" value={form.orgName} onChange={set("orgName")} />
              </label>
            </div>
            <label className="block">
              <span className="label">{tr("setup_name")}</span>
              <input className="input" value={form.name} onChange={set("name")} />
            </label>
            <label className="block">
              <span className="label">{tr("email")}</span>
              <input className="input" type="email" dir="ltr" value={form.email} onChange={set("email")} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">{tr("password")}</span>
                <input className="input" type="password" dir="ltr" value={form.password} onChange={set("password")} />
              </label>
              <label className="block">
                <span className="label">{tr("setup_confirm")}</span>
                <input className="input" type="password" dir="ltr" value={form.confirm} onChange={set("confirm")}
                  onKeyDown={(e) => e.key === "Enter" && submit()} />
              </label>
            </div>

            {error && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{error}</div>}

            <button onClick={submit} disabled={busy || !form.name || !form.email || !form.password} className="btn-amber w-full">
              {busy ? tr("loading") : tr("setup_create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

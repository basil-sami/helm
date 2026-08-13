import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { useBranding } from "../context/BrandingContext";
import { t } from "../locales/dict";
import PulseMark, { EcgLoader } from "../components/PulseMark";
import { api } from "../lib/api";

export default function Login() {
  const { login } = useAuth();
  const { lang, tr, toggle } = useI18n();
  const { branding } = useBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState<{ enabled: boolean; required: boolean; name?: string } | null>(null);

  useEffect(() => { api.get<{ enabled: boolean; required: boolean; name?: string }>("/auth/sso/config").then(setSso).catch(() => {}); }, []);

  const org = (lang === "ar" ? branding.orgNameAr || branding.orgName : branding.orgName) || "";

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await login(email, password, otp || undefined);
    } catch (e) {
      const err = e as { status?: number; body?: Record<string, unknown> };
      if (err?.body?.otpRequired) { setNeedOtp(true); setError(otp ? tr("loginError") : ""); }
      else if (err.status === 401 || err.status === 400) setError(tr("loginError"));
      else if (err.status && err.status >= 500) setError(tr("login_serverError"));
      else setError(tr("login_networkError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand / command-room panel */}
      <div className="relative hidden overflow-hidden bg-ink-900 text-paper lg:flex lg:flex-col lg:justify-between p-12">
        <div className="absolute inset-0 bg-grid opacity-[0.25]" style={{ ["--grid-line" as string]: "rgba(255,255,255,0.06)" }} />
        <div className="relative flex items-center gap-3">
          <PulseMark size={44} logoUrl={branding.logoUrl} />
          <div>
            <div className="text-lg font-bold tracking-wide">{org || tr("appName")}</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-paper-200/50">{tr("appTagline")}</div>
          </div>
        </div>

        <div className="relative max-w-md">
          {org && (
            <div className="mb-3 inline-block rounded-full border border-amber-500/40 px-3 py-1 text-xs text-amber-400">
              {org}
            </div>
          )}
          <h1 className="text-3xl font-bold leading-snug">
            {tr("login_heroTitle")}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-paper-200/60">{tr("login_heroBody")}</p>
          <div className="mt-8 text-amber-500/80">
            <EcgLoader />
          </div>
        </div>

        <div className="relative flex items-center justify-between text-xs text-paper-200/40">
          <span>© {new Date().getFullYear()} {org || "Pulse"}</span>
          <span className="tracking-wide">{tr("poweredBy")}</span>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-ink-900">{tr("login_title")}</h2>
              <p className="mt-1 text-sm text-ink-500">{tr("login_subtitle")}</p>
            </div>
            <button onClick={toggle} className="grid h-9 w-9 place-items-center rounded-lg border border-paper-300 bg-white text-sm font-semibold text-ink-700 hover:bg-paper-100">
              {t.langToggle[lang]}
            </button>
          </div>

          <div className="space-y-4">
            {sso?.enabled && (
              <>
                <a href="/api/auth/sso/start" className="btn-ghost block w-full text-center">
                  {lang === "ar" ? `الدخول عبر ${sso.name || "SSO"}` : `Continue with ${sso.name || "SSO"}`}
                </a>
                 <div className="flex items-center gap-3 text-xs text-ink-400"><span className="h-px flex-1 bg-paper-300" /><span>{sso.required ? (lang === "ar" ? "أو حساب الطوارئ" : "or break-glass account") : (lang === "ar" ? "أو حساب محلي" : "or local account")}</span><span className="h-px flex-1 bg-paper-300" /></div>
              </>
            )}
            <label className="block">
              <span className="label">{tr("email")}</span>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
            </label>
            <label className="block">
              <span className="label">{tr("password")}</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </label>
            {needOtp && (
              <label className="block">
                <span className="label">{tr("sec_otp")}</span>
                <input className="input font-mono" inputMode="numeric" value={otp} dir="ltr"
                  onChange={(e) => setOtp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
              </label>
            )}

            {error && <div className="rounded-lg bg-clay-500/10 px-3 py-2 text-sm text-clay-600">{error}</div>}

            <button onClick={submit} disabled={busy} className="btn-amber w-full">
              {busy ? tr("loading") : tr("signIn")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

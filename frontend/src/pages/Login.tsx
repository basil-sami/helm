import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { t } from "../locales/dict";

export default function Login() {
  const { login } = useAuth();
  const { lang, tr, toggle } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needOtp, setNeedOtp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await login(email, password, otp || undefined);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 401 || status === 400) setError(tr("loginError"));
      else if (status && status >= 500) setError(tr("login_serverError"));
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
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-amber-500 text-2xl font-bold text-ink-950">ح</div>
          <div>
            <div className="text-lg font-bold tracking-wide">{tr("appName")}</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-paper-200/50">{tr("appTagline")}</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <div className="mb-3 inline-block rounded-full border border-amber-500/40 px-3 py-1 text-xs text-amber-400">
            Saria Industrial Complex
          </div>
          <h1 className="text-3xl font-bold leading-snug">
            {lang === "ar"
              ? "غرفة التحكم في تسويق مجمع ساريا الصناعي"
              : "The control room for Saria's marketing department"}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-paper-200/60">
            {lang === "ar"
              ? "حملات، محتوى، عملاء محتملون، فعاليات، وميزانية بالدولار والجنيه — في نظام واحد يعمل محلياً."
              : "Campaigns, content, leads, events and dual-currency budgets — one locally-hosted system."}
          </p>
        </div>

        <div className="relative text-xs text-paper-200/40">© {new Date().getFullYear()} Saria Industrial Complex</div>
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

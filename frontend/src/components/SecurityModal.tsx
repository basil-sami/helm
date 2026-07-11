import { useState } from "react";
import { Modal, Field } from "./ui";
import { api, tokenStore } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../context/I18nContext";
import { useToast } from "./Toast";

export default function SecurityModal({ open, onClose, forced = false }: { open: boolean; onClose: () => void; forced?: boolean }) {
  const { tr } = useI18n();
  const { user, logout } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState(""); const [nw, setNw] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [otp, setOtp] = useState(""); const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [twofa, setTwofa] = useState(!!user?.totpEnabled);

  const changePw = async () => {
    if (nw.length < 8) return;
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current: cur, next: nw });
      toast.push(tr("sec_changed"), "success");
      tokenStore.clear(); location.reload();
    } catch { toast.push(tr("saveError"), "error"); }
    finally { setBusy(false); }
  };
  const setup2fa = async () => {
    const r = await api.post<{ secret: string }>("/auth/totp/setup", {}).catch(() => null);
    if (r) setSecret(r.secret);
  };
  const enable2fa = async () => {
    setBusy(true);
    try { await api.post("/auth/totp/enable", { otp }); setTwofa(true); setSecret(null); setOtp(""); toast.push("✓ 2FA", "success"); }
    catch { toast.push(tr("saveError"), "error"); }
    finally { setBusy(false); }
  };
  const disable2fa = async () => {
    setBusy(true);
    try { await api.post("/auth/totp/disable", { password: pw2 }); setTwofa(false); setPw2(""); }
    catch { toast.push(tr("saveError"), "error"); }
    finally { setBusy(false); }
  };
  const logoutAll = async () => {
    await api.post("/auth/logout-all", {}).catch(() => {});
    toast.push(tr("sec_loggedOutAll"), "success");
    logout();
  };

  return (
    <Modal open={open} onClose={forced ? () => {} : onClose} title={`🔐 ${tr("sec_title")}`}
      footer={!forced ? <button onClick={onClose} className="btn-ghost">{tr("cancel")}</button> : undefined}>
      <div className="space-y-5">
        {forced && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{tr("sec_mustChange")}</div>}

        <div>
          <div className="mb-2 text-sm font-semibold text-ink-800">{tr("sec_changePw")}</div>
          <div className="space-y-2">
            <Field label={tr("sec_current")}><input className="input" dir="ltr" type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field label={tr("sec_new")}><input className="input" dir="ltr" type="password" value={nw} onChange={(e) => setNw(e.target.value)} /></Field>
            <button onClick={changePw} disabled={busy || nw.length < 8} className="btn-amber w-full">{tr("save")}</button>
          </div>
        </div>

        {!forced && (
          <>
            <div className="border-t border-paper-200 pt-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-ink-800">{tr("sec_2fa")}</span>
                <span className={`pill ${twofa ? "bg-moss-500/15 text-moss-700" : "bg-paper-200 text-ink-500"}`}>{twofa ? tr("sec_2faOn") : tr("sec_2faOff")}</span>
              </div>
              {!twofa && !secret && <button onClick={setup2fa} className="btn-ghost w-full">{tr("sec_2faSetup")}</button>}
              {secret && (
                <div className="space-y-2">
                  <p className="text-xs text-ink-500">{tr("sec_2faSecret")}</p>
                  <div className="select-all rounded-lg bg-ink-900 px-3 py-2 text-center font-mono text-sm tracking-widest text-amber-400" dir="ltr">{secret}</div>
                  <Field label={tr("sec_otp")}><input className="input text-center font-mono" dir="ltr" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} /></Field>
                  <button onClick={enable2fa} disabled={busy || otp.length !== 6} className="btn-amber w-full">{tr("sec_2faSetup")}</button>
                </div>
              )}
              {twofa && (
                <div className="flex gap-2">
                  <input className="input flex-1" dir="ltr" type="password" placeholder="••••••••" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                  <button onClick={disable2fa} disabled={busy || !pw2} className="btn-ghost shrink-0 text-clay-600">{tr("sec_2faDisable")}</button>
                </div>
              )}
            </div>
            <button onClick={logoutAll} className="w-full rounded-lg border border-clay-500/30 px-3 py-2 text-sm text-clay-600 hover:bg-clay-500/5">
              {tr("sec_logoutAll")}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

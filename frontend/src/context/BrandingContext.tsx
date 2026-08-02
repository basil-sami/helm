import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";
import { applyAccent } from "../lib/theme";
import { setLocalCurrency } from "../lib/format";

// ── Per-client branding & module flags (Wave 0) ──────────────────────
// Pre-login: the public /setup/status endpoint supplies exactly what the
// login screen shows (org name, logo, accent, currency, needsSetup).
// Post-login: the authoritative /settings row adds module flags & onboarding.

export interface Branding {
  orgName?: string | null;
  orgNameAr?: string | null;
  logoUrl?: string | null;
  accentColor?: string | null;
  localCurrency?: string | null;
  localCurrencyAr?: string | null;
}

export type Modules = Record<string, boolean>;

interface BrandingCtx {
  branding: Branding;
  needsSetup: boolean;
  onboarded: boolean;
  modules: Modules;
  moduleOn: (key: string) => boolean;
  ready: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<BrandingCtx>(null as unknown as BrandingCtx);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [branding, setBranding] = useState<Branding>({});
  const [needsSetup, setNeedsSetup] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const [modules, setModules] = useState<Modules>({});
  const [ready, setReady] = useState(false);

  const adopt = (b: Branding) => {
    setBranding((prev) => ({ ...prev, ...b }));
    applyAccent(b.accentColor);
    setLocalCurrency(b.localCurrency, b.localCurrencyAr);
  };

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<{ needsSetup: boolean; onboarded: boolean; branding: Branding }>("/setup/status");
      setNeedsSetup(s.needsSetup);
      setOnboarded(!!s.onboarded);
      adopt(s.branding || {});
    } catch { /* unreachable server — keep Pulse defaults */ }
    if (user) {
      try {
        const s = await api.get<Branding & { onboarded?: boolean; modules?: Modules | string }>("/settings");
        adopt(s);
        setOnboarded(!!s.onboarded);
        let m: unknown = s.modules ?? {};
        if (typeof m === "string") { try { m = JSON.parse(m); } catch { m = {}; } }
        setModules((m && typeof m === "object" ? m : {}) as Modules);
      } catch { /* non-fatal */ }
    }
    setReady(true);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const moduleOn = (key: string) => modules[key] !== false; // absent ⇒ enabled

  return (
    <Ctx.Provider value={{ branding, needsSetup, onboarded, modules, moduleOn, ready, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export const useBranding = () => useContext(Ctx);

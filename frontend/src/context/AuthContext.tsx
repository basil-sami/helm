import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, tokenStore } from "../lib/api";

export type Role = string; // built-in keys plus custom roles
export type PermLevel = "none" | "read" | "write";
export interface Permissions {
  admin: boolean;
  [module: string]: PermLevel | boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  titleAr?: string | null;
  permissions?: Permissions;
  mustChangePassword?: boolean;
  totpEnabled?: boolean;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, otp?: string) => Promise<void>;
  logout: () => void;
  can: (module: string, level?: "read" | "write") => boolean;
  isAdmin: boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string, otp?: string) => {
    const r = await api.post<{ token: string; user: User }>("/auth/login", { email, password, otp });
    tokenStore.set(r.token);
    setUser(r.user);
  };

  const logout = () => {
    tokenStore.clear();
    setUser(null);
  };

  // Sessions from before the permissions rollout may lack the map — treat
  // as full access client-side; the server still enforces on every call.
  const can = (module: string, level: "read" | "write" = "write") => {
    const p = user?.permissions;
    if (!p) return true;
    if (p.admin) return true;
    const v = p[module];
    return level === "read" ? v === "read" || v === "write" : v === "write";
  };
  const isAdmin = user?.permissions ? !!user.permissions.admin : user?.role === "HEAD";

  return <Ctx.Provider value={{ user, loading, login, logout, can, isAdmin }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { t as dict, enumLabels, Lang } from "../locales/dict";

interface I18nCtx {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (l: Lang) => void;
  toggle: () => void;
  tr: (key: keyof typeof dict | string) => string;
  el: (value?: string | null) => string; // enum label
}

const Ctx = createContext<I18nCtx>(null as unknown as I18nCtx);
const STORE_KEY = "helm.lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(STORE_KEY) as Lang) || "ar"
  );
  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    localStorage.setItem(STORE_KEY, lang);
  }, [lang, dir]);

  const setLang = (l: Lang) => setLangState(l);
  const toggle = () => setLangState((p) => (p === "ar" ? "en" : "ar"));

  const tr = (key: string) => {
    const entry = (dict as Record<string, { ar: string; en: string }>)[key];
    return entry ? entry[lang] : key;
  };
  const el = (value?: string | null) => {
    if (!value) return "";
    const entry = enumLabels[value];
    return entry ? entry[lang] : value;
  };

  return <Ctx.Provider value={{ lang, dir, setLang, toggle, tr, el }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

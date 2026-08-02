import { useEffect, useState } from "react";

// ═══ /b/:slug — the Pulse-hosted link-in-bio ═════════════════════════
// Public, bilingual, themed by the page's accent. Every tap goes
// through /r/:code, so attribution is automatic.

interface BioData {
  page: { slug: string; title: string; titleAr?: string | null; theme: string | { accent?: string } };
  links: { label: string; labelAr?: string | null; code: string }[];
}

export default function BioPublic({ slug }: { slug: string }) {
  const [data, setData] = useState<BioData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    fetch(`/api/public/bio/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setData(await r.json()); setState("ok");
      })
      .catch(() => setState("missing"));
  }, [slug]);

  const theme = data ? (typeof data.page.theme === "string" ? JSON.parse(data.page.theme || "{}") : data.page.theme) : {};
  const accent: string = theme?.accent || "#c98a2b";

  if (state === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-paper-100 text-ink-500">…</div>;
  }
  if (state === "missing" || !data) {
    return (
      <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center bg-paper-100 px-6 text-center">
        <div className="text-4xl">؟</div>
        <p className="mt-3 text-ink-600">هذه الصفحة غير متاحة — This page isn't available.</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-paper-100 px-5 py-10 font-[inherit]">
      <div className="mx-auto w-full max-w-md">
        <div className="text-center">
          <svg viewBox="0 0 120 24" className="mx-auto h-6 w-28" fill="none">
            <polyline points="2,12 34,12 44,4 54,20 62,8 70,12 118,12"
              stroke={accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <h1 className="mt-3 text-2xl font-bold text-ink-900">{data.page.titleAr || data.page.title}</h1>
          {data.page.titleAr && data.page.title && (
            <p className="mt-0.5 text-sm text-ink-500" dir="ltr">{data.page.title}</p>
          )}
        </div>

        <div className="mt-8 space-y-3">
          {data.links.map((l) => (
            <a key={l.code} href={`/r/${l.code}`}
              className="block rounded-2xl border-2 bg-white px-5 py-4 text-center text-base font-semibold text-ink-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              style={{ borderColor: accent }}>
              <span>{l.labelAr || l.label}</span>
              {l.labelAr && l.label && <span className="block text-xs font-normal text-ink-500" dir="ltr">{l.label}</span>}
            </a>
          ))}
          {data.links.length === 0 && <p className="text-center text-sm text-ink-500">لا روابط بعد · No links yet</p>}
        </div>

        <p className="mt-10 text-center text-[11px] tracking-wide text-ink-400" dir="ltr">
          <span style={{ color: accent }}>●</span> Pulse · نبض
        </p>
      </div>
    </div>
  );
}

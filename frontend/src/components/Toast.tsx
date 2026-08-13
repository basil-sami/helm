import { createContext, useContext, useState, useCallback, ReactNode } from "react";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; message: string }

const ToastCtx = createContext<{ push: (message: string, kind?: Kind) => void }>({ push: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: Kind = "info") => {
    const id = ++seq;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const tone: Record<Kind, string> = {
    success: "border-moss-500/40 bg-white text-ink-800",
    error: "border-clay-500/50 bg-white text-ink-800",
    info: "border-paper-300 bg-white text-ink-800",
  };
  const dot: Record<Kind, string> = { success: "bg-moss-500", error: "bg-clay-500", info: "bg-steel-500" };

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl2 border px-4 py-2.5 text-sm shadow-overlay animate-scale-in ${tone[t.kind]}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot[t.kind]}`} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

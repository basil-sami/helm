// Thin fetch wrapper. Same-origin in production (Express serves the app);
// in dev, Vite proxies /api to the backend.
const TOKEN_KEY = "pulse.token";
// One-time migration from the HELM era — nobody gets logged out by the rename.
const legacyToken = localStorage.getItem("helm.token");
if (legacyToken && !localStorage.getItem(TOKEN_KEY)) {
  localStorage.setItem(TOKEN_KEY, legacyToken);
  localStorage.removeItem("helm.token");
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  body?: Record<string, unknown>;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    tokenStore.clear();
    // Let the auth layer react on next render.
  }

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    let payload: Record<string, unknown> | undefined;
    try {
      payload = await res.json();
      msg = (payload?.error as string) || msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status, payload);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T,>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: (path: string) => request<void>("DELETE", path),
};

export interface SSEHandlers {
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

/**
 * POST and consume a server-sent-event stream (e.g. /brain/ask?stream).
 * Falls back to the plain JSON shape when the server answers before
 * streaming (unconfigured key, provider error) so the callers don't need
 * two code paths.
 */
export async function postSSE(
  path: string,
  body: unknown,
  { signal, onDelta }: SSEHandlers
): Promise<{ configured?: boolean; answer?: string; error?: string }> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401) tokenStore.clear();

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      msg = (payload?.error as string) || msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }

  const ct = res.headers.get("content-type") || "";
  // Server sent a JSON error before streaming (unconfigured / provider error).
  if (!ct.includes("text/event-stream")) {
    return (await res.json().catch(() => ({}))) as { configured?: boolean; answer?: string; error?: string };
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: { configured?: boolean; answer?: string; error?: string } = {};
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload) continue;
      let d: Record<string, unknown>;
      try { d = JSON.parse(payload); } catch { continue; }
      if (typeof d.text === "string") {
        onDelta(d.text);
        final.answer = (final.answer || "") + d.text;
      } else if (d.done === true) {
        if (typeof d.text === "string") final.answer = d.text;
        else if (typeof d.error === "string") final.error = d.error;
      } else if (typeof d.error === "string") {
        final.error = d.error;
      } else if (d.configured === false) {
        final.configured = false;
      }
    }
  }
  return final;
}

export interface UploadedFile {
  id: string; name: string; mime: string; size: number; driver: string; url: string; sha256?: string;
}

/** Upload a file as a raw body — no multipart, the browser sends it as-is. */
export async function uploadFile(
  file: File,
  opts: { entity?: string; entityId?: string; public?: boolean } = {}
): Promise<UploadedFile> {
  const token = tokenStore.get();
  const qs = new URLSearchParams({ name: file.name });
  if (opts.entity) qs.set("entity", opts.entity);
  if (opts.entityId) qs.set("entityId", opts.entityId);
  if (opts.public) qs.set("public", "true");
  const res = await fetch(`/api/files?${qs}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
    throw new ApiError(msg.error || "Upload failed", res.status);
  }
  return res.json();
}

// Authenticated file download (export). Triggers a browser download.
export async function download(path: string, filename: string) {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

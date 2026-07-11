// Thin fetch wrapper. Same-origin in production (Express serves the app);
// in dev, Vite proxies /api to the backend.
const TOKEN_KEY = "helm.token";

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

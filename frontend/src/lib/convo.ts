import { api } from "./api";

export interface StoredMsg {
  id?: string;
  role: "user" | "cmo";
  text: string;
  reasoning?: string;
  label?: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: StoredMsg[];
}

export async function listConvos(): Promise<Conversation[]> {
  try { return await api.get<Conversation[]>("/brain/conversations"); }
  catch { return []; }
}

export async function createConvo(title?: string): Promise<Conversation | null> {
  try {
    return await api.post<Conversation>("/brain/conversations", { title });
  } catch { return null; }
}

export async function getConvo(id: string): Promise<Conversation | null> {
  try { return await api.get<Conversation>(`/brain/conversations/${id}`); }
  catch { return null; }
}

export async function deleteConvo(id: string): Promise<boolean> {
  try {
    await api.del(`/brain/conversations/${id}`);
    return true;
  } catch { return false; }
}

export function truncateTitle(text: string): string {
  const clean = text.replace(/["""«»]/g, "").trim();
  return clean.length > 40 ? clean.slice(0, 40) + "…" : clean || "New conversation";
}

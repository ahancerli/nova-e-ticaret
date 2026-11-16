"use client";

import { api } from "@/lib/api-client";
import type { SynonymInput, SynonymRule } from "@/modules/search";

export const searchAdminApi = {
  addSynonym: (input: SynonymInput) => api<SynonymRule>("/api/admin/search/synonyms", { method: "POST", json: input, timeoutMs: 30_000 }),
  deleteSynonym: (id: string) => api<{ deleted: true }>(`/api/admin/search/synonyms/${id}`, { method: "DELETE", timeoutMs: 30_000 }),
  /** A rebuild reads the whole catalog; allow for a large one. */
  reindex: () => api<{ documents: number }>("/api/admin/search/reindex", { method: "POST", json: {}, timeoutMs: 10 * 60_000 }),
  updateTerm: (term: string, action: "hide" | "show" | "delete") => api<{ updated: true }>("/api/admin/search/terms", { method: "POST", json: { term, action } }),
};

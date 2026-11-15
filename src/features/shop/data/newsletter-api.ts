"use client";

import { api } from "@/lib/api-client";

/** E-bülten writes (REST, CSRF, rate limited). Sign-up answers the same for every address. */
export const newsletterApi = {
  subscribe: (email: string, headers?: Record<string, string>) =>
    api<{ message: string }>("/api/newsletter", { method: "POST", json: { email, consent: true }, headers }).then((r) => r.data),
  confirm: (token: string) => api<{ email: string }>("/api/newsletter/confirm", { method: "POST", json: { token } }).then((r) => r.data),
  unsubscribe: (id: string, sig: string) => api<{ email: string }>("/api/newsletter/unsubscribe", { method: "POST", json: { id, sig } }).then((r) => r.data),
};

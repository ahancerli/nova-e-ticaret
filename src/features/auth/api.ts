"use client";

import { api } from "@/lib/api-client";

export type LoginAudience = "storefront" | "admin";

const base = (audience: LoginAudience) => (audience === "admin" ? "/api/admin/auth" : "/api/storefront/auth");

/** Session endpoints. The session cookie is set / cleared by the server; nothing is stored in JS. */
export const authApi = {
  login: (audience: LoginAudience, credentials: { email: string; password: string }) =>
    api<{ loggedIn: true }>(`${base(audience)}/login`, { method: "POST", json: credentials }),
  logout: (audience: LoginAudience) => api<{ loggedOut: true }>(`${base(audience)}/logout`, { method: "POST" }),
  /** Sets the password from an invitation / reset link (single use). */
  setPassword: (token: string, password: string) =>
    api<{ passwordSet: true; audience: "staff" | "customer"; loginPath: string }>("/api/account/password", { method: "POST", json: { token, password } }),
  register: (input: { firstName: string; lastName: string; email: string; phone: string; password: string; kvkkAccepted: boolean; marketingEmail: boolean; marketingSms: boolean }) =>
    api<{ userId: string }>("/api/storefront/auth/register", { method: "POST", json: input }),
};

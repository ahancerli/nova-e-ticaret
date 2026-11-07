"use client";

import { api } from "@/lib/api-client";

export type LoginAudience = "storefront" | "admin";

const base = (audience: LoginAudience) => (audience === "admin" ? "/api/admin/auth" : "/api/storefront/auth");

/** Session endpoints. The session cookie is set / cleared by the server; nothing is stored in JS. */
export const authApi = {
  login: (audience: LoginAudience, credentials: { email: string; password: string; remember?: boolean }) =>
    api<{ loggedIn: true }>(`${base(audience)}/login`, { method: "POST", json: credentials }),
  logout: (audience: LoginAudience) => api<{ loggedOut: true }>(`${base(audience)}/logout`, { method: "POST" }),
  /** "Parolamı unuttum" (panel): always answers the same; the reset link arrives by e-mail if the account exists. */
  /** `dev` only outside production: what really happened to the reset mail. */
  forgotPassword: (email: string) => api<{ requested: true; dev?: ForgotDevOutcome }>("/api/admin/auth/forgot", { method: "POST", json: { email } }),
  /** Sets the password from an invitation / reset link (single use). */
  setPassword: (token: string, password: string) =>
    api<{ passwordSet: true; audience: "staff" | "customer"; loginPath: string }>("/api/account/password", { method: "POST", json: { token, password } }),
  /** "Şifremi unuttum" (mağaza): same answer for every address; the link arrives by e-mail if a customer account exists. */
  forgotCustomer: (email: string) => api<{ requested: true }>("/api/storefront/auth/forgot", { method: "POST", json: { email } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ changed: true }>("/api/storefront/auth/password", { method: "POST", json: { currentPassword, newPassword } }),
  register: (input: { firstName: string; lastName: string; email: string; phone: string; password: string; kvkkAccepted: boolean; marketingEmail: boolean; marketingSms: boolean }) =>
    api<{ userId: string }>("/api/storefront/auth/register", { method: "POST", json: input }),
};

export type ForgotDevOutcome =
  | { outcome: "sent" | "skipped" | "throttled" | "not_configured" }
  | { outcome: "failed"; code: string; message: string };

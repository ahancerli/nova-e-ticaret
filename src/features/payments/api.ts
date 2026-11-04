"use client";

import { api } from "@/lib/api-client";
import type { BankAccountInput, IyzicoEnvironment, IyzicoKeysInput, PaymentSettingsView } from "@/modules/payments";

const BASE = "/api/admin/payments";

export const paymentsApi = {
  saveIyzicoKeys: (input: IyzicoKeysInput & { expectedUpdatedAt: string | null }) => api<PaymentSettingsView>(`${BASE}/iyzico`, { method: "PUT", json: input }),
  testIyzico: (environment: IyzicoEnvironment) =>
    api<{ environment: IyzicoEnvironment; latencyMs: number }>(`${BASE}/iyzico/test`, { method: "POST", json: { environment }, timeoutMs: 30_000 }),
  setCard: (environment: IyzicoEnvironment | null) => api<PaymentSettingsView>(`${BASE}/card`, { method: "PUT", json: { environment } }),
  setBankTransfer: (active: boolean) => api<PaymentSettingsView>(`${BASE}/bank-transfer`, { method: "PUT", json: { active } }),
  createBankAccount: (input: BankAccountInput) => api<{ id: string }>(`${BASE}/bank-accounts`, { method: "POST", json: input }),
  updateBankAccount: (id: string, input: BankAccountInput) => api<{ updated: true }>(`${BASE}/bank-accounts/${encodeURIComponent(id)}`, { method: "PUT", json: input }),
  deleteBankAccount: (id: string) => api<{ deleted: true }>(`${BASE}/bank-accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

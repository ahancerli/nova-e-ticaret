/**
 * Ödeme sistemleri (panel) — pure types and rules, safe to import from client components.
 * Card payments: one iyzico account per environment, at most one active. Bank transfer: one config + IBAN accounts.
 */

export const IYZICO_ENVIRONMENTS = ["sandbox", "production"] as const;
export type IyzicoEnvironment = (typeof IYZICO_ENVIRONMENTS)[number];

export const IYZICO_ENV_LABEL: Record<IyzicoEnvironment, string> = { sandbox: "Test (sandbox)", production: "Canlı" };
export const IYZICO_BASE_URL: Record<IyzicoEnvironment, string> = {
  sandbox: "https://sandbox-api.iyzipay.com",
  production: "https://api.iyzipay.com",
};

/** Secret names in integration_secrets (read by the iyzico gateway). */
export const IYZICO_SECRET_NAMES = { apiKey: "api_key", secretKey: "secret_key" } as const;

/** "tr12 0006 …" → "TR120006…" (spaces and dashes removed, upper case). */
export const normalizeIban = (v: string) => v.replace(/[\s-]+/g, "").toUpperCase();

/** ISO 13616 check (mod 97) + Turkish length (26). Expects a normalized IBAN. */
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("TR") && (iban.length !== 26 || !/^TR\d{24}$/.test(iban))) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** "TR120006…" → "TR12 0006 1005 …" for display. */
export const formatIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();

export interface IyzicoAccountView {
  environment: IyzicoEnvironment;
  /** Both keys stored. */
  configured: boolean;
  /** Last characters of the API key ("…a1b2"); the secret key is never shown. */
  apiKeyHint: string | null;
  updatedAt: string | null;
}

export interface BankAccountView {
  id: string;
  bankName: string;
  accountHolder: string;
  iban: string;
  instructions: string | null;
  isActive: boolean;
  /** Referenced by orders → can only be deactivated, not deleted. */
  inUse: boolean;
}

export interface PaymentSettingsView {
  iyzico: { active: IyzicoEnvironment | null; accounts: IyzicoAccountView[] };
  bankTransfer: { active: boolean; accounts: BankAccountView[] };
}

export interface IyzicoKeysInput {
  environment: IyzicoEnvironment;
  /** Empty = keep the stored key (both required on first save). */
  apiKey?: string;
  secretKey?: string;
}

export interface BankAccountInput {
  bankName: string;
  accountHolder: string;
  iban: string;
  instructions?: string | null;
  isActive: boolean;
}

/** What checkout shows: enabled methods and, for bank transfer, the accounts to pay into. */
export interface PaymentOptions {
  card: boolean;
  bankTransfer: boolean;
  bankAccounts: Omit<BankAccountView, "id" | "isActive" | "inUse">[];
}

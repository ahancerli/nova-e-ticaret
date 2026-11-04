import type { Statement } from "@/core";
import type { BankAccountView, IyzicoEnvironment } from "../domain/payment-settings";

export interface SealedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
}

export interface IyzicoConfigRow {
  id: string;
  environment: IyzicoEnvironment;
  isActive: boolean;
  updatedAt: string;
  /** Names of the stored secrets (api_key, secret_key). */
  secrets: string[];
}

export interface BankAccountRow {
  bankName: string;
  accountHolder: string;
  iban: string;
  instructions: string | null;
  isActive: boolean;
}

/** payment_configs + bank_accounts + the payment configs' rows in integration_secrets. */
export interface PaymentSettingsRepository {
  iyzicoConfigs(): Promise<IyzicoConfigRow[]>;
  bankTransferActive(): Promise<boolean>;
  bankAccounts(): Promise<BankAccountView[]>;
  findBankAccount(id: string): Promise<BankAccountView | null>;
  ibanTaken(iban: string, exceptId?: string): Promise<boolean>;

  insertIyzicoConfigStatement(row: { id: string; environment: IyzicoEnvironment; now: string }): Statement;
  /** Guarded on `expectedUpdatedAt`. */
  touchIyzicoConfigStatement(id: string, now: string, expectedUpdatedAt: string): Statement;
  /** Replaces one secret of the iyzico config of `environment` (delete + insert: NULL integration_id defeats UNIQUE). */
  replaceSecretStatements(row: { id: string; environment: IyzicoEnvironment; name: string; secret: SealedSecret; now: string }): Statement[];
  /** Touches 1 row only when the config of `environment` has both keys. */
  activateIyzicoStatement(environment: IyzicoEnvironment, now: string): Statement;
  /** Deactivates every iyzico config except `keep`. */
  deactivateIyzicoStatement(now: string, keep?: IyzicoEnvironment): Statement;

  ensureBankTransferConfigStatement(id: string, now: string): Statement;
  /** Activation touches 1 row only when an active bank account exists. */
  setBankTransferActiveStatement(active: boolean, now: string): Statement;
  insertBankAccountStatement(id: string, row: BankAccountRow): Statement;
  /** Touches 1 row unless it would leave an active bank transfer without an active account. */
  updateBankAccountStatement(id: string, row: BankAccountRow): Statement;
  /** Same guard as update, and never deletes an account referenced by orders. */
  deleteBankAccountStatement(id: string): Statement;
}

/** Checks a pair of iyzico keys with a signed, side-effect-free request (Strategy; tests replace it). */
export interface IyzicoProbe {
  check(creds: { apiKey: string; secretKey: string; baseUrl: string }): Promise<{ ok: true } | { ok: false; message: string }>;
}

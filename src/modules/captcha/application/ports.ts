import type { Statement } from "@/core";
import type { CaptchaForm, CaptchaProvider, CaptchaVerdict } from "../domain/captcha";

export interface SealedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
}

export interface StoredCaptchaSettings {
  enabled: boolean;
  provider: CaptchaProvider;
  siteKey: string;
  secret: SealedSecret;
  secretHint: string;
  forms: CaptchaForm[];
  minScore: number;
  verifiedAt: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface CaptchaSettingsRow {
  enabled: boolean;
  provider: CaptchaProvider;
  siteKey: string;
  forms: CaptchaForm[];
  minScore: number;
  verifiedAt: string | null;
  actorId: string;
  now: string;
}

export interface CaptchaRepository {
  find(): Promise<StoredCaptchaSettings | null>;
  insertStatement(row: CaptchaSettingsRow & { secret: SealedSecret; secretHint: string }): Statement;
  /** Guarded on `expectedUpdatedAt`; `secret` null = keep the stored one. */
  updateStatement(row: CaptchaSettingsRow & { secret: SealedSecret | null; secretHint: string | null }, expectedUpdatedAt: string): Statement;
}

/** One siteverify call (Strategy; tests replace it). Throws only when the provider cannot be reached / answers 5xx. */
export interface CaptchaVerifier {
  verify(provider: CaptchaProvider, input: { secret: string; token: string; remoteIp?: string | null }): Promise<CaptchaVerdict>;
}

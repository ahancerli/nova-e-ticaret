import type { Statement } from "@/core";
import type { SocialProfile, SocialProvider } from "../domain/social";

export interface SealedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
}

export interface StoredSocialProvider {
  provider: SocialProvider;
  enabled: boolean;
  clientId: string;
  secret: SealedSecret;
  secretHint: string;
  verifiedAt: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface SocialProviderRow {
  provider: SocialProvider;
  enabled: boolean;
  clientId: string;
  verifiedAt: string | null;
  actorId: string;
  now: string;
}

export interface SocialProviderRepository {
  find(provider: SocialProvider): Promise<StoredSocialProvider | null>;
  /** Rows of known providers only (a row of a provider removed from the catalogue is ignored). */
  list(): Promise<StoredSocialProvider[]>;
  insertStatement(row: SocialProviderRow & { secret: SealedSecret; secretHint: string }): Statement;
  /** Guarded on `expectedUpdatedAt`; `secret` null = keep the stored one. */
  updateStatement(row: SocialProviderRow & { secret: SealedSecret | null; secretHint: string | null }, expectedUpdatedAt: string): Statement;
}

/** The account a provider identity (or its e-mail) points at. */
export interface LinkableAccount {
  userId: string;
  status: string;
  isStaff: boolean;
  /** Has this shop ever proven the person owns the e-mail (reset link) — or the provider, on an earlier link. */
  emailVerified: boolean;
  hasPassword: boolean;
}

export interface SocialIdentityRepository {
  findBySubject(provider: SocialProvider, subject: string): Promise<(LinkableAccount & { identityId: string }) | null>;
  findAccountByEmail(emailNormalized: string): Promise<LinkableAccount | null>;
  insertStatement(i: { id: string; userId: string; provider: SocialProvider; subject: string; now: string }): Statement;
  touchStatement(identityId: string, now: string): Statement;
  /** Removes the password of an account (see CompleteSocialLogin: unverified e-mail). */
  dropPasswordStatement(userId: string): Statement;
}

/**
 * The provider's HTTP side (Strategy; tests replace it). `exchange` returns a profile only from an ID token whose
 * signature and claims were checked; it throws `SocialErrors.failed` otherwise.
 */
export interface OidcClient {
  exchange(provider: SocialProvider, input: { clientId: string; clientSecret: string; code: string; codeVerifier: string; redirectUri: string; nonce: string }): Promise<SocialProfile>;
  /** Asks the provider whether it knows this client id + secret pair, without a user. Throws when it cannot be reached. */
  probe(provider: SocialProvider, input: { clientId: string; clientSecret: string; redirectUri: string }): Promise<"accepted" | "rejected">;
}

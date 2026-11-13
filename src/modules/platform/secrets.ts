import { ConfigToken, DatabaseToken, decryptSecret, token, type Container, type Database } from "@/core";

/** Owner of an encrypted secret: a payment config (iyzico keys) or an integration (carrier webhook secret). */
export type SecretOwner = { paymentConfigId: string } | { integrationId: string };

/**
 * Read-only access to integration_secrets (AES-256-GCM, master key = SECRETS_MASTER_KEY env secret).
 * Plaintext never leaves the server and is never logged; a missing or undecryptable secret is `null`.
 */
export interface SecretVault {
  read(owner: SecretOwner, name: string): Promise<string | null>;
}

export class D1SecretVault implements SecretVault {
  constructor(private readonly db: Database, private readonly masterKey: string) {}

  async read(owner: SecretOwner, name: string): Promise<string | null> {
    const [column, id] = "paymentConfigId" in owner ? ["payment_config_id", owner.paymentConfigId] : ["integration_id", owner.integrationId];
    const row = await this.db.first<{ ciphertext: string; nonce: string; auth_tag: string }>(
      `SELECT ciphertext, nonce, auth_tag FROM integration_secrets WHERE ${column} = ? AND secret_name = ?`, id, name,
    );
    if (!row || !this.masterKey) return null;
    try {
      return await decryptSecret(this.masterKey, { ciphertext: row.ciphertext, nonce: row.nonce, authTag: row.auth_tag });
    } catch {
      return null; // wrong master key / tampered row: treated as "not configured"
    }
  }
}

export const SecretVaultToken = token<SecretVault>("SecretVault");

export function registerSecrets(c: Container): void {
  c.scoped(SecretVaultToken, (r) => new D1SecretVault(r.resolve(DatabaseToken), r.resolve(ConfigToken).secretsMasterKey));
}

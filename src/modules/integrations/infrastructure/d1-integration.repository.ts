import { Repository, type Statement } from "@/core";
import type { IntegrationRepository, IntegrationRow, ProviderRow, SealedSecret } from "../application/ports";
import type { IntegrationKind, IntegrationSettings, ProviderField, SupportStatus } from "../domain/providers";

type RawProvider = {
  code: string; kind: IntegrationKind; name: string; description: string | null; website: string | null; support_status: SupportStatus;
  credential_fields_json: string; capabilities_json: string;
};
type RawIntegration = { id: string; kind: IntegrationKind; provider_code: string; is_active: number; public_config_json: string; updated_at: string; secrets: string | null };

const parse = <T>(json: string | null, fallback: T): T => {
  try { return (json ? JSON.parse(json) : fallback) as T; } catch { return fallback; }
};
const providerOf = (r: RawProvider): ProviderRow => ({
  code: r.code, kind: r.kind, name: r.name, description: r.description, website: r.website, supportStatus: r.support_status,
  fields: parse<ProviderField[]>(r.credential_fields_json, []), capabilities: parse<string[]>(r.capabilities_json, []),
});
const PROVIDER_COLUMNS = "code, kind, name, description, website, support_status, credential_fields_json, capabilities_json";

export class D1IntegrationRepository extends Repository implements IntegrationRepository {
  async providers(kind: IntegrationKind): Promise<ProviderRow[]> {
    const rows = await this.db.all<RawProvider>(
      `SELECT ${PROVIDER_COLUMNS} FROM integration_providers WHERE kind = ? AND is_listed = 1
        ORDER BY support_status = 'ready' DESC, sort_order, name`, kind,
    );
    return rows.map(providerOf);
  }

  async provider(code: string): Promise<ProviderRow | null> {
    const r = await this.db.first<RawProvider>(`SELECT ${PROVIDER_COLUMNS} FROM integration_providers WHERE code = ?`, code);
    return r ? providerOf(r) : null;
  }

  async current(kind: IntegrationKind): Promise<IntegrationRow | null> {
    const r = await this.db.first<RawIntegration>(
      `SELECT i.id, i.kind, i.provider_code, i.is_active, i.public_config_json, i.updated_at,
              (SELECT group_concat(s.secret_name) FROM integration_secrets s WHERE s.integration_id = i.id) AS secrets
         FROM integrations i WHERE i.kind = ? ORDER BY i.is_active DESC, i.updated_at DESC LIMIT 1`, kind,
    );
    if (!r) return null;
    const cfg = parse<{ values?: Record<string, string>; settings?: IntegrationSettings }>(r.public_config_json, {});
    return {
      id: r.id, kind: r.kind, providerCode: r.provider_code, isActive: r.is_active === 1, values: cfg.values ?? {}, settings: cfg.settings ?? {},
      secrets: r.secrets ? r.secrets.split(",") : [], updatedAt: r.updated_at,
    };
  }

  lockStatement(id: string, expectedUpdatedAt: string): Statement {
    return this.db.statement("UPDATE integrations SET updated_at = updated_at WHERE id = ? AND updated_at = ?", id, expectedUpdatedAt);
  }

  deleteKindStatement(kind: IntegrationKind): Statement {
    return this.db.statement("DELETE FROM integrations WHERE kind = ?", kind);
  }

  insertStatement(row: { id: string; kind: IntegrationKind; providerCode: string; name: string; publicConfig: unknown; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO integrations (id, kind, provider_code, name, public_config_json, is_active, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
      row.id, row.kind, row.providerCode, row.name, JSON.stringify(row.publicConfig), row.now,
    );
  }

  updateStatement(row: { id: string; publicConfig: unknown; now: string }): Statement {
    return this.db.statement("UPDATE integrations SET public_config_json = ?, is_active = 1, updated_at = ? WHERE id = ?", JSON.stringify(row.publicConfig), row.now, row.id);
  }

  /** Delete + insert: integration_secrets' UNIQUE includes the NULL payment_config_id, so ON CONFLICT never fires. */
  replaceSecretStatements(row: { id: string; integrationId: string; name: string; secret: SealedSecret; now: string }): Statement[] {
    return [
      this.db.statement("DELETE FROM integration_secrets WHERE integration_id = ? AND secret_name = ?", row.integrationId, row.name),
      this.db.statement(
        `INSERT INTO integration_secrets (id, integration_id, secret_name, ciphertext, nonce, auth_tag, key_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id, row.integrationId, row.name, row.secret.ciphertext, row.secret.nonce, row.secret.authTag, row.secret.keyVersion, row.now,
      ),
    ];
  }
}

import { Repository, type Statement } from "@/core";
import type { BankAccountRow, IyzicoConfigRow, PaymentSettingsRepository, SealedSecret } from "../application/settings-ports";
import { IYZICO_BASE_URL, IYZICO_ENV_LABEL, IYZICO_SECRET_NAMES, type BankAccountView, type IyzicoEnvironment } from "../domain/payment-settings";

const KEY_NAMES = `'${IYZICO_SECRET_NAMES.apiKey}','${IYZICO_SECRET_NAMES.secretKey}'`;
const IYZICO_ID = "(SELECT id FROM payment_configs WHERE provider = 'iyzico' AND environment = ?)";
const BANK_CONFIG_ID = "(SELECT id FROM payment_configs WHERE provider = 'bank_transfer' ORDER BY is_active DESC, id LIMIT 1)";
/** False only when the change would leave an active bank transfer without any other active account. */
const KEEPS_AN_ACTIVE_ACCOUNT = `(NOT EXISTS (SELECT 1 FROM payment_configs WHERE provider = 'bank_transfer' AND is_active = 1)
  OR EXISTS (SELECT 1 FROM bank_accounts o WHERE o.is_active = 1 AND o.id <> ?))`;

type RawAccount = { id: string; bank_name: string; account_holder: string; iban_normalized: string; instructions: string | null; is_active: number; in_use: number };
const accountOf = (r: RawAccount): BankAccountView => ({
  id: r.id, bankName: r.bank_name, accountHolder: r.account_holder, iban: r.iban_normalized, instructions: r.instructions, isActive: r.is_active === 1, inUse: r.in_use === 1,
});
const ACCOUNT_SELECT = `SELECT b.id, b.bank_name, b.account_holder, b.iban_normalized, b.instructions, b.is_active,
                               EXISTS (SELECT 1 FROM bank_transfers t WHERE t.bank_account_id = b.id) AS in_use
                          FROM bank_accounts b`;

export class D1PaymentSettingsRepository extends Repository implements PaymentSettingsRepository {
  async iyzicoConfigs(): Promise<IyzicoConfigRow[]> {
    const rows = await this.db.all<{ id: string; environment: IyzicoEnvironment; is_active: number; updated_at: string; secrets: string | null }>(
      `SELECT c.id, c.environment, c.is_active, c.updated_at,
              (SELECT group_concat(s.secret_name) FROM integration_secrets s WHERE s.payment_config_id = c.id AND s.secret_name IN (${KEY_NAMES})) AS secrets
         FROM payment_configs c WHERE c.provider = 'iyzico' ORDER BY c.environment`,
    );
    return rows.map((r) => ({ id: r.id, environment: r.environment, isActive: r.is_active === 1, updatedAt: r.updated_at, secrets: r.secrets ? r.secrets.split(",") : [] }));
  }

  async bankTransferActive(): Promise<boolean> {
    return !!(await this.db.first("SELECT 1 AS x FROM payment_configs WHERE provider = 'bank_transfer' AND is_active = 1"));
  }

  async bankAccounts(): Promise<BankAccountView[]> {
    return (await this.db.all<RawAccount>(`${ACCOUNT_SELECT} ORDER BY b.is_active DESC, b.bank_name, b.id`)).map(accountOf);
  }

  async findBankAccount(id: string): Promise<BankAccountView | null> {
    const r = await this.db.first<RawAccount>(`${ACCOUNT_SELECT} WHERE b.id = ?`, id);
    return r ? accountOf(r) : null;
  }

  async ibanTaken(iban: string, exceptId?: string): Promise<boolean> {
    return !!(await this.db.first("SELECT 1 AS x FROM bank_accounts WHERE iban_normalized = ? AND id <> ?", iban, exceptId ?? ""));
  }

  insertIyzicoConfigStatement(row: { id: string; environment: IyzicoEnvironment; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO payment_configs (id, provider, name, environment, public_config_json, is_active, updated_at) VALUES (?, 'iyzico', ?, ?, ?, 0, ?)`,
      row.id, `iyzico (${IYZICO_ENV_LABEL[row.environment]})`, row.environment, JSON.stringify({ baseUrl: IYZICO_BASE_URL[row.environment] }), row.now,
    );
  }

  touchIyzicoConfigStatement(id: string, now: string, expectedUpdatedAt: string): Statement {
    return this.db.statement("UPDATE payment_configs SET updated_at = ? WHERE id = ? AND updated_at = ?", now, id, expectedUpdatedAt);
  }

  replaceSecretStatements(row: { id: string; environment: IyzicoEnvironment; name: string; secret: SealedSecret; now: string }): Statement[] {
    return [
      this.db.statement(`DELETE FROM integration_secrets WHERE payment_config_id = ${IYZICO_ID} AND secret_name = ?`, row.environment, row.name),
      this.db.statement(
        `INSERT INTO integration_secrets (id, payment_config_id, secret_name, ciphertext, nonce, auth_tag, key_version, updated_at)
         VALUES (?, ${IYZICO_ID}, ?, ?, ?, ?, ?, ?)`,
        row.id, row.environment, row.name, row.secret.ciphertext, row.secret.nonce, row.secret.authTag, row.secret.keyVersion, row.now,
      ),
    ];
  }

  activateIyzicoStatement(environment: IyzicoEnvironment, now: string): Statement {
    return this.db.statement(
      `UPDATE payment_configs SET is_active = 1, updated_at = ?
        WHERE provider = 'iyzico' AND environment = ?
          AND (SELECT COUNT(*) FROM integration_secrets s WHERE s.payment_config_id = payment_configs.id AND s.secret_name IN (${KEY_NAMES})) = 2`,
      now, environment,
    );
  }

  deactivateIyzicoStatement(now: string, keep?: IyzicoEnvironment): Statement {
    return this.db.statement(
      "UPDATE payment_configs SET is_active = 0, updated_at = ? WHERE provider = 'iyzico' AND is_active = 1 AND environment <> ?", now, keep ?? "",
    );
  }

  ensureBankTransferConfigStatement(id: string, now: string): Statement {
    return this.db.statement(
      `INSERT INTO payment_configs (id, provider, name, environment, is_active, updated_at)
       SELECT ?, 'bank_transfer', 'Havale / EFT', 'production', 0, ? WHERE NOT EXISTS (SELECT 1 FROM payment_configs WHERE provider = 'bank_transfer')`,
      id, now,
    );
  }

  setBankTransferActiveStatement(active: boolean, now: string): Statement {
    if (!active) return this.db.statement("UPDATE payment_configs SET is_active = 0, updated_at = ? WHERE provider = 'bank_transfer'", now);
    return this.db.statement(
      `UPDATE payment_configs SET is_active = 1, updated_at = ?
        WHERE id = ${BANK_CONFIG_ID} AND EXISTS (SELECT 1 FROM bank_accounts b WHERE b.payment_config_id = payment_configs.id AND b.is_active = 1)`,
      now,
    );
  }

  insertBankAccountStatement(id: string, r: BankAccountRow): Statement {
    return this.db.statement(
      `INSERT INTO bank_accounts (id, payment_config_id, bank_name, account_holder, iban_normalized, currency, instructions, is_active)
       SELECT ?, id, ?, ?, ?, 'TRY', ?, ? FROM payment_configs WHERE id = ${BANK_CONFIG_ID}`,
      id, r.bankName, r.accountHolder, r.iban, r.instructions, r.isActive ? 1 : 0,
    );
  }

  updateBankAccountStatement(id: string, r: BankAccountRow): Statement {
    return this.db.statement(
      `UPDATE bank_accounts SET bank_name = ?, account_holder = ?, iban_normalized = ?, instructions = ?, is_active = ?
        WHERE id = ? AND (? = 1 OR ${KEEPS_AN_ACTIVE_ACCOUNT})`,
      r.bankName, r.accountHolder, r.iban, r.instructions, r.isActive ? 1 : 0, id, r.isActive ? 1 : 0, id,
    );
  }

  deleteBankAccountStatement(id: string): Statement {
    return this.db.statement(
      `DELETE FROM bank_accounts WHERE id = ? AND NOT EXISTS (SELECT 1 FROM bank_transfers t WHERE t.bank_account_id = bank_accounts.id)
          AND (is_active = 0 OR ${KEEPS_AN_ACTIVE_ACCOUNT})`,
      id, id,
    );
  }
}

import { UnitOfWork, encryptSecret, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { SecretVault } from "@/modules/platform/secrets";
import type { Actor } from "@/modules/shared/actor";
import { PaymentSettingsErrors as E } from "../domain/payment";
import {
  IYZICO_BASE_URL, IYZICO_ENVIRONMENTS, IYZICO_SECRET_NAMES, formatIban, normalizeIban,
  type BankAccountInput, type IyzicoEnvironment, type IyzicoKeysInput, type PaymentOptions, type PaymentSettingsView,
} from "../domain/payment-settings";
import type { BankAccountRow, IyzicoProbe, PaymentSettingsRepository } from "./settings-ports";

const KEY_VERSION = "v1";

export interface PaymentSettingsDeps {
  db: Database;
  repo: PaymentSettingsRepository;
  vault: SecretVault;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
  /** SECRETS_MASTER_KEY (base64, 32 bytes). */
  masterKey: string;
}

const hintOf = (key: string | null) => (key ? `…${key.slice(-4)}` : null);

/** Query: everything the Ödeme sistemleri page shows. Keys never leave the server (API key: last 4 characters). */
export class GetPaymentSettings {
  constructor(private readonly repo: PaymentSettingsRepository, private readonly vault: SecretVault) {}

  async execute(): Promise<PaymentSettingsView> {
    const [configs, bankActive, accounts] = await Promise.all([this.repo.iyzicoConfigs(), this.repo.bankTransferActive(), this.repo.bankAccounts()]);
    const iyzicoAccounts = await Promise.all(IYZICO_ENVIRONMENTS.map(async (environment) => {
      const c = configs.find((x) => x.environment === environment);
      const configured = !!c && c.secrets.includes(IYZICO_SECRET_NAMES.apiKey) && c.secrets.includes(IYZICO_SECRET_NAMES.secretKey);
      const apiKey = configured ? await this.vault.read({ paymentConfigId: c!.id }, IYZICO_SECRET_NAMES.apiKey) : null;
      return { environment, configured, apiKeyHint: hintOf(apiKey), updatedAt: c?.updatedAt ?? null };
    }));
    return {
      iyzico: { active: configs.find((c) => c.isActive)?.environment ?? null, accounts: iyzicoAccounts },
      bankTransfer: { active: bankActive, accounts },
    };
  }
}

/** Query (storefront): enabled methods and the IBANs to pay into. Card = active iyzico config with both keys. */
export class GetPaymentOptions {
  constructor(private readonly repo: PaymentSettingsRepository) {}

  async execute(): Promise<PaymentOptions> {
    const [configs, bankActive, accounts] = await Promise.all([this.repo.iyzicoConfigs(), this.repo.bankTransferActive(), this.repo.bankAccounts()]);
    const active = configs.find((c) => c.isActive);
    const bankAccounts = bankActive
      ? accounts.filter((a) => a.isActive).map((a) => ({ bankName: a.bankName, accountHolder: a.accountHolder, iban: formatIban(a.iban), instructions: a.instructions }))
      : [];
    return { card: !!active && active.secrets.length >= 2, bankTransfer: bankAccounts.length > 0, bankAccounts };
  }
}

/** Command: store the iyzico keys of one environment (sealed with the master key); an empty key keeps the stored one. */
export class SaveIyzicoKeys {
  constructor(private readonly deps: PaymentSettingsDeps) {}

  async execute(input: IyzicoKeysInput & { expectedUpdatedAt: string | null }, actor: Actor): Promise<PaymentSettingsView> {
    const { deps } = this;
    const existing = (await deps.repo.iyzicoConfigs()).find((c) => c.environment === input.environment);
    if ((existing?.updatedAt ?? null) !== input.expectedUpdatedAt) throw E.changedMeanwhile();
    for (const [field, name] of [["apiKey", IYZICO_SECRET_NAMES.apiKey], ["secretKey", IYZICO_SECRET_NAMES.secretKey]] as const) {
      if (!input[field] && !existing?.secrets.includes(name)) throw E.keysRequired(field);
    }
    if (!deps.masterKey) throw E.masterKeyMissing();

    const now = deps.clock.nowIso();
    const configId = existing?.id ?? deps.ids.newId();
    const uow = new UnitOfWork(deps.db);
    if (existing) uow.add(deps.repo.touchIyzicoConfigStatement(existing.id, now, existing.updatedAt)).expectChanges(1, E.changedMeanwhile);
    else uow.add(deps.repo.insertIyzicoConfigStatement({ id: configId, environment: input.environment, now }));
    const changed: string[] = [];
    for (const [field, name] of [["apiKey", IYZICO_SECRET_NAMES.apiKey], ["secretKey", IYZICO_SECRET_NAMES.secretKey]] as const) {
      const plain = input[field];
      if (!plain) continue;
      changed.push(field);
      const secret = { ...(await encryptSecret(deps.masterKey, plain)), keyVersion: KEY_VERSION };
      for (const st of deps.repo.replaceSecretStatements({ id: deps.ids.newId(), environment: input.environment, name, secret, now })) uow.add(st);
    }
    await uow
      // the keys themselves never reach the audit log
      .add(deps.audit.recordStatement({ actor, action: "payment.iyzico_keys", entityType: "payment_config", entityId: configId, diff: { environment: input.environment, changed } }))
      .commit();
    return new GetPaymentSettings(deps.repo, deps.vault).execute();
  }
}

/** Command: card payments on (one environment) or off. Activating one environment deactivates the other. */
export class SetCardPayments {
  constructor(private readonly deps: PaymentSettingsDeps) {}

  async execute(environment: IyzicoEnvironment | null, actor: Actor): Promise<PaymentSettingsView> {
    const { deps } = this;
    const configs = await deps.repo.iyzicoConfigs();
    const now = deps.clock.nowIso();
    // Deactivate first: ux_payment_config_active allows one active config per provider. The batch is atomic,
    // so a failed activation guard rolls the deactivation back too.
    const uow = new UnitOfWork(deps.db).add(deps.repo.deactivateIyzicoStatement(now, environment ?? undefined));
    if (environment) uow.add(deps.repo.activateIyzicoStatement(environment, now)).expectChanges(1, E.keysMissing);
    await uow
      .add(deps.audit.recordStatement({
        actor, action: environment ? "payment.card_activate" : "payment.card_deactivate", entityType: "payment_config",
        entityId: configs.find((c) => c.environment === environment)?.id ?? "iyzico",
        diff: { from: configs.find((c) => c.isActive)?.environment ?? null, to: environment },
      }))
      .commit();
    return new GetPaymentSettings(deps.repo, deps.vault).execute();
  }
}

/** Command: Havale / EFT on or off. On requires at least one active bank account (guarded in the batch). */
export class SetBankTransfer {
  constructor(private readonly deps: PaymentSettingsDeps) {}

  async execute(active: boolean, actor: Actor): Promise<PaymentSettingsView> {
    const { deps } = this;
    const now = deps.clock.nowIso();
    const uow = new UnitOfWork(deps.db).add(deps.repo.ensureBankTransferConfigStatement(deps.ids.newId(), now));
    uow.add(deps.repo.setBankTransferActiveStatement(active, now));
    if (active) uow.expectChanges(1, E.noActiveBankAccount);
    await uow
      .add(deps.audit.recordStatement({
        actor, action: active ? "payment.bank_transfer_activate" : "payment.bank_transfer_deactivate", entityType: "payment_config", entityId: "bank_transfer", diff: { active },
      }))
      .commit();
    return new GetPaymentSettings(deps.repo, deps.vault).execute();
  }
}

const rowOf = (input: BankAccountInput): BankAccountRow => ({
  bankName: input.bankName.trim(), accountHolder: input.accountHolder.trim(), iban: normalizeIban(input.iban),
  instructions: input.instructions?.trim() || null, isActive: input.isActive,
});
// IBANs are masked by the audit viewer anyway; only the last digits are recorded.
const auditOf = (r: BankAccountRow) => ({ bankName: r.bankName, accountHolder: r.accountHolder, accountEnd: r.iban.slice(-4), isActive: r.isActive });

export class CreateBankAccount {
  constructor(private readonly deps: PaymentSettingsDeps) {}

  async execute(input: BankAccountInput, actor: Actor): Promise<{ id: string }> {
    const { deps } = this;
    const row = rowOf(input);
    if (await deps.repo.ibanTaken(row.iban)) throw E.ibanTaken();
    const id = deps.ids.newId();
    const now = deps.clock.nowIso();
    await new UnitOfWork(deps.db)
      .add(deps.repo.ensureBankTransferConfigStatement(deps.ids.newId(), now))
      .add(deps.repo.insertBankAccountStatement(id, row))
      .expectChanges(1)
      .add(deps.audit.recordStatement({ actor, action: "bank_account.create", entityType: "bank_account", entityId: id, diff: auditOf(row) }))
      .commit();
    return { id };
  }
}

export class UpdateBankAccount {
  constructor(private readonly deps: PaymentSettingsDeps) {}

  async execute(id: string, input: BankAccountInput, actor: Actor): Promise<void> {
    const { deps } = this;
    const current = await deps.repo.findBankAccount(id);
    if (!current) throw E.bankAccountNotFound();
    const row = rowOf(input);
    if (row.iban !== current.iban && current.inUse) throw E.bankAccountInUse();
    if (row.iban !== current.iban && (await deps.repo.ibanTaken(row.iban, id))) throw E.ibanTaken();
    await new UnitOfWork(deps.db)
      .add(deps.repo.updateBankAccountStatement(id, row))
      .expectChanges(1, E.lastActiveBankAccount)
      .add(deps.audit.recordStatement({ actor, action: "bank_account.update", entityType: "bank_account", entityId: id, diff: { before: auditOf(current), after: auditOf(row) } }))
      .commit();
  }
}

export class DeleteBankAccount {
  constructor(private readonly deps: PaymentSettingsDeps) {}

  async execute(id: string, actor: Actor): Promise<void> {
    const { deps } = this;
    const current = await deps.repo.findBankAccount(id);
    if (!current) throw E.bankAccountNotFound();
    if (current.inUse) throw E.bankAccountInUse();
    await new UnitOfWork(deps.db)
      .add(deps.repo.deleteBankAccountStatement(id))
      .expectChanges(1, E.lastActiveBankAccount)
      .add(deps.audit.recordStatement({ actor, action: "bank_account.delete", entityType: "bank_account", entityId: id, diff: auditOf(current) }))
      .commit();
  }
}

/** Command: verify the stored keys of one environment with a signed request — no payment is created. */
export class TestIyzicoKeys {
  constructor(private readonly repo: PaymentSettingsRepository, private readonly vault: SecretVault, private readonly probe: IyzicoProbe) {}

  async execute(environment: IyzicoEnvironment): Promise<{ environment: IyzicoEnvironment; latencyMs: number }> {
    const config = (await this.repo.iyzicoConfigs()).find((c) => c.environment === environment);
    if (!config || config.secrets.length < 2) throw E.keysMissing();
    const owner = { paymentConfigId: config.id };
    const [apiKey, secretKey] = await Promise.all([this.vault.read(owner, IYZICO_SECRET_NAMES.apiKey), this.vault.read(owner, IYZICO_SECRET_NAMES.secretKey)]);
    if (!apiKey || !secretKey) throw E.keysUnreadable();
    const started = Date.now();
    const r = await this.probe.check({ apiKey, secretKey, baseUrl: IYZICO_BASE_URL[environment] });
    if (!r.ok) throw E.testFailed(r.message);
    return { environment, latencyMs: Date.now() - started };
  }
}

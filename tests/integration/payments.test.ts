// Ödeme sistemleri (panel): IBAN rules (pure), iyzico keys per environment (sealed, keep-on-empty, optimistic locking,
// audit without secrets), one active card environment, key test through a fake probe, Havale / EFT on/off guards,
// bank account CRUD guards and the storefront's payment options. No request reaches iyzico. Run: npm run test:payments
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [payments, platform, secrets, audit, auditDomain, gatewayModule] = await Promise.all([
  mod("payments/index"), mod("platform/module"), mod("platform/secrets"), mod("audit/audit-log"), mod("audit/domain/audit"), mod("payments/infrastructure/iyzico-gateway"),
]);
const { Container, D1DatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig } = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string) {
  try { await fn(); } catch (e: any) { assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`); return e; }
  throw new Error(`expected ${code}, nothing thrown`);
}

// --- pure ------------------------------------------------------------------------------------------
const VALID = "TR33 0006 1005 1978 6457 8413 26";
await t("iban: normalize, mod-97 and Turkish length; display grouping", () => {
  const n = payments.normalizeIban(` ${VALID.toLowerCase()} `);
  assert(n === "TR330006100519786457841326", n);
  assert(payments.isValidIban(n), "valid sample");
  assert(!payments.isValidIban("TR330006100519786457841327"), "checksum");
  assert(!payments.isValidIban("TR3300061005197864578413"), "TR length");
  assert(payments.isValidIban("DE89370400440532013000"), "foreign IBAN");
  assert(payments.formatIban(n) === VALID, payments.formatIban(n));
});

await t("schema: IBAN normalized and checked, empty keys mean 'keep'", () => {
  const ok = payments.bankAccountSchema.parse({ bankName: "Ziraat", accountHolder: "NOVA A.Ş.", iban: VALID, instructions: "", isActive: true });
  assert(ok.iban === "TR330006100519786457841326" && ok.instructions === null, JSON.stringify(ok));
  assert(!payments.bankAccountSchema.safeParse({ bankName: "Ziraat", accountHolder: "NOVA", iban: "TR00 1234", isActive: true }).success, "bad IBAN rejected");
  const keys = payments.iyzicoKeysSchema.parse({ environment: "sandbox", apiKey: "", secretKey: "  ", expectedUpdatedAt: null });
  assert(keys.apiKey === undefined && keys.secretKey === undefined, JSON.stringify(keys));
  assert(!payments.iyzicoKeysSchema.safeParse({ environment: "live", expectedUpdatedAt: null }).success, "unknown environment");
});

await t("audit: payment actions are labelled, belong to Ayarlar and link to the page", () => {
  assert(auditDomain.actionLabel("bank_account.create") === "Banka hesabı oluşturuldu", auditDomain.actionLabel("bank_account.create"));
  assert(auditDomain.actionLabel("payment.card_activate") === "Kartla ödeme açıldı", "card label");
  assert(auditDomain.areaOf("payment.iyzico_keys") === "settings" && auditDomain.areaOf("bank_account.delete") === "settings", "area");
  assert(auditDomain.entityHref("bank_account", "x") === "/admin/odemeler", "href");
});

// --- container ---------------------------------------------------------------------------------------
const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const clock = new FixedClock(new Date("2026-11-04T10:00:00.000Z"));
const probe = { calls: [] as any[], ok: true, check: async (c: any) => { probe.calls.push(c); return probe.ok ? { ok: true } : { ok: false, message: "api bilgileri bulunamadı" }; } };
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new D1DatabaseAdapter(r.resolve(EnvToken).DB));
platform.registerPlatform(root);
secrets.registerSecrets(root);
audit.registerAudit(root);
payments.registerPayments(root);
root.singleton(payments.IyzicoProbeToken, () => probe);
const scope = () => root.createScope().provide(EnvToken, { DB: d1, SESSION_SECRET: "s3cret", SECRETS_MASTER_KEY: MASTER, PUBLIC_SITE_URL: "https://nova.test" });
const resolve = (tok: any): any => scope().resolve(tok);
const one = <T>(sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as T;
const count = (sql: string, ...p: unknown[]) => Number((d1.raw.prepare(sql).get(...p) as any).n);
const actor = { userId: "u_admin", requestId: "req-pay" };
const settings = () => resolve(payments.GetPaymentSettingsToken).execute();
const env = async (e: string) => (await settings()).iyzico.accounts.find((a: any) => a.environment === e);
const tick = () => clock.advanceMinutes(1);

await t("initial: both environments listed, card off, seed bank account marked in use", async () => {
  const s = await settings();
  assert(s.iyzico.active === null && s.iyzico.accounts.length === 2 && s.iyzico.accounts.every((a: any) => !a.configured), JSON.stringify(s.iyzico));
  assert(s.bankTransfer.active === false && s.bankTransfer.accounts.length === 1 && s.bankTransfer.accounts[0].inUse, JSON.stringify(s.bankTransfer));
  const o = await resolve(payments.GetPaymentOptionsToken).execute();
  assert(!o.card && !o.bankTransfer && o.bankAccounts.length === 0, JSON.stringify(o));
});

await t("card: an environment without keys cannot be activated", async () => {
  await rejects(() => resolve(payments.SetCardPaymentsToken).execute("sandbox", actor), "iyzico_keys_missing");
  await rejects(() => resolve(payments.SetCardPaymentsToken).execute("production", actor), "iyzico_keys_missing");
});

await t("keys: both required first time; sealed, hinted, audited without the secret", async () => {
  const sbx = await env("sandbox");
  const e = await rejects(() => resolve(payments.SaveIyzicoKeysToken).execute({ environment: "sandbox", apiKey: "sandbox-api-AAAA1111", expectedUpdatedAt: sbx.updatedAt }, actor), "validation_error");
  assert(e.fieldErrors?.secretKey, JSON.stringify(e.fieldErrors));
  tick();
  const s = await resolve(payments.SaveIyzicoKeysToken).execute({ environment: "sandbox", apiKey: "sandbox-api-AAAA1111", secretKey: "sandbox-secret-BBBB2222", expectedUpdatedAt: sbx.updatedAt }, actor);
  const a = s.iyzico.accounts.find((x: any) => x.environment === "sandbox");
  assert(a.configured && a.apiKeyHint === "…1111", JSON.stringify(a));
  const rows = d1.raw.prepare("SELECT ciphertext FROM integration_secrets WHERE payment_config_id = 'pc_iyzico_sbx'").all() as any[];
  assert(rows.length === 2 && rows.every((r) => !r.ciphertext.includes("sandbox")), "sealed");
  const log = one<any>("SELECT diff_redacted_json FROM audit_logs WHERE action = 'payment.iyzico_keys' ORDER BY rowid DESC LIMIT 1");
  assert(log && !log.diff_redacted_json.includes("BBBB2222") && !log.diff_redacted_json.includes("AAAA1111") && log.diff_redacted_json.includes("secretKey"), log?.diff_redacted_json);
});

await t("keys: stale edit → 409; empty secret keeps the stored one", async () => {
  await rejects(() => resolve(payments.SaveIyzicoKeysToken).execute({ environment: "sandbox", apiKey: "sandbox-api-CCCC3333", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, actor), "payment_settings_changed");
  tick();
  const sbx = await env("sandbox");
  await resolve(payments.SaveIyzicoKeysToken).execute({ environment: "sandbox", apiKey: "sandbox-api-CCCC3333", expectedUpdatedAt: sbx.updatedAt }, actor);
  const vault = scope().resolve(secrets.SecretVaultToken);
  assert(await vault.read({ paymentConfigId: "pc_iyzico_sbx" }, "secret_key") === "sandbox-secret-BBBB2222", "secret kept");
  assert(await vault.read({ paymentConfigId: "pc_iyzico_sbx" }, "api_key") === "sandbox-api-CCCC3333", "api key replaced");
  assert(count("SELECT count(*) AS n FROM integration_secrets WHERE payment_config_id = 'pc_iyzico_sbx'") === 2, "no duplicate secret rows");
});

await t("card: activate sandbox, then production — only one environment is active; gateway follows", async () => {
  let s = await resolve(payments.SetCardPaymentsToken).execute("sandbox", actor);
  assert(s.iyzico.active === "sandbox", JSON.stringify(s.iyzico));
  assert((await resolve(payments.GetPaymentOptionsToken).execute()).card, "card offered");
  const gw = new gatewayModule.IyzicoGateway(scope().resolve(DatabaseToken), scope().resolve(secrets.SecretVaultToken));
  assert(await gw.isAvailable(), "gateway sees the sandbox keys");
  await rejects(() => resolve(payments.SetCardPaymentsToken).execute("production", actor), "iyzico_keys_missing");
  assert((await settings()).iyzico.active === "sandbox", "failed activation rolled back; sandbox still active");

  tick();
  await resolve(payments.SaveIyzicoKeysToken).execute({ environment: "production", apiKey: "live-api-DDDD4444", secretKey: "live-secret-EEEE5555", expectedUpdatedAt: null }, actor);
  tick();
  s = await resolve(payments.SetCardPaymentsToken).execute("production", actor);
  assert(s.iyzico.active === "production", JSON.stringify(s.iyzico));
  assert(count("SELECT count(*) AS n FROM payment_configs WHERE provider = 'iyzico' AND is_active = 1") === 1, "exactly one active");
  s = await resolve(payments.SetCardPaymentsToken).execute(null, actor);
  assert(s.iyzico.active === null && !(await resolve(payments.GetPaymentOptionsToken).execute()).card, "card off");
});

await t("key test: probe gets the environment's URL and keys; a rejection is a clear error", async () => {
  const r = await resolve(payments.TestIyzicoKeysToken).execute("production");
  const call = probe.calls.at(-1);
  assert(r.environment === "production" && call.baseUrl === "https://api.iyzipay.com" && call.apiKey === "live-api-DDDD4444" && call.secretKey === "live-secret-EEEE5555", JSON.stringify(call));
  probe.ok = false;
  const e = await rejects(() => resolve(payments.TestIyzicoKeysToken).execute("sandbox"), "iyzico_test_failed");
  assert(e.message.includes("api bilgileri bulunamadı"), e.message);
  probe.ok = true;
});

let added = "";
await t("bank: create, duplicate IBAN refused, Havale / EFT turns on with an active account", async () => {
  added = (await resolve(payments.CreateBankAccountToken).execute({ bankName: "Ziraat Bankası", accountHolder: "NOVA TİCARET A.Ş.", iban: "TR330006100519786457841326", instructions: "Açıklamaya sipariş no.", isActive: true }, actor)).id;
  await rejects(() => resolve(payments.CreateBankAccountToken).execute({ bankName: "Başka", accountHolder: "X", iban: "TR330006100519786457841326", isActive: true }, actor), "iban_taken");
  const s = await resolve(payments.SetBankTransferToken).execute(true, actor);
  assert(s.bankTransfer.active && s.bankTransfer.accounts.length === 2, JSON.stringify(s.bankTransfer));
  const o = await resolve(payments.GetPaymentOptionsToken).execute();
  assert(o.bankTransfer && o.bankAccounts.some((a: any) => a.iban === VALID), JSON.stringify(o));
});

await t("bank: the last active account cannot be deactivated or deleted while Havale / EFT is on; used accounts are never deleted", async () => {
  await rejects(() => resolve(payments.DeleteBankAccountToken).execute("ba_demo_1", actor), "bank_account_in_use");
  await resolve(payments.UpdateBankAccountToken).execute("ba_demo_1", { bankName: "Demo Bank", accountHolder: "NOVA TICARET A.S.", iban: "TR000000000000000000000001", instructions: null, isActive: false }, actor);
  await rejects(() => resolve(payments.UpdateBankAccountToken).execute(added, { bankName: "Ziraat Bankası", accountHolder: "NOVA TİCARET A.Ş.", iban: "TR330006100519786457841326", isActive: false }, actor), "last_active_bank_account");
  await rejects(() => resolve(payments.DeleteBankAccountToken).execute(added, actor), "last_active_bank_account");
  await rejects(() => resolve(payments.UpdateBankAccountToken).execute("ba_demo_1", { bankName: "Demo Bank", accountHolder: "N", iban: "TR330006100519786457841326", isActive: true }, actor), "bank_account_in_use");
  assert(one<any>("SELECT is_active FROM bank_accounts WHERE id = ?", added).is_active === 1, "still active");
});

await t("bank: off → deactivate and delete allowed; on again without an active account → 409", async () => {
  await resolve(payments.SetBankTransferToken).execute(false, actor);
  await resolve(payments.DeleteBankAccountToken).execute(added, actor);
  assert(count("SELECT count(*) AS n FROM bank_accounts") === 1, "deleted");
  await rejects(() => resolve(payments.SetBankTransferToken).execute(true, actor), "bank_account_required");
  await rejects(() => resolve(payments.DeleteBankAccountToken).execute("nope", actor), "bank_account_not_found");
  assert(count("SELECT count(*) AS n FROM audit_logs WHERE action LIKE 'bank_account.%'") === 3, "create, update, delete audited");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

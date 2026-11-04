import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { SettlePaymentToken } from "@/modules/checkout";
import { SettleRefundToken } from "@/modules/orders";
import { addOutboxHandler } from "@/modules/outbox";
import { SecretVaultToken } from "@/modules/platform/secrets";
import { ProcessCardRefund, StartCardPayment, VerifyCardPayment } from "./application/card-payments";
import {
  CreateBankAccount, DeleteBankAccount, GetPaymentOptions, GetPaymentSettings, SaveIyzicoKeys, SetBankTransfer, SetCardPayments, TestIyzicoKeys,
  UpdateBankAccount, type PaymentSettingsDeps,
} from "./application/payment-settings";
import type { PaymentGateway, PaymentRepository } from "./application/ports";
import type { IyzicoProbe, PaymentSettingsRepository } from "./application/settings-ports";
import { D1PaymentRepository } from "./infrastructure/d1-payment.repository";
import { D1PaymentSettingsRepository } from "./infrastructure/d1-payment-settings.repository";
import { IyzicoBinProbe, IyzicoGateway } from "./infrastructure/iyzico-gateway";

export const PaymentRepositoryToken = token<PaymentRepository>("PaymentRepository");
export const PaymentGatewayToken = token<PaymentGateway>("PaymentGateway");
export const StartCardPaymentToken = token<StartCardPayment>("StartCardPayment");
export const VerifyCardPaymentToken = token<VerifyCardPayment>("VerifyCardPayment");
export const ProcessCardRefundToken = token<ProcessCardRefund>("ProcessCardRefund");
export const PaymentSettingsRepositoryToken = token<PaymentSettingsRepository>("PaymentSettingsRepository");
/** iyzico key check; tests replace this token with a fake. */
export const IyzicoProbeToken = token<IyzicoProbe>("IyzicoProbe");
export const GetPaymentSettingsToken = token<GetPaymentSettings>("GetPaymentSettings");
export const GetPaymentOptionsToken = token<GetPaymentOptions>("GetPaymentOptions");
export const SaveIyzicoKeysToken = token<SaveIyzicoKeys>("SaveIyzicoKeys");
export const SetCardPaymentsToken = token<SetCardPayments>("SetCardPayments");
export const SetBankTransferToken = token<SetBankTransfer>("SetBankTransfer");
export const CreateBankAccountToken = token<CreateBankAccount>("CreateBankAccount");
export const UpdateBankAccountToken = token<UpdateBankAccount>("UpdateBankAccount");
export const DeleteBankAccountToken = token<DeleteBankAccount>("DeleteBankAccount");
export const TestIyzicoKeysToken = token<TestIyzicoKeys>("TestIyzicoKeys");

export function registerPayments(c: Container): void {
  c.scoped(PaymentRepositoryToken, (r) => new D1PaymentRepository(r.resolve(DatabaseToken)));
  c.scoped(PaymentGatewayToken, (r) => new IyzicoGateway(r.resolve(DatabaseToken), r.resolve(SecretVaultToken)));
  c.scoped(StartCardPaymentToken, (r) => new StartCardPayment(r.resolve(PaymentRepositoryToken), r.resolve(PaymentGatewayToken), r.resolve(ClockToken), r.resolve(ConfigToken).publicSiteUrl));
  c.scoped(VerifyCardPaymentToken, (r) => new VerifyCardPayment(
    r.resolve(PaymentRepositoryToken), r.resolve(PaymentGatewayToken),
    { settle: (paymentId, opts) => r.resolve(SettlePaymentToken).execute(paymentId, opts) },
    r.resolve(ClockToken), r.resolve(IdGeneratorToken), r.resolve(LoggerToken),
  ));
  c.scoped(ProcessCardRefundToken, (r) => new ProcessCardRefund(r.resolve(PaymentRepositoryToken), r.resolve(PaymentGatewayToken), r.resolve(SettleRefundToken)));

  const deps = (r: Resolver): PaymentSettingsDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(PaymentSettingsRepositoryToken), vault: r.resolve(SecretVaultToken), audit: r.resolve(AuditLogToken),
    clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken), masterKey: r.resolve(ConfigToken).secretsMasterKey,
  });
  c.singleton(IyzicoProbeToken, () => new IyzicoBinProbe());
  c.scoped(PaymentSettingsRepositoryToken, (r) => new D1PaymentSettingsRepository(r.resolve(DatabaseToken)));
  c.scoped(GetPaymentSettingsToken, (r) => new GetPaymentSettings(r.resolve(PaymentSettingsRepositoryToken), r.resolve(SecretVaultToken)));
  c.scoped(GetPaymentOptionsToken, (r) => new GetPaymentOptions(r.resolve(PaymentSettingsRepositoryToken)));
  c.scoped(SaveIyzicoKeysToken, (r) => new SaveIyzicoKeys(deps(r)));
  c.scoped(SetCardPaymentsToken, (r) => new SetCardPayments(deps(r)));
  c.scoped(SetBankTransferToken, (r) => new SetBankTransfer(deps(r)));
  c.scoped(CreateBankAccountToken, (r) => new CreateBankAccount(deps(r)));
  c.scoped(UpdateBankAccountToken, (r) => new UpdateBankAccount(deps(r)));
  c.scoped(DeleteBankAccountToken, (r) => new DeleteBankAccount(deps(r)));
  c.scoped(TestIyzicoKeysToken, (r) => new TestIyzicoKeys(r.resolve(PaymentSettingsRepositoryToken), r.resolve(SecretVaultToken), r.resolve(IyzicoProbeToken)));

  addOutboxHandler("refund.process", (r) => ({
    handle: async (payload) => ({ result: "done", detail: await r.resolve(ProcessCardRefundToken).execute(String(payload.refundId ?? "")) }),
  }));
}

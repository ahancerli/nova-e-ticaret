import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container } from "@/core";
import { SettlePaymentToken } from "@/modules/checkout";
import { SettleRefundToken } from "@/modules/orders";
import { addOutboxHandler } from "@/modules/outbox";
import { SecretVaultToken } from "@/modules/platform/secrets";
import { ProcessCardRefund, StartCardPayment, VerifyCardPayment } from "./application/card-payments";
import type { PaymentGateway, PaymentRepository } from "./application/ports";
import { D1PaymentRepository } from "./infrastructure/d1-payment.repository";
import { IyzicoGateway } from "./infrastructure/iyzico-gateway";

export const PaymentRepositoryToken = token<PaymentRepository>("PaymentRepository");
export const PaymentGatewayToken = token<PaymentGateway>("PaymentGateway");
export const StartCardPaymentToken = token<StartCardPayment>("StartCardPayment");
export const VerifyCardPaymentToken = token<VerifyCardPayment>("VerifyCardPayment");
export const ProcessCardRefundToken = token<ProcessCardRefund>("ProcessCardRefund");

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

  addOutboxHandler("refund.process", (r) => ({
    handle: async (payload) => ({ result: "done", detail: await r.resolve(ProcessCardRefundToken).execute(String(payload.refundId ?? "")) }),
  }));
}

import "server-only";
import { SettlePaymentToken } from "@/modules/checkout";
import { resolveService } from "../app";

/**
 * Legacy facade for the iyzico service (not yet migrated). A provider-verified payment may arrive after
 * the order expired: it is then recorded as a late payment (nothing sold, staff alerted) — never lost.
 */
export async function markPaymentPaid(paymentId: string, providerPaymentId: string | null, actorId: string | null) {
  return (await resolveService(SettlePaymentToken)).execute(paymentId, { providerPaymentId, actorId, allowLate: true });
}

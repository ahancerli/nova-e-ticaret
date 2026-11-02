import "server-only";
import { SettleRefundToken } from "@/modules/orders";
import { resolveService } from "../app";

/** Legacy facade for the outbox worker (not yet migrated). */
export async function settleRefund(refundId: string, r: { ok: boolean; providerRefundId?: string | null; failureCode?: string | null; actorId?: string | null }) {
  return (await resolveService(SettleRefundToken)).settle(refundId, r);
}

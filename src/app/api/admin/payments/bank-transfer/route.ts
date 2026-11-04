import { SetBankTransferToken, bankTransferSchema } from "@/modules/payments";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT /api/admin/payments/bank-transfer — Havale / EFT on (needs an active bank account) or off. */
export const PUT = route({
  auth: { audience: "admin", permission: "payments.secrets" },
  body: bankTransferSchema,
  handle: (ctx) => ctx.resolve(SetBankTransferToken).execute(ctx.body.active, actorOf(ctx)),
});

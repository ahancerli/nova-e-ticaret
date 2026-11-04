import { DeleteBankAccountToken, UpdateBankAccountToken, bankAccountSchema } from "@/modules/payments";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const PUT = route({
  auth: { audience: "admin", permission: "payments.secrets" },
  params: idParams,
  body: bankAccountSchema,
  handle: async (ctx) => {
    await ctx.resolve(UpdateBankAccountToken).execute(ctx.params.id, ctx.body, actorOf(ctx));
    return { updated: true };
  },
});

/** DELETE — refused (409) for accounts referenced by orders; those can only be deactivated. */
export const DELETE = route({
  auth: { audience: "admin", permission: "payments.secrets" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteBankAccountToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});

import { reply } from "@/core";
import { CreateBankAccountToken, bankAccountSchema } from "@/modules/payments";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const POST = route({
  auth: { audience: "admin", permission: "payments.secrets" },
  body: bankAccountSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(CreateBankAccountToken).execute(ctx.body, actorOf(ctx))),
});

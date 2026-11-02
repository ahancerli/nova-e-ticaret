import { NotFoundError } from "@/core";
import { GetCustomerToken, UpdateCustomerToken, customerUpdateSchema } from "@/modules/customers";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "customers.read" },
  params: idParams,
  handle: async ({ params, resolve }) => {
    const c = await resolve(GetCustomerToken).execute(params.id);
    if (!c) throw new NotFoundError("customer_not_found", "Müşteri bulunamadı.");
    return c;
  },
});

export const PATCH = route({
  auth: { audience: "admin", permission: ["customers.read", "customers.write"] },
  params: idParams,
  body: customerUpdateSchema,
  handle: async (ctx) => {
    await ctx.resolve(UpdateCustomerToken).execute(ctx.params.id, ctx.body, actorOf(ctx));
    return { updated: true };
  },
});

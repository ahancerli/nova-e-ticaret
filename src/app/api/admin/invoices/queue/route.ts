import { z } from "zod";
import { reply } from "@/core";
import { QueueInvoiceToken } from "@/modules/invoices";
import { actorOf } from "@/modules/shared/actor";
import { entityId } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST `{ orderId }` — issue the order's invoice through the accounting integration (Paraşüt) now. */
export const POST = route({
  auth: { audience: "admin", permission: "orders.write" },
  body: z.object({ orderId: entityId }).strict(),
  handle: async (ctx) => reply.accepted(await ctx.resolve(QueueInvoiceToken).execute(ctx.body.orderId, actorOf(ctx))),
});

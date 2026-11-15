import { RemoveSubscriberToken } from "@/modules/newsletter";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** DELETE — erase a subscriber (KVKK deletion request); the consent history stays as evidence. */
export const DELETE = route({
  auth: { audience: "admin", permission: "customers.write" },
  params: idParams,
  handle: (ctx) => ctx.resolve(RemoveSubscriberToken).execute(ctx.params.id, actorOf(ctx)),
});

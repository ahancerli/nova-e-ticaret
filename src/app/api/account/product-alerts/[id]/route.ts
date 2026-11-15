import { CancelProductAlertToken } from "@/modules/alerts";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** DELETE — the customer drops an open alert (product page toggle or Hesabım). */
export const DELETE = route({
  auth: { audience: "storefront", required: true },
  params: idParams,
  handle: (ctx) => ctx.resolve(CancelProductAlertToken).execute(ctx.params.id, actorOf(ctx)),
});

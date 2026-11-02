import { NotFoundError } from "@/core";
import { GetOrderDetailToken } from "@/modules/orders";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "orders.read" },
  params: idParams,
  handle: async ({ params, user, resolve }) => {
    const detail = await resolve(GetOrderDetailToken).execute(params.id, user!.permissions.has("customers.read"));
    if (!detail) throw new NotFoundError("order_not_found", "Sipariş bulunamadı.");
    return detail;
  },
});

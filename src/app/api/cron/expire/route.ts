import { ApiError, handler, ok } from "@/server/http";
import { getEnv } from "@/server/db";
import { safeEqual } from "@/server/crypto";
import { expireStaleCheckouts } from "@/server/services/checkout";

export const dynamic = "force-dynamic";

/**
 * Releases expired reservations, campaign allocations and coupons; cancels unpaid orders.
 * Call every few minutes with: Authorization: Bearer <CRON_SECRET>
 * (e.g. a small Cron Trigger worker or an external scheduler — see README).
 */
export const POST = handler(async (req) => {
  const env = await getEnv();
  const auth = req.headers.get("authorization") ?? "";
  if (!env.CRON_SECRET || !safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) throw new ApiError(401, "unauthorized", "Yetkisiz.");
  return ok(req, await expireStaleCheckouts());
});

import { ApiError, handler, ok } from "@/server/http";
import { getEnv } from "@/server/db";
import { safeEqual } from "@/server/crypto";
import { processOutbox } from "@/server/services/outbox";

export const dynamic = "force-dynamic";

/**
 * Delivers pending outbox events (refunds → iyzico, shipments → carrier, notifications).
 * Call every minute with: Authorization: Bearer <CRON_SECRET>   (optional ?limit=1..100)
 */
export const POST = handler(async (req) => {
  const env = await getEnv();
  const auth = req.headers.get("authorization") ?? "";
  if (!env.CRON_SECRET || !safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) throw new ApiError(401, "unauthorized", "Yetkisiz.");
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 25);
  return ok(req, await processOutbox(Number.isFinite(limit) ? limit : 25));
});

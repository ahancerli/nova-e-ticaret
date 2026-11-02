import { UnauthorizedError, safeEqual } from "@/core";

/** Scheduled jobs authenticate with `Authorization: Bearer <CRON_SECRET>` (constant-time compare). */
export function assertCronRequest(req: Request, cronSecret: string): void {
  const header = req.headers.get("authorization") ?? "";
  if (!cronSecret || !safeEqual(header, `Bearer ${cronSecret}`)) throw new UnauthorizedError("unauthorized", "Yetkisiz.");
}

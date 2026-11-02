import { z } from "zod";
import { ApiError, handler, ok } from "@/server/http";
import { applyTrackingEvents, verifyShippingWebhook } from "@/server/services/shipping";

export const dynamic = "force-dynamic";

const payload = z.object({
  events: z.array(z.object({
    eventId: z.string().trim().min(1).max(100),
    trackingNumber: z.string().trim().min(1).max(64),
    status: z.enum(["in_transit", "delivered", "returned", "lost"]),
    description: z.string().max(500).optional(),
    occurredAt: z.iso.datetime({ offset: true }),
  })).min(1).max(100),
});

/**
 * Carrier tracking webhook. Authenticated by an HMAC signature over the raw body (not by cookies),
 * replay-limited by timestamp, and de-duplicated per (shipment, provider event id).
 */
export const POST = handler(async (req, ctx: { params: Promise<{ provider: string }> }) => {
  const { provider } = await ctx.params;
  if (!/^[a-z0-9_]{2,40}$/.test(provider)) throw new ApiError(404, "unknown_provider", "Bilinmeyen sağlayıcı.");
  const raw = await req.text();
  if (raw.length > 256 * 1024) throw new ApiError(413, "payload_too_large", "İstek çok büyük.");
  await verifyShippingWebhook(provider, raw, req.headers.get("x-nova-timestamp"), req.headers.get("x-nova-signature"));
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new ApiError(400, "invalid_json", "Geçersiz JSON."); }
  const { events } = payload.parse(body);
  return ok(req, await applyTrackingEvents(events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt).toISOString() }))));
});

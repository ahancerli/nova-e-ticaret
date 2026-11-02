import { z } from "zod";
import { NotFoundError, PayloadTooLargeError, BadRequestError } from "@/core";
import { ApplyTrackingEventsToken, VerifyShippingWebhookToken } from "@/modules/shipping";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

const MAX_BODY = 256 * 1024;

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
 * Carrier tracking webhook. Authenticated by an HMAC signature over the RAW body (so the body is read
 * here, not by the pipeline), replay-limited by timestamp, de-duplicated per (shipment, provider event id).
 */
export const POST = route({
  csrf: "none",
  params: z.object({ provider: z.string() }),
  handle: async ({ req, params, resolve }) => {
    if (!/^[a-z0-9_]{2,40}$/.test(params.provider)) throw new NotFoundError("unknown_provider", "Bilinmeyen sağlayıcı.");
    const raw = await req.text();
    if (raw.length > MAX_BODY) throw new PayloadTooLargeError();
    await resolve(VerifyShippingWebhookToken).execute(params.provider, raw, req.headers.get("x-nova-timestamp"), req.headers.get("x-nova-signature"));
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new BadRequestError("invalid_json", "Geçersiz JSON."); }
    const { events } = payload.parse(body);
    return resolve(ApplyTrackingEventsToken).execute(events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt).toISOString() })));
  },
});

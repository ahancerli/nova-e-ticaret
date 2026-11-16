import { after } from "next/server";
import { LoggerToken, RateLimitError, RateLimiterToken } from "@/core";
import { ProcessConversationToken, REPLY_DEBOUNCE_MS, ReceiveWebhookToken } from "@/modules/social-ai";
import { container, resolveService } from "@/server/app";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * Meta webhook of Social AI Marketing — one callback URL for the shop's Meta app (WhatsApp Business Account +
 * Instagram). Plain route: Meta expects its own answers (the challenge as text, 200 for every notification).
 * Docs checked 2026-11-16 (Webhooks › Getting started / Set up Instagram webhooks).
 *
 * GET  verification request: `hub.mode=subscribe`, `hub.verify_token` (the token shown in the panel), `hub.challenge`.
 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const challenge = await (await resolveService(ReceiveWebhookToken)).challenge(q.get("hub.mode"), q.get("hub.verify_token"), q.get("hub.challenge"));
    return challenge ? text(challenge, 200) : text("forbidden", 403);
  } catch (err) {
    container.resolve(LoggerToken).error("meta webhook verification failed", { error: err instanceof Error ? err.message : String(err) });
    return text("error", 500);
  }
}

/**
 * POST notification: `X-Hub-Signature-256` is checked against the app secret over the raw body (wrong → 401, nothing
 * stored). Messages are stored and answered with 200 at once; the bot answers after the response, once the debounce
 * has passed (people type in pieces). A crashed or restarted process loses nothing: /api/cron/social-ai picks up
 * every conversation that is still due. Meta retries failed deliveries for 36 h → duplicates are dropped by message id.
 */
export async function POST(req: Request) {
  const logger = container.resolve(LoggerToken);
  try {
    const limiter = await resolveService(RateLimiterToken);
    await limiter.hit(`meta-webhook:${await limiter.clientKey(req)}`, 1200, 60);
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return text("payload too large", 413);
    const { accepted, conversationIds } = await (await resolveService(ReceiveWebhookToken)).execute(raw, req.headers.get("x-hub-signature-256"));
    if (!accepted) {
      logger.warn("meta webhook signature mismatch");
      return text("invalid signature", 401);
    }
    if (conversationIds.length) {
      after(async () => {
        await new Promise((r) => setTimeout(r, REPLY_DEBOUNCE_MS + 250));
        for (const id of conversationIds) {
          try {
            // Not due yet (a newer message moved the debounce) or already taken → "skipped"; that message's own timer answers.
            await (await resolveService(ProcessConversationToken)).execute(id);
          } catch (err) {
            logger.error("social ai reply failed", { conversationId: id, error: err instanceof Error ? err.message : String(err) });
          }
        }
      });
    }
    return text("EVENT_RECEIVED", 200);
  } catch (err) {
    if (err instanceof RateLimitError) return text("rate limited", 429);
    logger.error("meta webhook failed", { error: err instanceof Error ? err.message : String(err) });
    return text("error", 500); // Meta retries
  }
}

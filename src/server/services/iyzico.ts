import "server-only";
import { getDb, getEnv } from "../db";
import { decryptSecret, hmacHex, randomToken, sha256Hex, toBase64 } from "../crypto";
import { ApiError } from "../http";
import { newId, nowIso } from "@/lib/ids";
import { markPaymentPaid } from "./checkout";

/**
 * iyzico Checkout Form adapter.
 *
 * Security model (spec §07):
 *  - Payment is started server-side; the browser's "success" redirect is never proof of payment.
 *  - After callback/webhook we ALWAYS re-query iyzico (checkoutform detail) and compare
 *    status, paidPrice, currency and basketId with our own order before marking paid.
 *  - Credentials live encrypted in integration_secrets (payment_config_id = active iyzico config).
 *
 * ⚠ Verify request signing, field names and webhook signature (V3) against the current
 *   official docs before going live: https://docs.iyzico.com — they change over time.
 */

interface IyzicoCreds { apiKey: string; secretKey: string; baseUrl: string; configId: string }

async function loadCreds(): Promise<IyzicoCreds> {
  const db = await getDb();
  const env = await getEnv();
  const cfg = await db
    .prepare("SELECT id, public_config_json FROM payment_configs WHERE provider = 'iyzico' AND is_active = 1 LIMIT 1")
    .first<{ id: string; public_config_json: string }>();
  if (!cfg) throw new ApiError(422, "payment_method_unavailable", "Kart ile ödeme şu an kullanılamıyor.");
  const { results } = await db
    .prepare("SELECT secret_name, ciphertext, nonce, auth_tag FROM integration_secrets WHERE payment_config_id = ?")
    .bind(cfg.id)
    .all<{ secret_name: string; ciphertext: string; nonce: string; auth_tag: string }>();
  const get = async (name: string) => {
    const s = (results ?? []).find((r) => r.secret_name === name);
    if (!s) throw new ApiError(500, "payment_misconfigured", "Ödeme yapılandırması eksik.");
    return decryptSecret(env.SECRETS_MASTER_KEY, { ciphertext: s.ciphertext, nonce: s.nonce, authTag: s.auth_tag });
  };
  const pub = JSON.parse(cfg.public_config_json || "{}") as { baseUrl?: string };
  return { apiKey: await get("api_key"), secretKey: await get("secret_key"), baseUrl: pub.baseUrl ?? "https://sandbox-api.iyzipay.com", configId: cfg.id };
}

/** IYZWSv2 HMAC-SHA256 authorization. */
async function call<T>(creds: IyzicoCreds, path: string, body: Record<string, unknown>): Promise<T> {
  const json = JSON.stringify(body);
  const randomKey = `${Date.now()}${randomToken(6)}`;
  const signature = await hmacHex(creds.secretKey, randomKey + path + json);
  const auth = toBase64(new TextEncoder().encode(`apiKey:${creds.apiKey}&randomKey:${randomKey}&signature:${signature}`));
  const res = await fetch(creds.baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `IYZWSv2 ${auth}`, "x-iyzi-rnd": randomKey },
    body: json,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new ApiError(502, "payment_provider_error", "Ödeme sağlayıcısına ulaşılamadı.");
  return (await res.json()) as T;
}

const price = (minor: number) => (minor / 100).toFixed(2);

/** Creates an iyzico checkout form for a pending card payment. */
export async function startCheckoutForm(paymentId: string, buyerIp: string) {
  const db = await getDb();
  const env = await getEnv();
  const creds = await loadCreds();
  const pay = await db
    .prepare(`SELECT p.id, p.status, p.amount_minor, p.conversation_id, o.id AS order_id, o.order_number, o.customer_email, o.customer_phone,
                     o.user_id, o.shipping_minor, o.placed_at
                FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ? AND p.provider = 'iyzico'`)
    .bind(paymentId)
    .first<{ id: string; status: string; amount_minor: number; conversation_id: string; order_id: string; order_number: string; customer_email: string; customer_phone: string | null; user_id: string | null; shipping_minor: number; placed_at: string }>();
  if (!pay) throw new ApiError(404, "payment_not_found", "Ödeme bulunamadı.");
  if (pay.status !== "pending" && pay.status !== "created") throw new ApiError(409, "payment_not_pending", "Bu ödeme başlatılamaz.");

  const [items, ship, bill] = await db.batch([
    db.prepare("SELECT id, product_name_snapshot, total_minor FROM order_items WHERE order_id = ? AND total_minor > 0").bind(pay.order_id),
    db.prepare("SELECT * FROM order_addresses WHERE order_id = ? AND kind = 'shipping'").bind(pay.order_id),
    db.prepare("SELECT * FROM order_addresses WHERE order_id = ? AND kind = 'billing'").bind(pay.order_id),
  ]);
  type Addr = { recipient_name: string; province: string; district: string; line1: string; line2: string | null; postal_code: string | null };
  const s = ship!.results?.[0] as Addr;
  const b = (bill!.results?.[0] as Addr | undefined) ?? s;
  const [name, ...rest] = s.recipient_name.trim().split(/\s+/);
  const basketItems = ((items!.results ?? []) as { id: string; product_name_snapshot: string; total_minor: number }[]).map((i) => ({
    id: i.id, name: i.product_name_snapshot.slice(0, 100), category1: "Genel", itemType: "PHYSICAL", price: price(i.total_minor),
  }));
  if (pay.shipping_minor > 0) basketItems.push({ id: "shipping", name: "Kargo", category1: "Kargo", itemType: "VIRTUAL", price: price(pay.shipping_minor) });
  const addr = (a: Addr) => ({ contactName: a.recipient_name, city: a.province, country: "Turkey", address: [a.line1, a.line2, a.district].filter(Boolean).join(", "), zipCode: a.postal_code ?? undefined });

  const resp = await call<{ status: string; token?: string; paymentPageUrl?: string; checkoutFormContent?: string; errorMessage?: string }>(
    creds,
    "/payment/iyzipos/checkoutform/initialize/auth/ecom",
    {
      locale: "tr",
      conversationId: pay.conversation_id,
      price: price(pay.amount_minor),
      paidPrice: price(pay.amount_minor),
      currency: "TRY",
      basketId: pay.order_number,
      paymentGroup: "PRODUCT",
      callbackUrl: `${env.PUBLIC_SITE_URL.replace(/\/$/, "")}/api/payments/iyzico/callback`,
      enabledInstallments: [1, 2, 3, 6, 9],
      buyer: {
        id: pay.user_id ?? `guest-${pay.order_id}`,
        name: name ?? "Müşteri",
        surname: rest.join(" ") || "-",
        gsmNumber: pay.customer_phone ?? undefined,
        email: pay.customer_email,
        // TCKN: collecting it is a legal/business decision. Placeholder accepted by iyzico for non-invoice flows.
        identityNumber: "11111111111",
        registrationAddress: addr(b).address,
        ip: buyerIp,
        city: b.province,
        country: "Turkey",
      },
      shippingAddress: addr(s),
      billingAddress: addr(b),
      basketItems,
    },
  );
  if (resp.status !== "success" || !resp.token) {
    await db.prepare("UPDATE payments SET status = 'failed', failure_code = ?, updated_at = ? WHERE id = ?").bind("init_failed", nowIso(), pay.id).run();
    throw new ApiError(502, "payment_init_failed", "Ödeme başlatılamadı.");
  }
  await db.prepare("UPDATE payments SET provider_payment_id = ?, updated_at = ? WHERE id = ?").bind(`token:${resp.token}`, nowIso(), pay.id).run();
  return { paymentPageUrl: resp.paymentPageUrl ?? null, token: resp.token };
}

/**
 * Verifies a checkout form token with iyzico and settles the payment if everything matches.
 * Used by both the browser callback and the server webhook; safe to call repeatedly.
 */
export async function verifyAndSettle(token: string, source: "callback" | "webhook", eventId?: string) {
  const db = await getDb();
  const creds = await loadCreds();
  const pay = await db
    .prepare(`SELECT p.id, p.status, p.amount_minor, p.currency, p.conversation_id, o.order_number
                FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.provider_payment_id = ?`)
    .bind(`token:${token}`)
    .first<{ id: string; status: string; amount_minor: number; currency: string; conversation_id: string; order_number: string }>();

  const detail = await call<{ status: string; paymentStatus?: string; paidPrice?: number | string; price?: number | string; currency?: string; basketId?: string; paymentId?: string; conversationId?: string }>(
    creds,
    "/payment/iyzipos/checkoutform/auth/ecom/detail",
    { locale: "tr", conversationId: pay?.conversation_id, token },
  );

  const payloadHash = await sha256Hex(JSON.stringify(detail));
  const providerEventId = eventId ?? `${source}:${detail.paymentId ?? token}`;
  // Record the event once (UNIQUE provider+event id → duplicate deliveries are no-ops).
  const inserted = await db
    .prepare(`INSERT INTO payment_events (id, payment_id, provider, provider_event_id, event_type, payload_sha256, signature_valid, processing_status)
              VALUES (?, ?, 'iyzico', ?, ?, ?, 0, 'received') ON CONFLICT(provider, provider_event_id) DO NOTHING`)
    .bind(newId(), pay?.id ?? null, providerEventId, `checkoutform.${source}`, payloadHash)
    .run();
  if ((inserted.meta.changes ?? 0) === 0 && pay?.status === "paid") return { status: "paid" as const, orderNumber: pay.order_number };
  if (!pay) return { status: "unknown" as const, orderNumber: null };

  const paidMinor = Math.round(Number(detail.paidPrice ?? 0) * 100);
  const priceMinor = Math.round(Number(detail.price ?? 0) * 100);
  const matches =
    detail.status === "success" &&
    detail.paymentStatus === "SUCCESS" &&
    detail.basketId === pay.order_number &&
    (detail.currency ?? "TRY") === pay.currency &&
    priceMinor === pay.amount_minor &&
    paidMinor >= pay.amount_minor; // paidPrice may include installment interest

  if (!matches) {
    await db.batch([
      db.prepare("UPDATE payments SET status = CASE WHEN status = 'paid' THEN status ELSE 'failed' END, failure_code = ?, updated_at = ? WHERE id = ?")
        .bind(detail.paymentStatus ?? "verification_failed", nowIso(), pay.id),
      db.prepare("UPDATE payment_events SET processing_status = 'failed', processed_at = ? WHERE provider = 'iyzico' AND provider_event_id = ?").bind(nowIso(), providerEventId),
    ]);
    return { status: "failed" as const, orderNumber: pay.order_number };
  }

  await markPaymentPaid(pay.id, detail.paymentId ?? null, null);
  await db.prepare("UPDATE payment_events SET processing_status = 'processed', processed_at = ? WHERE provider = 'iyzico' AND provider_event_id = ?").bind(nowIso(), providerEventId).run();
  return { status: "paid" as const, orderNumber: pay.order_number };
}

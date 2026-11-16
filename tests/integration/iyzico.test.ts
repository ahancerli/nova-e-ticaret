// iyzico adapter against the documented contract (docs.iyzico.com, checked 2026-11-16) — the real IyzicoGateway with
// `fetch` answered by a fake server; every signature is recomputed here independently with node:crypto:
// IYZWSv2 authorization, Checkout Form retrieve response signature (trailing zeros), Refund V1 per basket item,
// /payment/detail, installment inquiry, webhook X-IYZ-SIGNATURE-V3 (HPP + direct), refund split over basket items.
// Run: npm run test:iyzico
import { createHmac } from "node:crypto";
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { IyzicoGateway } = await import(`${ROOT}/src/modules/payments/infrastructure/iyzico-gateway.ts`);
const iyz = await import(`${ROOT}/src/modules/payments/domain/iyzico.ts`);
const { detailMatchesPayment } = await import(`${ROOT}/src/modules/payments/domain/payment.ts`);

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const json = (v: unknown) => JSON.stringify(v);

const API_KEY = "sandbox-api-key";
const SECRET = "sandbox-secret-key";
const hmac = (data: string) => createHmac("sha256", SECRET).update(data, "utf8").digest("hex");

const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
d1.raw.exec("UPDATE payment_configs SET is_active = 1 WHERE id = 'pc_iyzico_sbx'");
const vault = { read: async (_scope: unknown, name: string) => (name === "api_key" ? API_KEY : SECRET) };
const gateway = () => new IyzicoGateway(new core.SqlDatabaseAdapter(d1), vault as any);

// fake iyzico: records requests, answers with the next queued body
const calls: { url: string; headers: Record<string, string>; body: any; raw: string }[] = [];
const answers: unknown[] = [];
globalThis.fetch = (async (url: string, init: any) => {
  calls.push({ url, headers: init.headers, body: JSON.parse(init.body), raw: init.body });
  return new Response(JSON.stringify(answers.shift() ?? { status: "success" }), { status: 200, headers: { "content-type": "application/json" } });
}) as any;
const last = () => calls[calls.length - 1]!;

await t("IYZWSv2: Authorization = base64(apiKey:…&randomKey:…&signature:hex(HMAC(secret, randomKey + path + body))), sandbox host", async () => {
  answers.push({ status: "success", token: "tok-1234567890", paymentPageUrl: "https://sandbox/pay" });
  await gateway().initializeCheckoutForm({
    conversationId: "c1", amountMinor: 12050, basketId: "NOVA-1", callbackUrl: "https://nova.test/cb",
    buyer: { id: "u1", name: "A", surname: "B", email: "a@b.c", ip: "1.1.1.1", city: "İstanbul", country: "Turkey", registrationAddress: "x" },
    shippingAddress: { contactName: "A B", city: "İstanbul", country: "Turkey", address: "x" }, billingAddress: { contactName: "A B", city: "İstanbul", country: "Turkey", address: "x" },
    basketItems: [{ id: "oi1", name: "Tava", category1: "Genel", itemType: "PHYSICAL", priceMinor: 12050 }],
  });
  const c = last();
  const path = "/payment/iyzipos/checkoutform/initialize/auth/ecom";
  assert(c.url === `https://sandbox-api.iyzipay.com${path}`, c.url);
  const auth = Buffer.from(c.headers.Authorization!.replace("IYZWSv2 ", ""), "base64").toString();
  const m = /^apiKey:(.+)&randomKey:(.+)&signature:([0-9a-f]{64})$/.exec(auth);
  assert(m && m[1] === API_KEY && m[2] === c.headers["x-iyzi-rnd"], auth);
  assert(m[3] === hmac(m[2] + path + c.raw), "signature over randomKey + path + body");
  assert(c.body.price === "120.50" && c.body.paidPrice === "120.50" && json(c.body.enabledInstallments) === "[1,2,3,6,9]" && c.body.basketItems[0].price === "120.50", json(c.body));
});

const detail = (over: Record<string, unknown> = {}) => ({
  status: "success", paymentStatus: "SUCCESS", paymentId: "25180208", currency: "TRY", basketId: "NOVA-1", conversationId: "c1",
  paidPrice: "121.50", price: "120.50", token: "tok-1234567890",
  itemTransactions: [{ itemId: "oi1", paymentTransactionId: 99887766, price: "120.50", paidPrice: "121.50" }], ...over,
});
const cfSig = (d: any) => hmac([d.paymentStatus, d.paymentId, d.currency, d.basketId, d.conversationId, "121.5", "120.5", d.token].join(":"));

await t("Checkout Form retrieve: signature over paymentStatus:paymentId:currency:basketId:conversationId:paidPrice:price:token without trailing zeros", async () => {
  const d = detail();
  answers.push({ ...d, signature: cfSig(d) });
  const ok = await gateway().checkoutFormDetail("tok-1234567890", "c1");
  assert(ok.signatureValid === true && last().url.endsWith("/payment/iyzipos/checkoutform/auth/ecom/detail"), json(ok));
  assert(ok.itemTransactions?.[0]?.paymentTransactionId === "99887766", "transaction id kept as string");
  assert(detailMatchesPayment(ok, { orderNumber: "NOVA-1", currency: "TRY", amountMinor: 12050 }), "matches with installment interest (paidPrice > price)");
  answers.push({ ...d, paymentStatus: "SUCCESS", signature: cfSig({ ...d, basketId: "NOVA-2" }) });
  const bad = await gateway().checkoutFormDetail("tok-1234567890", "c1");
  assert(bad.signatureValid === false && !detailMatchesPayment(bad, { orderNumber: "NOVA-1", currency: "TRY", amountMinor: 12050 }), "tampered → not settled");
  answers.push(d);
  assert((await gateway().checkoutFormDetail("tok-1234567890", "c1")).signatureValid === null, "no signature → not checked");
  assert(iyz.signatureAmount("50.00") === "50" && iyz.signatureAmount("10.50") === "10.5" && iyz.signatureAmount(10.5) === "10.5" && iyz.signatureAmount("100") === "100", "trailing zeros");
});

await t("Refund V1: POST /payment/refund with paymentTransactionId, price, currency, ip; response signature paymentId:price:currency:conversationId", async () => {
  answers.push({ status: "success", paymentId: "25180208", paymentTransactionId: "99887766", price: 30, currency: "TRY", conversationId: "refund-r1-oi1",
    refundHostReference: "host-1", signature: hmac(["25180208", "30", "TRY", "refund-r1-oi1"].join(":")) });
  const r = await gateway().refundItem({ paymentTransactionId: "99887766", amountMinor: 3000, conversationId: "refund-r1-oi1", ip: "127.0.0.1" });
  const c = last();
  assert(c.url.endsWith("/payment/refund") && !c.url.includes("/v2/"), c.url);
  assert(c.body.paymentTransactionId === "99887766" && c.body.price === "30.00" && c.body.currency === "TRY" && c.body.ip === "127.0.0.1" && !("paymentId" in c.body), json(c.body));
  assert(r.ok && r.providerRef === "host-1", json(r));
  answers.push({ status: "failure", errorCode: "5093", errorMessage: "iade edilemez" });
  const f = await gateway().refundItem({ paymentTransactionId: "99887766", amountMinor: 3000, conversationId: "x", ip: "127.0.0.1" });
  assert(!f.ok && f.failureCode === "5093", json(f));
});

await t("Retrieve payment (/payment/detail): item transactions of an older payment, signature checked", async () => {
  const d = { status: "success", paymentId: "25180208", currency: "TRY", basketId: "NOVA-1", conversationId: "c1", paidPrice: "121.50", price: "120.50",
    itemTransactions: [{ itemId: "oi1", paymentTransactionId: "99887766", price: "100.00", paidPrice: "101.00" }, { itemId: "shipping", paymentTransactionId: "99887767", price: "20.50", paidPrice: "20.50" }] };
  answers.push({ ...d, signature: hmac(["25180208", "TRY", "NOVA-1", "c1", "121.5", "120.5"].join(":")) });
  const items = await gateway().paymentItems("25180208");
  assert(last().body.paymentId === "25180208" && last().url.endsWith("/payment/detail"), json(last().body));
  assert(json(items) === json([{ itemId: "oi1", paymentTransactionId: "99887766", priceMinor: 10000, paidPriceMinor: 10100 }, { itemId: "shipping", paymentTransactionId: "99887767", priceMinor: 2050, paidPriceMinor: 2050 }]), json(items));
  answers.push({ ...d, signature: "00" });
  assert((await gateway().paymentItems("25180208")) === null, "bad signature → unusable");
});

await t("installment inquiry: POST /payment/iyzipos/installment with price (no BIN), parsed per card family", async () => {
  answers.push({ status: "success", installmentDetails: [{ cardFamilyName: "Bonus", bankName: "Garanti", commercial: 0,
    installmentPrices: [{ installmentNumber: 1, installmentPrice: "1000.00", totalPrice: "1000.00" }, { installmentNumber: 3, installmentPrice: "340.00", totalPrice: "1020.00" }] }] });
  const r = await gateway().installments(100000);
  assert(last().url.endsWith("/payment/iyzipos/installment") && last().body.price === "1000.00" && !("binNumber" in last().body), json(last().body));
  assert(r?.[0]?.cardFamily === "Bonus" && r[0].prices[1]!.count === 3 && r[0].prices[1]!.monthlyMinor === 34000 && r[0].prices[1]!.totalMinor === 102000, json(r));
});

await t("webhook X-IYZ-SIGNATURE-V3: HPP = secret + eventType + iyziPaymentId + token + conversationId + status; direct uses paymentId", async () => {
  const hpp = { iyziEventType: "CHECKOUT_FORM_AUTH", iyziPaymentId: 25180208, token: "tok-1234567890", paymentConversationId: "c1", status: "SUCCESS", iyziReferenceCode: "ref" };
  const sig = hmac(SECRET + "CHECKOUT_FORM_AUTH" + "25180208" + "tok-1234567890" + "c1" + "SUCCESS");
  assert((await gateway().webhookSignatureValid(hpp, sig)) === true, "valid HPP");
  assert((await gateway().webhookSignatureValid({ ...hpp, status: "FAILURE" }, sig)) === false, "status tampered");
  assert((await gateway().webhookSignatureValid(hpp, sig.toUpperCase())) === true, "hex case-insensitive");
  const direct = { iyziEventType: "THREE_DS_AUTH", paymentId: 123, paymentConversationId: "c2", status: "SUCCESS" };
  assert((await gateway().webhookSignatureValid(direct, hmac(SECRET + "THREE_DS_AUTH" + "123" + "c2" + "SUCCESS"))) === true, "direct format");
});

await t("refund split: cancelled items first, other products next, shipping last; never above an item's price", () => {
  const items = [
    { itemId: "shipping", paymentTransactionId: "t-s", priceMinor: 3990, refundedMinor: 0 },
    { itemId: "a", paymentTransactionId: "t-a", priceMinor: 10000, refundedMinor: 2000 },
    { itemId: "b", paymentTransactionId: "t-b", priceMinor: 5000, refundedMinor: 0 },
  ];
  assert(json(iyz.planRefundParts(9000, items, ["b"])) === json([{ paymentTransactionId: "t-b", itemId: "b", amountMinor: 5000 }, { paymentTransactionId: "t-a", itemId: "a", amountMinor: 4000 }]), "preferred first");
  assert(iyz.planRefundParts(16990, items)!.at(-1)!.itemId === "shipping", "shipping last");
  assert(iyz.planRefundParts(17000, items) === null, "more than the items hold");
});

await t("installment table: personal cards only, one row per family, only enabled counts; cached per amount; provider down → empty", async () => {
  const { GetInstallmentOptions } = await import(`${ROOT}/src/modules/payments/application/installments.ts`);
  const { clearInstallmentCache } = await import(`${ROOT}/src/modules/payments/index.ts`);
  clearInstallmentCache();
  let asked = 0;
  let down = false;
  const fake = {
    isAvailable: async () => true,
    installments: async () => {
      asked++;
      if (down) throw new Error("down");
      const p = (count: number) => ({ count, monthlyMinor: Math.round(100000 * (1 + count / 100) / count), totalMinor: Math.round(100000 * (1 + count / 100)) });
      return [
        { cardFamily: "World", bankName: "Yapı Kredi", commercial: false, prices: [p(1), p(2), p(3), p(6), p(9), p(12)] },
        { cardFamily: "Bonus", bankName: "Garanti", commercial: false, prices: [p(1), p(3), p(6)] },
        { cardFamily: "Bonus", bankName: "Denizbank", commercial: false, prices: [p(1), p(3)] },
        { cardFamily: "Business", bankName: "X", commercial: true, prices: [p(1), p(3)] },
      ];
    },
  };
  const clock = new core.FixedClock(new Date("2026-11-16T10:00:00.000Z"));
  const q = new GetInstallmentOptions(fake as any, clock);
  const r = await q.execute(100000);
  assert(r.available && json(r.families.map((f: any) => f.name)) === json(["Bonus", "World"]) && json(r.counts) === "[1,2,3,6,9]", json(r));
  assert(!r.families.find((f: any) => f.name === "World").options.some((o: any) => o.count === 12), "12 not enabled");
  await q.execute(100000);
  assert(asked === 1, "cached");
  down = true;
  const e = await q.execute(55500);
  assert(!e.available && e.families.length === 0, "provider down → empty table, no error");
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);

// iyzico SANDBOX check with real keys, through the same adapter the app uses (IyzicoGateway) — no app DB needed
// (an in-memory one holds the sandbox config). Keys: IYZICO_SANDBOX_API_KEY / IYZICO_SANDBOX_SECRET_KEY in the
// environment or .env.local; never printed. Steps (each needs the previous one):
//   npm run iyzico:sandbox                         → auth (BIN check), installment inquiry, Checkout Form initialize
//                                                    → prints a payment page: pay with a sandbox test card
//                                                      (iyzico docs › Test Kartları, e.g. 5528790000000008, 12/30, 123)
//   npm run iyzico:sandbox -- --token=<token>      → Checkout Form retrieve: response signature + itemTransactions
//   npm run iyzico:sandbox -- --token=<token> --refund=<kuruş>
//                                                  → Refund V1 of the first basket item (response signature checked)
//   npm run iyzico:sandbox -- --webhook='<json body>' --signature=<X-IYZ-SIGNATURE-V3>
//                                                  → checks a webhook you captured (e.g. with a request bin)
import { makeD1 } from "../tests/integration/d1-sqlite.mjs"
import { loadEnv } from "./env.mjs"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
loadEnv(process.env.ENV_FILE || ".env.local")
const apiKey = process.env.IYZICO_SANDBOX_API_KEY
const secretKey = process.env.IYZICO_SANDBOX_SECRET_KEY
if (!apiKey || !secretKey) { console.error("✖ IYZICO_SANDBOX_API_KEY / IYZICO_SANDBOX_SECRET_KEY eksik (.env.local)"); process.exit(2) }

const core = await import(`${ROOT}/src/core/index.ts`)
const { IyzicoGateway, IyzicoBinProbe } = await import(`${ROOT}/src/modules/payments/infrastructure/iyzico-gateway.ts`)
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const d1 = makeD1([`${ROOT}/db/schema.sql`])
d1.raw.exec("INSERT INTO payment_configs (id, provider, name, environment, is_active) VALUES ('pc_sbx','iyzico','sandbox','sandbox',1)")
const vault = { read: async (_s, name) => (name === "api_key" ? apiKey : secretKey) }
const gw = new IyzicoGateway(new core.SqlDatabaseAdapter(d1), vault, { error: (m, d) => console.error("  ⚠", m, JSON.stringify(d ?? {})), warn() {}, info() {}, debug() {}, child() { return this } })
let failed = 0
const ok = (m) => console.log(`✓ ${m}`)
const bad = (m) => { failed++; console.log(`✖ ${m}`) }
/** ✓ / ✖ line by condition. */
const check = (cond, good, wrong) => (cond ? ok(good) : bad(wrong))

const token = arg("token")
const webhook = arg("webhook")
if (webhook) {
  const v = await gw.webhookSignatureValid(JSON.parse(webhook), String(arg("signature") ?? ""))
  check(v, "webhook X-IYZ-SIGNATURE-V3 doğru", "webhook imzası tutmadı (gövdeyi ve başlığı olduğu gibi verin)")
} else if (!token) {
  const auth = await new IyzicoBinProbe().check({ apiKey, secretKey, baseUrl: "https://sandbox-api.iyzipay.com" })
  check(auth.ok, "IYZWSv2 kimlik doğrulama (BIN sorgusu)", `kimlik doğrulama: ${auth.message}`)
  const inst = await gw.installments(100000)
  check(inst?.length, inst?.length ? `taksit sorgusu: ${inst.length} kart ailesi, örn. ${inst[0].cardFamily ?? inst[0].bankName}: ${inst[0].prices.map((p) => p.count).join("/")}` : "", "taksit sorgusu boş döndü")
  const conv = `sbx-${Date.now()}`
  const form = await gw.initializeCheckoutForm({
    conversationId: conv, amountMinor: 15000, basketId: `SBX-${Date.now()}`, callbackUrl: "https://example.com/iyzico-callback",
    buyer: { id: "sbx-buyer", name: "Test", surname: "Alıcı", email: "test@example.com", ip: "85.34.78.112", city: "Istanbul", country: "Turkey", registrationAddress: "Test Mah. 1" },
    shippingAddress: { contactName: "Test Alıcı", city: "Istanbul", country: "Turkey", address: "Test Mah. 1" },
    billingAddress: { contactName: "Test Alıcı", city: "Istanbul", country: "Turkey", address: "Test Mah. 1" },
    basketItems: [
      { id: "item-1", name: "Ürün 1", category1: "Genel", itemType: "PHYSICAL", priceMinor: 10000 },
      { id: "shipping", name: "Kargo", category1: "Kargo", itemType: "VIRTUAL", priceMinor: 5000 },
    ],
  })
  if (form.ok) {
    ok(`Checkout Form başlatıldı (iki sepet kalemi, ${150} TL)`)
    console.log(`\n  1) Şu sayfada test kartıyla ödeyin: ${form.paymentPageUrl}`)
    console.log(`  2) Sonra: npm run iyzico:sandbox -- --token=${form.token}\n`)
  } else bad(`Checkout Form başlatılamadı: ${form.error}`)
} else {
  const d = await gw.checkoutFormDetail(token, null)
  check(d.status === "success" && d.paymentStatus === "SUCCESS", `ödeme sonucu: SUCCESS, paymentId ${d.paymentId}, paidPrice ${d.paidPrice}`, `ödeme sonucu: ${d.status} / ${d.paymentStatus ?? "-"} (ödeme tamamlandı mı?)`)
  if (d.signatureValid === null) console.log("• yanıtta imza yok (hesapta kapalı olabilir)")
  else check(d.signatureValid, "Checkout Form yanıt imzası doğru", "Checkout Form yanıt imzası TUTMADI — canlıya çıkmayın, bildirin")
  const items = d.itemTransactions ?? []
  check(items.length, `itemTransactions: ${items.map((i) => `${i.itemId}→${i.paymentTransactionId}`).join(", ")}`, "itemTransactions yok — Refund V1 yapılamaz")
  const refund = Number(arg("refund") ?? 0)
  if (refund > 0 && items[0]) {
    const r = await gw.refundItem({ paymentTransactionId: items[0].paymentTransactionId, amountMinor: refund, conversationId: `sbx-refund-${Date.now()}`, ip: "85.34.78.112" })
    check(r.ok, `Refund V1: ${refund} kuruş iade edildi (${items[0].itemId}), yanıt imzası yukarıda uyarı yoksa doğru`, `Refund V1 reddedildi: ${r.failureCode}`)
  }
}
console.log(failed ? `\n${failed} adım başarısız` : "\nTamam")
process.exit(failed ? 1 : 0)

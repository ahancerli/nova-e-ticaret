// SMS / cargo integrations: pure rules (phones, templates, event mapping, field validation), the Netgsm and Yurtiçi
// adapters against canned HTTP answers (request shape + parsing), catalog ↔ adapter consistency, and through the DI
// container: catalog page, "entegrasyon yok" refusal, sealed secrets, replace / keep, test SMS, order SMS through the
// outbox, carrier booking and tracking sync. No real provider is contacted. Run: npm run test:providers
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const mod = (p: string) => import(`${ROOT}/src/modules/${p}.ts`);
const [integrations, connectors, netgsmMod, yurticiMod, platform, secrets, audit, outbox, shipping, notifications, settings] = await Promise.all([
  mod("integrations/index"), mod("integrations/infrastructure/connectors/index"), mod("integrations/infrastructure/connectors/netgsm"),
  mod("integrations/infrastructure/connectors/yurtici"), mod("platform/module"), mod("platform/secrets"), mod("audit/audit-log"), mod("outbox/index"),
  mod("shipping/index"), mod("notifications/notifications"), mod("settings/index"),
]);
const { Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig } = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string) {
  try { await fn(); } catch (e: any) { assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`); return e; }
  throw new Error(`expected ${code}, nothing thrown`);
}
/** fetch double: records requests, answers with the next canned response. */
function fakeFetch(...answers: { status?: number; body: string }[]) {
  const calls: { url: string; init: any }[] = [];
  const fn = async (url: string, init: any) => {
    calls.push({ url, init });
    const a = answers.shift() ?? { body: "" };
    return new Response(a.body, { status: a.status ?? 200 });
  };
  return Object.assign(fn, { calls });
}
const soap = (inner: string) => `<?xml version="1.0"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><ns2:r xmlns:ns2="x">${inner}</ns2:r></S:Body></S:Envelope>`;

// --- pure ------------------------------------------------------------------------------------------
await t("phones: Turkish mobiles normalised to 5XXXXXXXXX, others refused", () => {
  for (const p of ["+905321234567", "0532 123 45 67", "5321234567", "90 532 123 4567"]) assert(integrations.trMobile(p) === "5321234567", p);
  for (const p of ["+902161234567", "123", "", null, "+4915112345678"]) assert(integrations.trMobile(p) === null, String(p));
});

await t("templates: variables filled, empty ones vanish without stray spaces; parts estimate", () => {
  const s = integrations.renderTemplate("{{magaza}}: {{siparis_no}} kargoda.{{takip_bilgisi}} {{yok}}", { magaza: "Nova", siparis_no: "NV1", takip_bilgisi: "" });
  assert(s === "Nova: NV1 kargoda.", JSON.stringify(s));
  assert(integrations.smsParts("a".repeat(155)) === 1 && integrations.smsParts("a".repeat(156)) === 2, "parts");
});

await t("event mapping: card orders are announced on payment, transfers at once", () => {
  const f = integrations.smsEventFor;
  assert(f("order.placed", "iyzico") === null && f("order.paid", "iyzico") === "order.placed", "card");
  assert(f("order.placed", "bank_transfer") === "order.placed" && f("order.paid", "bank_transfer") === "order.paid", "transfer");
  assert(f("order.shipped", null) === "order.shipped" && f("refund.succeeded", null) === null, "others");
});

await t("field validation: required, stored secret may stay empty, pattern / options / unknown keys", () => {
  const fields = [
    { key: "user", label: "Kullanıcı", type: "text", required: true, secret: false, pattern: "^[a-z]+$" },
    { key: "pass", label: "Şifre", type: "password", required: true, secret: true },
    { key: "env", label: "Ortam", type: "select", required: true, secret: false, options: [{ value: "test", label: "T" }] },
  ];
  const e1 = integrations.validateValues(fields, { user: "", env: "prod", x: "1" }, []);
  assert(e1["values.user"] && e1["values.pass"] && e1["values.env"] && e1["values.x"], JSON.stringify(e1));
  const e2 = integrations.validateValues(fields, { user: "ABC", env: "test" }, ["pass"]);
  assert(Object.keys(e2).join() === "values.user", JSON.stringify(e2));
});

// --- adapters ----------------------------------------------------------------------------------------
const nctx = { values: { usercode: "8501112233", msgheader: "NOVA" }, secrets: { password: "p@ss" } };
await t("netgsm: Basic auth + JSON body (TR encoding, informational); 00 → job id; codes → Turkish reasons", async () => {
  const f = fakeFetch({ body: '{"code":"00","jobid":"J123","description":"queued"}' }, { body: '{"code":"40"}' }, { body: "30" });
  const c = new netgsmMod.NetgsmConnector(f);
  const r = await c.send(nctx, { to: ["5321234567"], text: "Merhaba şğü" });
  assert(r.providerRef === "J123", JSON.stringify(r));
  const req = f.calls[0]!;
  const body = JSON.parse(req.init.body);
  assert(req.url.endsWith("/sms/rest/v2/send") && req.init.headers.Authorization === `Basic ${btoa("8501112233:p@ss")}`, req.init.headers.Authorization);
  assert(body.msgheader === "NOVA" && body.encoding === "TR" && body.iysfilter === "0" && body.messages[0].no === "5321234567" && body.messages[0].msg === "Merhaba şğü", req.init.body);
  const e40 = await rejects(() => c.send(nctx, { to: ["5321234567"], text: "x" }), "integration_provider_error");
  assert(e40.message.includes("Gönderici adı"), e40.message);
  const e30 = await rejects(() => c.send(nctx, { to: ["5321234567"], text: "x" }), "integration_provider_error");
  assert(e30.message.includes("API şifresi"), e30.message);
});

const yctx = { values: { environment: "test", username: "YKTEST" }, secrets: { password: "YK<&>" } };
const booking = { cargoKey: "NVABC123", orderNumber: "NV1", pieces: 2, receiver: { name: "Ayşe & Co", phone: "+905321234567", email: "a@b.c", province: "İstanbul", district: "Kadıköy", address: "Moda <1>" } };
await t("yurtiçi book: SOAP envelope escaped on the test endpoint; success, already-booked and refusal", async () => {
  const f = fakeFetch(
    { body: soap("<outFlag>0</outFlag><outResult>Başarılı</outResult><jobId>77</jobId><shippingOrderDetailVO><cargoKey>NVABC123</cargoKey></shippingOrderDetailVO>") },
    { body: soap("<outFlag>1</outFlag><shippingOrderDetailVO><errCode>60020</errCode><errMessage>Kargo anahtarı daha önce kaydedilmiş</errMessage></shippingOrderDetailVO>") },
    { body: soap("<outFlag>1</outFlag><shippingOrderDetailVO><errCode>82500</errCode><errMessage>Alıcı telefonu hatalı</errMessage></shippingOrderDetailVO>") },
  );
  const c = new yurticiMod.YurticiConnector(f);
  const r = await c.book(yctx, booking);
  assert(r.providerRef === "77" && !r.alreadyBooked, JSON.stringify(r));
  const env = f.calls[0]!.init.body as string;
  assert(f.calls[0]!.url.startsWith("https://testws.yurticikargo.com/"), f.calls[0]!.url);
  assert(env.includes("<ship:createShipment>") && env.includes("<wsPassword>YK&lt;&amp;&gt;</wsPassword>") && env.includes("<receiverCustName>Ayşe &amp; Co</receiverCustName>")
    && env.includes("<cargoCount>2</cargoCount>") && env.includes("<receiverAddress>Moda &lt;1&gt;</receiverAddress>"), env);
  assert((await c.book(yctx, booking)).alreadyBooked, "repeat booking is not an error");
  const e = await rejects(() => c.book(yctx, booking), "integration_provider_error");
  assert(e.message.includes("Alıcı telefonu hatalı"), e.message);
});

await t("yurtiçi track: statuses mapped, docId → tracking no + https link, unknown keys dropped; live endpoint", async () => {
  const detail = (key: string, status: string, doc = "", date = "") =>
    `<shippingDeliveryDetailVO><cargoKey>${key}</cargoKey><operationStatus>${status}</operationStatus><operationMessage>m-${status}</operationMessage>`
    + `<shippingDeliveryItemDetailVO><docId>${doc}</docId><deliveryDate>${date}</deliveryDate></shippingDeliveryItemDetailVO></shippingDeliveryDetailVO>`;
  const f = fakeFetch({ body: soap(`<outFlag>0</outFlag>${detail("K1", "NOP")}${detail("K2", "IND", "900111")}${detail("K3", "DLV", "900222", "20261105")}<shippingDeliveryDetailVO><cargoKey>K4</cargoKey><errCode>1</errCode></shippingDeliveryDetailVO>`) });
  const c = new yurticiMod.YurticiConnector(f);
  const r = await c.track({ ...yctx, values: { ...yctx.values, environment: "live" } }, ["K1", "K2", "K3", "K4"]);
  assert(f.calls[0]!.url.startsWith("https://ws.yurticikargo.com/") && (f.calls[0]!.init.body.match(/<keys>/g) ?? []).length === 4, f.calls[0]!.url);
  assert(r.length === 3, JSON.stringify(r));
  assert(r[0].status === "pending" && r[0].trackingNumber === null, JSON.stringify(r[0]));
  assert(r[1].status === "in_transit" && r[1].trackingNumber === "900111" && r[1].trackingUrl?.startsWith("https://www.yurticikargo.com/"), JSON.stringify(r[1]));
  assert(r[2].status === "delivered" && r[2].occurredAt === "2026-11-05T12:00:00.000Z" && r[2].carrierStatus.startsWith("DLV"), JSON.stringify(r[2]));
});

await t("yurtiçi test: 'not found' proves the credentials, an auth error / SOAP fault disproves them", async () => {
  const c = new yurticiMod.YurticiConnector(fakeFetch(
    { body: soap("<outFlag>1</outFlag><outResult>Kayıt bulunamadı</outResult>") },
    { body: soap("<outFlag>1</outFlag><outResult>Kullanıcı adı veya şifre hatalı</outResult>") },
    { status: 500, body: soap("<S:Fault><faultstring>Invalid password</faultstring></S:Fault>") },
  ));
  await c.test(yctx);
  await rejects(() => c.test(yctx), "integration_provider_error");
  const e = await rejects(() => c.test(yctx), "integration_provider_error");
  assert(e.message.includes("reddedildi"), e.message);
});

// --- container ---------------------------------------------------------------------------------------
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
await t("catalog: every 'ready' firm has an adapter of its kind and vice versa", () => {
  const ready = d1.raw.prepare("SELECT code, kind FROM integration_providers WHERE support_status = 'ready'").all() as any[];
  const registry = connectors.defaultConnectors();
  assert(ready.length === registry.size && ready.every((p) => registry.get(p.code)?.kind === p.kind), JSON.stringify(ready));
});

const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 3)));
const clock = new FixedClock(new Date("2026-11-04T10:00:00.000Z"));
const smsSent: any[] = [];
const fakeSms = { kind: "sms", code: "netgsm", send: async (ctx: any, m: any) => { smsSent.push({ ctx, ...m }); return { providerRef: `job-${smsSent.length}` }; } };
const carrier = {
  kind: "shipping", code: "yurtici", booked: [] as any[], tracking: new Map<string, any>(), testOk: true,
  book: async (_ctx: any, b: any) => { carrier.booked.push(b); return { providerRef: "J1", alreadyBooked: false }; },
  track: async (_ctx: any, keys: string[]) => keys.flatMap((k) => (carrier.tracking.has(k) ? [{ cargoKey: k, ...carrier.tracking.get(k) }] : [])),
  test: async () => { if (!carrier.testOk) throw new Error("nope"); },
};
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
platform.registerPlatform(root);
secrets.registerSecrets(root);
audit.registerAudit(root);
outbox.registerOutbox(root);
settings.registerSettings(root);
integrations.registerIntegrations(root);
shipping.registerShipping(root);
notifications.registerNotifications();
root.singleton(integrations.ConnectorRegistryToken, () => new Map<string, any>([["netgsm", fakeSms], ["yurtici", carrier]]));
const scope = () => root.createScope().provide(EnvToken, { DB: d1, SESSION_SECRET: "s3cret", SECRETS_MASTER_KEY: MASTER, PUBLIC_SITE_URL: "https://nova.test" });
const resolve = (tok: any): any => scope().resolve(tok);
const one = <T>(sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as T;
const count = (sql: string, ...p: unknown[]) => Number((d1.raw.prepare(sql).get(...p) as any).n);
const actor = { userId: "u_admin", requestId: "req-prov" };
const page = (kind: string) => resolve(integrations.GetIntegrationPageToken).execute(kind);
const save = (kind: string, input: any) => resolve(integrations.SaveIntegrationToken).execute(kind, input, actor);
const tick = () => clock.advanceMinutes(1);
d1.raw.exec("DELETE FROM outbox_events;");

await t("page: ready firms first with their fields; firms without adapter listed as planned without fields", async () => {
  const p = await page("sms");
  assert(p.providers[0].code === "netgsm" && p.providers[0].status === "ready" && p.providers[0].fields.length === 3, JSON.stringify(p.providers[0]));
  assert(p.providers.slice(1).every((x: any) => x.status === "planned" && x.fields.length === 0) && p.current === null, "planned");
  const s = await page("shipping");
  assert(s.current?.providerCode === "demo_cargo" && s.providers.some((x: any) => x.code === "aras" && x.status === "planned"), JSON.stringify(s.current));
});

await t("save: a firm without adapter → 'yazılım firmanıza bilgi verin'; unknown / wrong-kind firm → not found", async () => {
  const e = await rejects(() => save("shipping", { providerCode: "aras", values: {}, expectedUpdatedAt: null }), "provider_not_integrated");
  assert(e.message.includes("Aras Kargo") && e.message.includes("yazılım firmanıza"), e.message);
  await rejects(() => save("sms", { providerCode: "yurtici", values: {}, expectedUpdatedAt: null }), "provider_not_found");
  await rejects(() => save("sms", { providerCode: "nope", values: {}, expectedUpdatedAt: null }), "provider_not_found");
});

let smsUpdatedAt = "";
await t("save netgsm: missing secret refused; then sealed, values kept, defaults merged, audit without the secret", async () => {
  const e = await rejects(() => save("sms", { providerCode: "netgsm", values: { usercode: "8501112233", msgheader: "NOVA" }, expectedUpdatedAt: null }), "validation_error");
  assert(e.fieldErrors["values.password"], JSON.stringify(e.fieldErrors));
  const v = await save("sms", { providerCode: "netgsm", values: { usercode: "8501112233", msgheader: "NOVA", password: "Gizli-Sifre-99" }, events: { "order.paid": { enabled: true, template: "{{siparis_no}} ödendi" } }, expectedUpdatedAt: null });
  assert(v.current.providerCode === "netgsm" && v.current.secretsSet.join() === "password" && !("password" in v.current.values), JSON.stringify(v.current));
  assert(v.current.settings.events["order.paid"].enabled && v.current.settings.events["order.shipped"].enabled, "events merged with defaults");
  const raw = one<any>("SELECT public_config_json FROM integrations WHERE kind = 'sms'");
  assert(!raw.public_config_json.includes("Gizli") && count("SELECT count(*) AS n FROM integration_secrets s JOIN integrations i ON i.id = s.integration_id WHERE i.kind = 'sms' AND s.ciphertext NOT LIKE '%Gizli%'") === 1, "sealed");
  const log = one<any>("SELECT diff_redacted_json FROM audit_logs WHERE action = 'integration.create' ORDER BY rowid DESC LIMIT 1");
  assert(log && !log.diff_redacted_json.includes("Gizli") && log.diff_redacted_json.includes("netgsm"), log?.diff_redacted_json);
  smsUpdatedAt = v.current.updatedAt;
});

await t("update: empty secret keeps the stored one; stale edit → 409", async () => {
  tick();
  await rejects(() => save("sms", { providerCode: "netgsm", values: { usercode: "x1", msgheader: "NOVA" }, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }), "integration_changed");
  const v = await save("sms", { providerCode: "netgsm", values: { usercode: "8509998877", msgheader: "NOVA2" }, expectedUpdatedAt: smsUpdatedAt });
  assert(v.current.values.usercode === "8509998877" && v.current.secretsSet.includes("password"), JSON.stringify(v.current));
  const active = await scope().resolve(integrations.IntegrationRuntimeToken).sms();
  assert(active.ctx.secrets.password === "Gizli-Sifre-99" && active.ctx.values.msgheader === "NOVA2", JSON.stringify(active.ctx.values));
});

await t("shipping: choosing Yurtiçi replaces the demo carrier — one integration per kind", async () => {
  const cur = (await page("shipping")).current;
  const v = await save("shipping", { providerCode: "yurtici", values: { environment: "test", username: "YKTEST", password: "YK" }, expectedUpdatedAt: cur.updatedAt });
  assert(v.current.providerCode === "yurtici" && v.current.values.environment === "test", JSON.stringify(v.current));
  assert(count("SELECT count(*) AS n FROM integrations WHERE kind = 'shipping'") === 1, "old carrier removed");
});

await t("test: SMS to the given phone with the shop name; bad phone refused; carrier credential check", async () => {
  const r = await resolve(integrations.TestIntegrationToken).execute("sms", { phone: "0532 123 45 67" });
  assert(r.to === "05321234567" && smsSent.at(-1).to[0] === "5321234567" && smsSent.at(-1).text.includes("test"), JSON.stringify(smsSent.at(-1)));
  await rejects(() => resolve(integrations.TestIntegrationToken).execute("sms", { phone: "123" }), "validation_error");
  await resolve(integrations.TestIntegrationToken).execute("shipping", {});
});

const process_ = () => resolve(outbox.ProcessOutboxToken).execute(50);
const addEvent = (type: string, payload: object, key: string) =>
  d1.raw.prepare("INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', 'ord_demo_1', ?, ?, ?)")
    .run(crypto.randomUUID(), type, JSON.stringify(payload), key);

await t("outbox order.shipped: parcel booked at the carrier once, customer SMS with tracking; disabled events skipped", async () => {
  d1.raw.exec("INSERT INTO shipments (id, order_id, shipping_method_id, status) VALUES ('sh_new', 'ord_demo_1', 'sm_std', 'shipped')");
  const before = smsSent.length;
  addEvent("order.shipped", { shipmentId: "sh_new", trackingNumber: null }, "t:shipped");
  addEvent("order.delivered", {}, "t:delivered"); // off by default
  const s = await process_();
  assert(s.done === 1 && s.skipped === 1 && s.dead === 0, JSON.stringify(s));
  const b = carrier.booked.at(-1);
  assert(b.cargoKey === shipping.cargoKeyOf("sh_new") && b.orderNumber === "NOVA-2026-0001" && b.receiver.district === "Kadikoy" && b.pieces === 0, JSON.stringify(b));
  assert(one<any>("SELECT status FROM carrier_shipments WHERE shipment_id = 'sh_new'").status === "booked", "booking row");
  const msg = smsSent[before];
  assert(smsSent.length === before + 1 && msg.to[0] === "5551110002" && msg.text.includes("NOVA-2026-0001") && !msg.text.includes("{{"), JSON.stringify(msg));
  assert(await resolve(shipping.BookShipmentToken).execute("sh_new").then((r: any) => r.skipped === "already_booked"), "rebooking skipped");
});

await t("sync: tracking number stored once (+ SMS event), delivery applied, parcel closed, then nothing to poll", async () => {
  const key = shipping.cargoKeyOf("sh_new");
  carrier.tracking.set(key, { trackingNumber: "900111", trackingUrl: "https://kargo.example/900111", status: "in_transit", carrierStatus: "IND", occurredAt: null });
  let r = await resolve(shipping.SyncCarrierTrackingToken).execute();
  assert(r.provider === "yurtici" && r.checked === 1 && r.trackingAssigned === 1 && r.applied === 1 && r.closed === 0, JSON.stringify(r));
  assert(one<any>("SELECT tracking_number, status FROM shipments WHERE id = 'sh_new'").tracking_number === "900111", "tracking stored");
  assert(count("SELECT count(*) AS n FROM outbox_events WHERE event_type = 'shipment.tracking_assigned'") === 1, "sms event queued");
  r = await resolve(shipping.SyncCarrierTrackingToken).execute();
  assert(r.trackingAssigned === 0 && r.applied === 0, `repeat is a no-op ${JSON.stringify(r)}`);
  carrier.tracking.set(key, { trackingNumber: "900111", trackingUrl: null, status: "delivered", carrierStatus: "DLV", occurredAt: "2026-11-05T12:00:00.000Z" });
  r = await resolve(shipping.SyncCarrierTrackingToken).execute();
  assert(r.applied === 1 && r.closed === 1, JSON.stringify(r));
  assert(one<any>("SELECT status FROM shipments WHERE id = 'sh_new'").status === "delivered" && one<any>("SELECT status FROM carrier_shipments WHERE shipment_id = 'sh_new'").status === "closed", "closed");
  r = await resolve(shipping.SyncCarrierTrackingToken).execute();
  assert(r.checked === 0, "closed parcels are not polled");
  const before = smsSent.length;
  await process_();
  assert(smsSent.length === before + 1 && smsSent.at(-1).text.includes("900111"), JSON.stringify(smsSent.at(-1)));
});

await t("failures: refused booking recorded and retried by the outbox; remove → shipments manual, SMS skipped", async () => {
  d1.raw.exec("INSERT INTO shipments (id, order_id, shipping_method_id, status) VALUES ('sh_bad', 'ord_demo_1', 'sm_std', 'shipped')");
  const realBook = carrier.book;
  carrier.book = async () => { throw new Error("Alıcı telefonu hatalı"); };
  await rejects(() => resolve(shipping.BookShipmentToken).execute("sh_bad").catch((e: any) => { throw Object.assign(e, { code: "boom" }); }), "boom");
  const row = one<any>("SELECT status, last_error FROM carrier_shipments WHERE shipment_id = 'sh_bad'");
  assert(row.status === "failed" && row.last_error.includes("telefonu"), JSON.stringify(row));
  carrier.book = realBook;
  assert((await resolve(shipping.BookShipmentToken).execute("sh_bad")).cargoKey, "retry books");

  for (const kind of ["sms", "shipping"]) await resolve(integrations.RemoveIntegrationToken).execute(kind, (await page(kind)).current.updatedAt, actor);
  assert(count("SELECT count(*) AS n FROM integration_secrets WHERE integration_id IS NOT NULL AND integration_id NOT IN (SELECT id FROM integrations)") === 0, "secrets cascade");
  d1.raw.exec("INSERT INTO shipments (id, order_id, shipping_method_id, status) VALUES ('sh_man', 'ord_demo_1', 'sm_std', 'shipped')");
  assert((await resolve(shipping.BookShipmentToken).execute("sh_man")).provider === "manual", "manual");
  addEvent("order.cancelled", {}, "t:cancel");
  const before = smsSent.length;
  const s = await process_();
  assert(s.skipped >= 1 && smsSent.length === before, JSON.stringify(s));
  assert(count("SELECT count(*) AS n FROM audit_logs WHERE action = 'integration.delete'") === 2, "removal audited");
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

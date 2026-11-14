// Live support (Canlı destek): module switch, member conversation lifecycle (seq, counters, idempotent retries, one open
// conversation), staff reply / read / close / reopen, panel notification, ownership, in-process hub fan-out + presence
// + backlog guard, and the GraphQL subscription over SSE (auth, operation checks, streamed frames) — real use cases on
// node:sqlite (schema + seed) through the DI container.
// Run: npm run test:support
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const notifications = await import(`${ROOT}/src/modules/notifications/index.ts`);
const outbox = await import(`${ROOT}/src/modules/outbox/index.ts`);
const support = await import(`${ROOT}/src/modules/support/index.ts`);
const { InProcessSupportHub } = await import(`${ROOT}/src/modules/support/infrastructure/in-process-hub.ts`);
const realtime = await import(`${ROOT}/src/server/graphql/realtime.ts`);
const { Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, FixedClock, CryptoIdGenerator, JsonLogger } = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string) {
  try { await fn(); } catch (e: any) { assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`); return e; }
  throw new Error(`expected ${code}, nothing thrown`);
}
const json = (v: unknown) => JSON.stringify(v);

const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const clock = new FixedClock(new Date("2026-11-14T10:00:00.000Z"));
const hub = new InProcessSupportHub();
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
outbox.registerOutbox(root);
notifications.registerPanelNotifications(root);
support.registerSupport(root);
root.singleton(support.SupportHubToken, () => hub); // isolated from the process-wide hub
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1 }).resolve(tok);
const q1 = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const n = (sql: string, ...p: unknown[]) => Number(q1(sql, ...p).n);

const [alice, bob] = (d1.raw.prepare("SELECT user_id FROM customer_profiles ORDER BY user_id LIMIT 2").all() as any[]).map((r) => r.user_id as string);
const as = (userId: string) => ({ userId, requestId: `req-${userId}` });
const admin = as("u_admin");
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Collects hub events of some channels until stopped. */
function listen(channels: string[]) {
  const ctrl = new AbortController();
  const events: any[] = [];
  const it = hub.subscribe(channels, ctrl.signal);
  const done = (async () => { for await (const e of it) events.push(e); })();
  return { events, stop: async () => { ctrl.abort(); await done; } };
}
const settingsNow = () => resolve(support.GetSupportSettingsToken).execute();
const setEnabled = async (enabled: boolean) => {
  const s = await settingsNow();
  return resolve(support.UpdateSupportSettingsToken).execute({ ...s, enabled, expectedUpdatedAt: s.updatedAt }, admin);
};
let convId = "";

await t("module is off by default: no conversation can start; switching it on is audited, a stale form gets 409", async () => {
  assert(alice && bob && alice !== bob, "seed needs two customers");
  assert((await resolve(support.GetPublicSupportConfigToken).execute()).enabled === false, "off by default");
  await rejects(() => resolve(support.SendCustomerMessageToken).execute({ body: "Merhaba", clientId: "client-off-1" }, as(alice)), "support_disabled");
  const stale = (await settingsNow()).updatedAt;
  clock.advanceMinutes(1);
  const on = await setEnabled(true);
  assert(on.enabled, "enabled");
  assert(n("SELECT count(*) n FROM audit_logs WHERE action = 'support_settings.update'") === 1, "audited");
  await rejects(() => resolve(support.UpdateSupportSettingsToken).execute({ ...on, enabled: false, expectedUpdatedAt: stale }, admin), "support_settings_changed");
});

await t("first message opens a conversation (seq 1, staff unread 1, page path), raises the panel notification and reaches both channels", async () => {
  const staff = listen([support.STAFF_CHANNEL]);
  const mine = listen([support.customerChannel(alice)]);
  const m = await resolve(support.SendCustomerMessageToken).execute({ body: "  Siparişim   nerede?\n\n\n\nNo: 123 ", clientId: "client-a-0001", pagePath: "/urun/atlas" }, as(alice));
  await tick();
  convId = m.conversationId;
  assert(m.seq === 1 && m.sender === "customer" && m.body === "Siparişim nerede?\n\nNo: 123" && m.authorName === null, json(m));
  const c = q1("SELECT * FROM support_conversations WHERE id = ?", convId);
  assert(c.status === "open" && c.last_seq === 1 && c.staff_unread === 1 && c.customer_unread === 0 && c.page_path === "/urun/atlas" && c.last_sender === "customer", json(c));
  assert(n("SELECT count(*) n FROM admin_notifications WHERE type = 'support.waiting' AND entity_id = ?", convId) === 1, "notification");
  const se = staff.events.find((e) => e.kind === "message");
  assert(se?.conversation?.staffUnread === 1 && se.message.authorName && se.conversation.customerName, json(staff.events));
  const ce = mine.events.find((e) => e.kind === "message");
  assert(ce && !ce.conversation && ce.message.authorName === null && ce.message.clientId === "client-a-0001", json(mine.events));
  await staff.stop(); await mine.stop();
});

await t("a retried send (same clientId) returns the stored message; empty text is rejected; the next message gets seq 2", async () => {
  const again = await resolve(support.SendCustomerMessageToken).execute({ body: "Siparişim nerede?", clientId: "client-a-0001" }, as(alice));
  assert(again.seq === 1 && n("SELECT count(*) n FROM support_messages WHERE conversation_id = ?", convId) === 1, "deduped");
  await rejects(() => resolve(support.SendCustomerMessageToken).execute({ body: " \n ", clientId: "client-a-0002" }, as(alice)), "support_message_empty");
  const m2 = await resolve(support.SendCustomerMessageToken).execute({ body: "Bir de iade sorum var", clientId: "client-a-0003" }, as(alice));
  assert(m2.seq === 2 && m2.conversationId === convId, json(m2));
  assert(q1("SELECT staff_unread FROM support_conversations WHERE id = ?", convId).staff_unread === 2, "two unread");
});

await t("staff reply: assigns the agent, resets staff unread, counts for the customer, clears the notification; customer sees the first name", async () => {
  const mine = listen([support.customerChannel(alice)]);
  const r = await resolve(support.SendStaffMessageToken).execute(convId, { body: "Merhaba, hemen bakıyorum.", clientId: "client-s-0001" }, admin);
  await tick();
  assert(r.seq === 3 && r.sender === "staff", json(r));
  const c = q1("SELECT * FROM support_conversations WHERE id = ?", convId);
  assert(c.assigned_to === "u_admin" && c.staff_unread === 0 && c.staff_read_seq === 3 && c.customer_unread === 1, json(c));
  assert(n("SELECT count(*) n FROM admin_notifications WHERE type = 'support.waiting' AND entity_id = ?", convId) === 0, "dismissed");
  const staffName = q1("SELECT display_name FROM users WHERE id = 'u_admin'").display_name as string;
  const seen = mine.events.find((e) => e.kind === "message")?.message;
  assert(seen && seen.authorName === staffName.split(" ")[0], json(seen));
  await mine.stop();
  const state = await resolve(support.GetCustomerSupportToken).execute(alice);
  assert(state.conversation.customerUnread === 1 && state.messages.length === 3 && state.agentsOnline === false, json(state.conversation));
  const after = await resolve(support.GetCustomerSupportToken).execute(alice, 2);
  assert(after.messages.length === 1 && after.messages[0].seq === 3, "resync after seq 2");
});

await t("read receipts: member reads → staff sees the read seq; another member cannot touch the conversation; staff read clamps to last seq", async () => {
  const staff = listen([support.STAFF_CHANNEL]);
  await resolve(support.MarkCustomerReadToken).execute(convId, 3, as(alice));
  await tick();
  assert(q1("SELECT customer_unread u FROM support_conversations WHERE id = ?", convId).u === 0, "customer unread cleared");
  assert(staff.events.some((e) => e.kind === "read" && e.reader === "customer" && e.readSeq === 3), json(staff.events));
  await staff.stop();
  await rejects(() => resolve(support.MarkCustomerReadToken).execute(convId, 3, as(bob)), "support_conversation_not_found");
  await rejects(() => resolve(support.SignalCustomerTypingToken).execute(convId, as(bob)), "support_conversation_not_found");
  await resolve(support.SendCustomerMessageToken).execute({ body: "Teşekkürler", clientId: "client-a-0004" }, as(alice));
  const s = await resolve(support.MarkStaffReadToken).execute(convId, 999);
  assert(s.staffUnread === 0 && q1("SELECT staff_read_seq r FROM support_conversations WHERE id = ?", convId).r === 4, json(s));
});

await t("typing signals go to the other side only and are not stored", async () => {
  const staff = listen([support.STAFF_CHANNEL]);
  const mine = listen([support.customerChannel(alice)]);
  await resolve(support.SignalCustomerTypingToken).execute(convId, as(alice));
  await resolve(support.SignalStaffTypingToken).execute(convId);
  await tick();
  assert(staff.events.length === 1 && staff.events[0].typing === "customer", json(staff.events));
  assert(mine.events.length === 1 && mine.events[0].typing === "staff", json(mine.events));
  await staff.stop(); await mine.stop();
});

await t("close: audited, staff cannot write; the member's next message starts a new conversation; the old one cannot be reopened meanwhile", async () => {
  const closed = await resolve(support.SetSupportStatusToken).execute(convId, "closed", admin);
  assert(closed.status === "closed" && n("SELECT count(*) n FROM audit_logs WHERE action = 'support.close' AND entity_id = ?", convId) === 1, "closed + audit");
  await rejects(() => resolve(support.SendStaffMessageToken).execute(convId, { body: "x", clientId: "client-s-0002" }, admin), "support_conversation_closed");
  const m = await resolve(support.SendCustomerMessageToken).execute({ body: "Yeni bir sorum var", clientId: "client-a-0005" }, as(alice));
  assert(m.conversationId !== convId && m.seq === 1, json(m));
  await rejects(() => resolve(support.SetSupportStatusToken).execute(convId, "open", admin), "support_customer_has_open");
  const latest = await resolve(support.GetCustomerSupportToken).execute(alice);
  assert(latest.conversation.id === m.conversationId && latest.messages.length === 1, "latest conversation first");
  const open = await resolve(support.ListSupportInboxToken).execute("open");
  const closedList = await resolve(support.ListSupportInboxToken).execute("closed");
  assert(open.some((c: any) => c.id === m.conversationId) && closedList.some((c: any) => c.id === convId), "inbox lists");
  await resolve(support.SetSupportStatusToken).execute(m.conversationId, "closed", admin);
  const reopened = await resolve(support.SetSupportStatusToken).execute(convId, "open", admin);
  assert(reopened.status === "open", "reopen once nothing else is open");
});

await t("staff conversation pages: last page, older page by seq, resync after seq", async () => {
  for (let i = 0; i < 55; i++) await resolve(support.SendStaffMessageToken).execute(convId, { body: `Mesaj ${i}`, clientId: `client-bulk-${String(i).padStart(4, "0")}` }, admin);
  const page = await resolve(support.GetStaffConversationToken).execute(convId, {});
  assert(page.messages.length === 50 && page.hasMore && page.messages.at(-1).seq === 59, `${page.messages.length} ${page.messages.at(-1)?.seq}`);
  const older = await resolve(support.GetStaffConversationToken).execute(convId, { before: page.messages[0].seq });
  assert(older.messages.length === 9 && older.messages[0].seq === 1 && !older.hasMore, `${older.messages.length}`);
  const gap = await resolve(support.GetStaffConversationToken).execute(convId, { after: 57 });
  assert(json(gap.messages.map((m: any) => m.seq)) === "[58,59]", "after");
});

await t("hub: presence follows staff streams; a stuck subscriber is closed instead of growing without bound", async () => {
  const waiting = listen([support.PRESENCE_CHANNEL]);
  assert(!hub.agentsOnline(), "nobody online");
  const agent = listen([support.STAFF_CHANNEL]);
  assert(hub.agentsOnline(), "online while the stream is open");
  await agent.stop();
  await tick();
  assert(!hub.agentsOnline(), "offline after close");
  assert(json(waiting.events.map((e) => e.agentsOnline)) === "[true,false]", json(waiting.events));
  await waiting.stop();

  const ctrl = new AbortController();
  const stuck = hub.subscribe(["x"], ctrl.signal); // never read
  for (let i = 0; i < 300; i++) hub.publish(["x"], { kind: "presence", conversationId: null, agentsOnline: true });
  const first = await stuck.next();
  assert(first.done === true, "closed after the backlog limit");
});

await t("GraphQL subscription over SSE: frames for published events, role checks, subscription-only, invalid variables", async () => {
  const user = { id: alice, email: "a@test", displayName: "A", sessionId: "s", isStaff: false, permissions: new Set<string>() };
  const ctrl = new AbortController();
  const req = new Request("http://test/api/storefront/support/stream", { signal: ctrl.signal });
  const res = await realtime.streamSubscription(req, { query: "subscription { mySupport { kind agentsOnline message { seq body } } }" }, { audience: "storefront", user, hub });
  assert(res.headers.get("content-type")?.startsWith("text/event-stream") && res.headers.get("cache-control")?.includes("no-transform"), "sse headers");
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const first = dec.decode((await reader.read()).value);
  assert(first.includes("retry:"), first);
  hub.publish([support.customerChannel(alice)], { kind: "message", conversationId: "c", message: { id: "m", conversationId: "c", seq: 7, sender: "staff", authorName: "Ece", body: "Selam", clientId: "client-x", createdAt: "2026-11-14T10:00:00.000Z" } });
  const frame = dec.decode((await reader.read()).value);
  assert(frame.startsWith("event: next\ndata: ") && JSON.parse(frame.slice(frame.indexOf("{")).trim()).data.mySupport.message.seq === 7, frame);
  ctrl.abort();
  let rest = "";
  for (let r = await reader.read(); !r.done; r = await reader.read()) rest += dec.decode(r.value);
  assert(rest.includes("event: complete"), rest);

  await rejects(() => realtime.streamSubscription(new Request("http://test/x"), { query: "subscription { supportInbox { kind } }" }, { audience: "storefront", user, hub }), "forbidden");
  const staff = { ...user, isStaff: true, permissions: new Set(["orders.read"]) };
  await rejects(() => realtime.streamSubscription(new Request("http://test/x"), { query: "subscription { supportInbox { kind } }" }, { audience: "admin", user: staff, hub }), "forbidden");
  await rejects(() => realtime.streamSubscription(new Request("http://test/x"), { query: "{ ok }" }, { audience: "storefront", user, hub }), "graphql_invalid");
  await rejects(() => realtime.streamSubscription(new Request("http://test/x"), { query: "subscription { nope }" }, { audience: "storefront", user, hub }), "graphql_invalid");
  await rejects(async () => realtime.parseVariables("[1]"), "graphql_invalid");
  assert(!hub.agentsOnline(), "no listener leaked");
});

await t("switching the module off stops new member messages but staff can still answer open conversations", async () => {
  await setEnabled(false);
  await rejects(() => resolve(support.SendCustomerMessageToken).execute({ body: "Merhaba", clientId: "client-b-0001" }, as(bob)), "support_disabled");
  const r = await resolve(support.SendStaffMessageToken).execute(convId, { body: "Hâlâ buradayız", clientId: "client-s-9999" }, admin);
  assert(r.sender === "staff", "staff reply allowed");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Reviews + panel notifications: customer review flow (purchase rule, moderation queue, edits, auto-publish), shop
// summary / masking / votes, staff moderation (bulk, guards, audit), store reply, reviewer contact (mail outcome,
// customer-visible messages), notification visibility / read state / mutes / rules / e-mail outbox, order outbox
// handlers — real use cases on node:sqlite (schema + seed) through the DI container.
// Run: npm run test:reviews
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const settings = await import(`${ROOT}/src/modules/settings/index.ts`);
const mail = await import(`${ROOT}/src/modules/mail/index.ts`);
const outbox = await import(`${ROOT}/src/modules/outbox/index.ts`);
const notifications = await import(`${ROOT}/src/modules/notifications/index.ts`);
const reviews = await import(`${ROOT}/src/modules/reviews/index.ts`);
const {
  Container, SqlDatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger, buildConfig,
} = core;

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
const clock = new FixedClock(new Date("2026-11-08T10:00:00.000Z"));
const sent: any[] = [];
let mailMode: "sent" | "not_configured" | "throw" = "sent";
const fakeMail = {
  async send(m: any) {
    if (mailMode === "throw") throw new Error("smtp down");
    if (mailMode === "sent") sent.push(m);
    return mailMode;
  },
  async note() {},
};
const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new SqlDatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
settings.registerSettings(root);
outbox.registerOutbox(root);
notifications.registerPanelNotifications(root);
reviews.registerReviews(root);
root.singleton(mail.MailSenderToken, () => fakeMail);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, PUBLIC_SITE_URL: "https://magaza.test" }).resolve(tok);
const q1 = (sql: string, ...p: unknown[]) => d1.raw.prepare(sql).get(...p) as any;
const n = (sql: string, ...p: unknown[]) => Number(q1(sql, ...p).n);

const admin = { userId: "u_admin", requestId: "req-reviews" };
const as = (userId: string) => ({ userId, requestId: `req-${userId}` });
const moderator = { userId: "u_admin", permissions: ["reviews.moderate", "orders.read", "orders.write", "settings.write"] };
const catalogOnly = { userId: "u_admin", permissions: ["catalog.read"] };
const settingsNow = async () => resolve(reviews.GetReviewSettingsToken).execute();
const updateSettings = async (patch: Record<string, unknown>) => {
  const s = await settingsNow();
  return resolve(reviews.UpdateReviewSettingsToken).execute({ ...s, ...patch, expectedUpdatedAt: s.updatedAt }, admin);
};
let atlasReview = "";

// --- shop: summary, masking, filters --------------------------------------------------------------------
await t("product reviews: only published ones, masked names, store reply, variant label, star filter + sorting", async () => {
  const page = await resolve(reviews.GetProductReviewsToken).execute("p_knit", {});
  assert(page.summary.count === 2 && page.summary.average === 4.5 && json(page.summary.distribution) === json([0, 0, 0, 1, 1]), json(page.summary));
  const first = page.items.find((r: any) => r.id === "rev_demo_1");
  assert(first.authorName === "A*** D***" && first.verifiedPurchase && first.reply?.body.includes("teşekkür") && first.variantLabel, json(first));
  const four = await resolve(reviews.GetProductReviewsToken).execute("p_knit", { rating: 4 });
  assert(four.total === 1 && four.items[0].rating === 4, json(four));
  const low = await resolve(reviews.GetProductReviewsToken).execute("p_knit", { sort: "rating_asc" });
  assert(low.items[0].rating === 4, "rating_asc");
  const speaker = await resolve(reviews.GetProductReviewsToken).execute("p_speaker", {});
  assert(speaker.summary.count === 0 && speaker.summary.average === null && speaker.items.length === 0, "pending review not public");
  assert(reviews.maskName(null, null, "çağrı öz") === "Ç*** Ö***", reviews.maskName(null, null, "çağrı öz"));
});

// --- shop: eligibility + submit -------------------------------------------------------------------------
await t("eligibility: anonymous visitor must sign in; a customer without a paid order cannot review (purchase required)", async () => {
  const anon = await resolve(reviews.GetReviewEligibilityToken).execute("cocuklar-icin-dunya-atlasi", null);
  assert(!anon.canReview && anon.reason === "sign_in", json(anon));
  const noBuy = await resolve(reviews.GetReviewEligibilityToken).execute("cocuklar-icin-dunya-atlasi", "u_cust_3");
  assert(!noBuy.canReview && noBuy.reason === "purchase_required", json(noBuy));
  await rejects(() => resolve(reviews.SubmitReviewToken).execute("cocuklar-icin-dunya-atlasi", { rating: 4, body: "Çok güzel bir atlas." }, as("u_cust_3")), "review_purchase_required");
  await rejects(() => resolve(reviews.GetReviewEligibilityToken).execute("yok-boyle-urun", "u_cust_3"), "product_not_found");
});

await t("submit: pending + panel notifications (low rating too), minimum length, anonymity rule; text is cleaned", async () => {
  await updateSettings({ requirePurchase: false, allowAnonymous: false, minBodyLength: 15 });
  await rejects(() => resolve(reviews.SubmitReviewToken).execute("cocuklar-icin-dunya-atlasi", { rating: 2, body: "Kısa." }, as("u_cust_3")), "review_body_too_short");
  await rejects(() => resolve(reviews.SubmitReviewToken).execute("cocuklar-icin-dunya-atlasi", { rating: 2, body: "Haritalar çok küçük basılmış.", isAnonymous: true }, as("u_cust_3")), "review_anonymous_not_allowed");
  const r = await resolve(reviews.SubmitReviewToken).execute("cocuklar-icin-dunya-atlasi", { rating: 2, title: " <b>Küçük</b> ", body: "Haritalar   çok küçük <script>x</script>basılmış." }, as("u_cust_3"));
  atlasReview = r.id;
  assert(r.status === "pending" && !r.unchanged, json(r));
  const row = q1("SELECT title, body, verified_purchase, version FROM reviews WHERE id = ?", r.id);
  assert(row.title === "Küçük" && row.body === "Haritalar çok küçük xbasılmış." && row.verified_purchase === 0 && row.version === 1, json(row));
  assert(n("SELECT count(*) AS n FROM admin_notifications WHERE entity_id = ? AND type = 'review.pending'", r.id) === 1, "pending notification");
  assert(n("SELECT count(*) AS n FROM admin_notifications WHERE entity_id = ? AND type = 'review.low_rating'", r.id) === 1, "low rating notification");
  const href = q1("SELECT href FROM admin_notifications WHERE entity_id = ? AND type = 'review.pending'", r.id).href;
  assert(href === `/admin/yorumlar?yorum=${r.id}`, href);
});

await t("edit: identical text is a no-op; a changed review gets a new version and a new notification", async () => {
  const same = await resolve(reviews.SubmitReviewToken).execute("cocuklar-icin-dunya-atlasi", { rating: 2, title: "Küçük", body: "Haritalar çok küçük xbasılmış." }, as("u_cust_3"));
  assert(same.unchanged && same.id === atlasReview, json(same));
  const edited = await resolve(reviews.SubmitReviewToken).execute("cocuklar-icin-dunya-atlasi", { rating: 3, title: "Fena değil", body: "Haritalar küçük ama renkli ve anlaşılır." }, as("u_cust_3"));
  assert(edited.id === atlasReview && edited.status === "pending", json(edited));
  assert(q1("SELECT version FROM reviews WHERE id = ?", atlasReview).version === 2, "version 2");
  assert(n("SELECT count(*) AS n FROM admin_notifications WHERE entity_id = ? AND type = 'review.pending'", atlasReview) === 2, "second notification (v2)");
});

// --- panel: moderation --------------------------------------------------------------------------------
await t("moderation: reason required to reject; approve publishes, dismisses the pending notifications, audits", async () => {
  await rejects(() => resolve(reviews.ModerateReviewsToken).execute({ ids: [atlasReview], action: "reject" }, admin), "review_reason_required");
  await rejects(() => resolve(reviews.ModerateReviewsToken).execute({ ids: [atlasReview], action: "hide" }, admin), "review_action_not_allowed");
  const r = await resolve(reviews.ModerateReviewsToken).execute({ ids: [atlasReview], action: "approve", note: "Uygun" }, admin);
  assert(r.changed === 1 && r.skipped === 0, json(r));
  const row = q1("SELECT status, published_at, moderated_by, moderation_note FROM reviews WHERE id = ?", atlasReview);
  assert(row.status === "approved" && row.published_at === "2026-11-08T10:00:00.000Z", json(row));
  assert(row.moderated_by === "u_admin" && row.moderation_note === "Uygun", json(row));
  assert(n("SELECT count(*) AS n FROM admin_notifications WHERE entity_id = ? AND type = 'review.pending'", atlasReview) === 0, "pending notifications dismissed");
  assert(n("SELECT count(*) AS n FROM admin_notifications WHERE entity_id = ? AND type = 'review.low_rating'", atlasReview) === 1, "low rating kept");
  assert(n("SELECT count(*) AS n FROM audit_logs WHERE action = 'review.approve' AND entity_id = ?", atlasReview) === 1, "audit");
  const page = await resolve(reviews.GetProductReviewsToken).execute("p_atlas", {});
  assert(page.summary.count === 1 && page.items[0].authorName === "M*** Y***", json(page.items[0]));
});

await t("moderation: bulk skips reviews whose status does not allow the action; reject stores the reason; hide takes it down", async () => {
  const r = await resolve(reviews.ModerateReviewsToken).execute({ ids: ["rev_demo_4", "rev_demo_1"], action: "approve" }, admin);
  assert(r.changed === 1 && r.skipped === 1, json(r));
  const rej = await resolve(reviews.ModerateReviewsToken).execute({ ids: ["rev_demo_3"], action: "reject", reason: "irrelevant" }, admin);
  assert(rej.changed === 1 && q1("SELECT reject_reason FROM reviews WHERE id = 'rev_demo_3'").reject_reason === "irrelevant", "reason stored");
  await resolve(reviews.ModerateReviewsToken).execute({ ids: ["rev_demo_4"], action: "hide" }, admin);
  assert((await resolve(reviews.GetProductReviewsToken).execute("p_pan", {})).summary.count === 0, "hidden review leaves the shop");
  await resolve(reviews.ModerateReviewsToken).execute({ ids: ["rev_demo_4"], action: "approve" }, admin);
  const pan = await resolve(reviews.GetProductReviewsToken).execute("p_pan", {});
  assert(pan.summary.count === 1 && pan.items[0].authorName === reviews.ANONYMOUS_NAME, json(pan.items[0]));
  await rejects(() => resolve(reviews.ModerateReviewsToken).execute({ ids: ["yok"], action: "approve" }, admin), "review_not_found");
});

await t("admin list: tabs, search, star filter, stats; detail hides contact data without customers.read", async () => {
  const all = await resolve(reviews.ListReviewsToken).execute({ tab: "all", sort: "created_at", dir: "desc", page: 1, pageSize: 25 });
  assert(all.total === 6 && all.stats.counts.all === 6 && all.stats.counts.approved === 4 && all.stats.counts.rejected === 2, json(all.stats));
  const found = await resolve(reviews.ListReviewsToken).execute({ tab: "all", q: "atlas", sort: "rating", dir: "asc", page: 1, pageSize: 25 });
  assert(found.total === 1 && found.rows[0].customerName === "Mehmet Yılmaz", json(found.rows));
  const fives = await resolve(reviews.ListReviewsToken).execute({ tab: "approved", rating: 5, sort: "created_at", dir: "desc", page: 1, pageSize: 25 });
  assert(fives.total === 2, `fives ${fives.total}`);
  const hidden = await resolve(reviews.GetReviewToken).execute(atlasReview, false);
  assert(hidden.customer.email === null && hidden.customer.phone === null && hidden.customer.name === "Mehmet Yılmaz", json(hidden.customer));
  const shown = await resolve(reviews.GetReviewToken).execute(atlasReview, true);
  assert(shown.customer.email === "mehmet.yilmaz@example.com" && shown.version === 3, json(shown.customer));
});

// --- reply, contact, my reviews ------------------------------------------------------------------------
await t("store reply: shown in the shop under the review; null removes it", async () => {
  await resolve(reviews.ReplyToReviewToken).execute(atlasReview, "Geri bildiriminiz için teşekkürler, yeni baskıda haritaları büyüttük.", admin);
  let item = (await resolve(reviews.GetProductReviewsToken).execute("p_atlas", {})).items[0];
  assert(item.reply?.body.startsWith("Geri bildiriminiz"), json(item));
  await resolve(reviews.ReplyToReviewToken).execute(atlasReview, null, admin);
  item = (await resolve(reviews.GetProductReviewsToken).execute("p_atlas", {})).items[0];
  assert(item.reply === null, "reply removed");
  await resolve(reviews.ReplyToReviewToken).execute(atlasReview, "Teşekkürler!", admin);
});

await t("contact: e-mail goes to the reviewer and appears under Hesabım; phone note stays internal; mail failure is recorded", async () => {
  const r = await resolve(reviews.ContactReviewerToken).execute(atlasReview, { channel: "email", body: "Merhaba, yaşadığınız sorunu çözmek isteriz." }, admin);
  assert(r.delivery === "sent" && r.contactStatus === "contacted", json(r));
  assert(sent.length === 1 && sent[0].to === "mehmet.yilmaz@example.com" && sent[0].subject.includes("Çocuklar İçin Dünya Atlası") && sent[0].text.includes("çözmek isteriz"), json(sent[0]));
  const note = await resolve(reviews.ContactReviewerToken).execute(atlasReview, { channel: "phone", body: "Arandı, memnun.", contactStatus: "resolved" }, admin);
  assert(note.delivery === "logged" && note.contactStatus === "resolved", json(note));
  mailMode = "throw";
  const failed = await resolve(reviews.ContactReviewerToken).execute(atlasReview, { channel: "email", subject: "Tekrar", body: "Deneme" }, admin);
  assert(failed.delivery === "failed", json(failed));
  mailMode = "not_configured";
  const off = await resolve(reviews.ContactReviewerToken).execute(atlasReview, { channel: "email", subject: "Tekrar", body: "Deneme" }, admin);
  assert(off.delivery === "not_configured", json(off));
  mailMode = "sent";
  const mine = await resolve(reviews.ListMyReviewsToken).execute("u_cust_3");
  const review = mine.reviews.find((x: any) => x.id === atlasReview);
  assert(review.messages.length === 1 && review.reply?.body === "Teşekkürler!" && review.status === "approved", json(review));
  const detail = await resolve(reviews.GetReviewToken).execute(atlasReview, true);
  assert(detail.contacts.length === 4 && detail.contactStatus === "resolved", json(detail.contacts.map((c: any) => c.delivery)));
  await resolve(reviews.SetReviewContactStatusToken).execute(atlasReview, "contacted", admin);
  await rejects(() => resolve(reviews.SetReviewContactStatusToken).execute("yok", "resolved", admin), "review_not_found");
});

await t("votes: not on own review; idempotent on / off keeps the cached count", async () => {
  await rejects(() => resolve(reviews.VoteReviewToken).execute(atlasReview, true, as("u_cust_3")), "review_vote_own");
  let r = await resolve(reviews.VoteReviewToken).execute(atlasReview, true, as("u_cust_2"));
  r = await resolve(reviews.VoteReviewToken).execute(atlasReview, true, as("u_cust_2"));
  assert(r.helpfulCount === 1, json(r));
  r = await resolve(reviews.VoteReviewToken).execute(atlasReview, true, as("u_customer"));
  assert(r.helpfulCount === 2, json(r));
  r = await resolve(reviews.VoteReviewToken).execute(atlasReview, false, as("u_cust_2"));
  assert(r.helpfulCount === 1 && !r.voted, json(r));
  await rejects(() => resolve(reviews.VoteReviewToken).execute("rev_demo_5", true, as("u_customer")), "review_not_found");
});

await t("verified buyer + auto_trusted: a 5-star review without links publishes at once; a link still waits", async () => {
  d1.raw.prepare("UPDATE orders SET status = 'paid', payment_status = 'paid' WHERE id = 'ord_demo_1'").run();
  await updateSettings({ moderationMode: "auto_trusted", requirePurchase: true, blockedWords: ["sahte"] });
  const el = await resolve(reviews.GetReviewEligibilityToken).execute("yarim-balikci-yaka-triko", "u_customer");
  assert(el.canReview && el.verifiedPurchase && el.existing?.status === "approved", json(el));
  const live = await resolve(reviews.SubmitReviewToken).execute("yarim-balikci-yaka-triko", { rating: 5, body: "İkinci kez aldım, yine çok memnunum." }, as("u_customer"));
  assert(live.status === "approved", json(live));
  assert(n("SELECT count(*) AS n FROM admin_notifications WHERE entity_id = 'rev_demo_1'") === 0, "no notification for auto-published");
  const link = await resolve(reviews.SubmitReviewToken).execute("yarim-balikci-yaka-triko", { rating: 5, body: "Daha ucuzu www.baska-site.com adresinde." }, as("u_customer"));
  assert(link.status === "pending", "link → moderation");
  const blocked = reviews.publishesImmediately({ moderationMode: "auto_trusted", blockedWords: ["sahte"] }, { rating: 5, verifiedPurchase: true, text: "Ürün SAHTE çıktı" });
  assert(!blocked, "blocked word → moderation");
  assert(!reviews.publishesImmediately({ moderationMode: "manual", blockedWords: [] }, { rating: 5, verifiedPurchase: true, text: "harika" }), "manual never auto");
  const mine = await resolve(reviews.ListMyReviewsToken).execute("u_customer");
  assert(!mine.reviewable.some((p: any) => p.productId === "p_knit"), "already reviewed products are not offered");
});

await t("settings: concurrent edit → review_changed", async () => {
  const s = await settingsNow();
  await rejects(() => resolve(reviews.UpdateReviewSettingsToken).execute({ ...s, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }, admin), "review_changed");
});

// --- notifications ------------------------------------------------------------------------------------
await t("notifications: visibility follows the type permission; read / read-all / archive are per staff member", async () => {
  const list = notifications.ListNotificationsToken;
  const mine = await resolve(list).execute(moderator, { filter: "all", page: 1, pageSize: 50 });
  assert(mine.total === 3 && mine.rows.every((r: any) => r.archivedAt === null), json(mine.total));
  const none = await resolve(list).execute(catalogOnly, { filter: "all", page: 1, pageSize: 50 });
  assert(none.total === 0, `catalog-only sees ${none.total}`);
  const before = (await resolve(notifications.GetNotificationSummaryToken).execute(moderator)).unread;
  const first = mine.rows[0];
  await resolve(notifications.UpdateNotificationStateToken).markRead(moderator, [first.id], true);
  const s = await resolve(notifications.GetNotificationSummaryToken).execute(moderator);
  assert(s.unread === before - 1 && s.latest.find((r: any) => r.id === first.id)?.readAt, json(s.unread));
  await resolve(notifications.UpdateNotificationStateToken).markRead(moderator, [first.id], false);
  assert((await resolve(notifications.GetNotificationSummaryToken).execute(moderator)).unread === before, "mark unread");
  await resolve(notifications.UpdateNotificationStateToken).markRead(moderator, "all", true);
  assert((await resolve(notifications.GetNotificationSummaryToken).execute(moderator)).unread === 0, "read all");
  const other = { ...moderator, userId: "u_customer" };
  assert((await resolve(notifications.GetNotificationSummaryToken).execute(other)).unread > 0, "state is per user");
  await resolve(notifications.UpdateNotificationStateToken).archive(moderator, [first.id], true);
  const arch = await resolve(list).execute(moderator, { filter: "archived", page: 1, pageSize: 50 });
  assert(arch.total === 1 && arch.rows[0].id === first.id, json(arch));
  await resolve(notifications.UpdateNotificationStateToken).archive(catalogOnly, [first.id], false);
  assert((await resolve(list).execute(moderator, { filter: "archived", page: 1, pageSize: 50 })).total === 1, "others cannot touch it");
});

await t("notifications: personal mutes hide a type; unknown types are rejected", async () => {
  const prefs = resolve(notifications.NotificationPreferencesToken);
  await prefs.set("u_admin", ["order.placed"]);
  const r = await resolve(notifications.ListNotificationsToken).execute(moderator, { filter: "all", page: 1, pageSize: 50 });
  assert(!r.rows.some((x: any) => x.type === "order.placed"), "muted type hidden");
  await rejects(() => prefs.set("u_admin", ["no.such"]), "notification_type_unknown");
  await prefs.set("u_admin", []);
  assert(json((await prefs.get("u_admin")).muted) === "[]", "cleared");
});

await t("rules: e-mail needs recipients; in-app off stores nothing; e-mail copy goes through the outbox", async () => {
  const rules = resolve(notifications.UpdateNotificationRulesToken);
  await rejects(() => rules.execute([{ type: "order.placed", inApp: true, email: true, emailTo: [] }], admin), "notification_recipients_required");
  await rules.execute([{ type: "order.placed", inApp: false, email: true, emailTo: ["Ops@Nova.test", "ops@nova.test"] }], admin);
  const view = await resolve(notifications.GetNotificationRulesToken).execute();
  const op = view.find((r: any) => r.type === "order.placed");
  assert(!op.inApp && op.email && json(op.emailTo) === json(["ops@nova.test"]), json(op));
  assert(n("SELECT count(*) AS n FROM audit_logs WHERE action = 'notification_rule.update'") === 1, "audit");

  const before = n("SELECT count(*) AS n FROM admin_notifications");
  await resolve(notifications.RaiseNotificationToken).execute({ type: "order.placed", title: "Yeni sipariş: TEST-1", href: "/admin/siparisler/x", dedupeKey: "order.placed:test-1" });
  assert(n("SELECT count(*) AS n FROM admin_notifications") === before, "in-app off");
  assert(n("SELECT count(*) AS n FROM outbox_events WHERE event_type = 'admin_notification.email'") === 1, "mail event queued");
  sent.length = 0;
  await resolve(outbox.ProcessOutboxToken).execute(100);
  const m = sent.find((x) => x.subject.includes("TEST-1"));
  assert(m && m.to === "ops@nova.test" && m.text.includes("https://magaza.test/admin/siparisler/x"), json(sent));
  await rules.execute([{ type: "order.placed", inApp: true, email: false, emailTo: [] }], admin);
});

await t("outbox handlers: order.placed is idempotent per order; late payment raises a danger notification", async () => {
  const placed = () => n("SELECT count(*) AS n FROM admin_notifications WHERE type = 'order.placed' AND entity_id = 'ord_demo_1'");
  assert(placed() === 1, "seeded");
  d1.raw.prepare(`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES
    ('ob_t1','order','ord_demo_1','order.placed','{}','t:placed:again'),
    ('ob_t2','order','ord_demo_1','order.payment_after_cancel','{}','t:late:1')`).run();
  await resolve(outbox.ProcessOutboxToken).execute(100);
  assert(placed() === 1, "no duplicate");
  const late = q1("SELECT severity, title, permission FROM admin_notifications WHERE type = 'payment.late'");
  assert(late?.severity === "danger" && late.title.includes("NOVA-2026-0001") && late.permission === "orders.write", json(late));
  assert(q1("SELECT status FROM outbox_events WHERE id = 'ob_t2'").status === "done", "event done");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

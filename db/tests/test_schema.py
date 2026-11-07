"""Schema tests for db/schema.sql + db/seed.sql.

Runs against a local in-memory SQLite (same engine family as Cloudflare D1).
Usage:  python3 db/tests/test_schema.py
"""
import sqlite3
import sys
import threading
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = (ROOT / "schema.sql").read_text(encoding="utf-8")
SEED = (ROOT / "seed.sql").read_text(encoding="utf-8")

results: list[tuple[str, bool, str]] = []


def new_db(path: str = ":memory:") -> sqlite3.Connection:
    c = sqlite3.connect(path, isolation_level=None)
    c.execute("PRAGMA foreign_keys = ON")  # D1 has this on by default
    c.executescript(SCHEMA)
    c.executescript(SEED)
    return c


def test(name):
    def deco(fn):
        try:
            fn()
            results.append((name, True, ""))
        except Exception as e:  # noqa: BLE001
            results.append((name, False, repr(e)))
        return fn
    return deco


def expect_error(conn, sql, params=(), contains=""):
    try:
        conn.execute(sql, params)
    except sqlite3.DatabaseError as e:
        if contains and contains not in str(e):
            raise AssertionError(f"expected '{contains}', got '{e}'")
        return
    raise AssertionError(f"expected error for: {sql}")


def setup_checkout(c, cid="co_1", cart="cart_1"):
    c.execute("INSERT INTO carts (id, guest_token_hash) VALUES (?, ?)", (cart, "g_" + cart))
    c.execute(
        "INSERT INTO checkout_sessions (id, cart_id, quote_hash, cart_version, total_minor, expires_at, idempotency_key)"
        " VALUES (?, ?, 'h', 0, 100, '2099-01-01T00:00:00.000Z', ?)", (cid, cart, "idem_" + cid))


# --- structure ---------------------------------------------------------------
@test("01 126 tables exist")
def _():
    c = new_db()
    n = c.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
    assert n == 126, n


@test("02 all tables are STRICT")
def _():
    c = new_db()
    rows = c.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    bad = [n for n, s in rows if not s.rstrip().endswith("STRICT")]
    assert not bad, bad


@test("03 schema script is re-runnable")
def _():
    c = new_db()
    c.executescript(SCHEMA)


@test("04 integrity_check ok and foreign_key_check empty after seed")
def _():
    c = new_db()
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []


# --- identity ----------------------------------------------------------------
@test("05 email must be normalized")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO users (id, email_normalized, display_name) VALUES ('u','A@B.com','x')")


@test("06 password hash must be bcrypt-formatted")
def _():
    c = new_db()
    c.execute("INSERT INTO users (id, email_normalized, display_name) VALUES ('u','a@b.com','x')")
    expect_error(c, "INSERT INTO auth_credentials (user_id, password_hash) VALUES ('u','plain')")
    c.execute("INSERT INTO auth_credentials (user_id, password_hash) VALUES ('u','$2b$12$abcdefghijklmnopqrstuv')")


@test("07 cart owner is user XOR guest")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO carts (id) VALUES ('c')")
    c.execute("INSERT INTO users (id, email_normalized, display_name) VALUES ('u','a@b.com','x')")
    expect_error(c, "INSERT INTO carts (id, user_id, guest_token_hash) VALUES ('c','u','g')")


# --- catalog -----------------------------------------------------------------
@test("08 only one default variant per product")
def _():
    c = new_db()
    expect_error(c, "UPDATE product_variants SET is_default = 1 WHERE id = 'v_knit_bk_l'", contains="UNIQUE")


@test("09 only one primary category per product")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO product_categories VALUES ('p_knit','c_moda',1)", contains="UNIQUE")


@test("10 category cycle is rejected")
def _():
    c = new_db()
    expect_error(c, "UPDATE categories SET parent_id = 'c_erkek_kazak' WHERE id = 'c_moda'", contains="category_cycle")


@test("11 category self-parent rejected")
def _():
    c = new_db()
    expect_error(c, "UPDATE categories SET parent_id = id WHERE id = 'c_moda'")


@test("12 attribute value must match data type")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO product_attribute_values (id, product_id, attribute_id, number_value) VALUES ('x','p_knit','a_material',3.0)",
                 contains="attribute_type_mismatch")


@test("13 attribute value: exactly one typed column")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO product_attribute_values (id, product_id, attribute_id, text_value, number_value) VALUES ('x','p_knit','a_material','a',1.0)")


@test("14 option must belong to the attribute (composite FK)")
def _():
    c = new_db()
    c.execute("DELETE FROM variant_options WHERE variant_id='v_knit_bk_m' AND attribute_id='a_color'")
    expect_error(c, "INSERT INTO variant_options VALUES ('v_knit_bk_m','a_color','o_m')", contains="FOREIGN KEY")


@test("15 variant option axis must be assigned to product")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO variant_options VALUES ('v_bed','a_color','o_black')", contains="variant_axis_not_assigned")


@test("16 compare_at must exceed price")
def _():
    c = new_db()
    expect_error(c, "UPDATE variant_prices SET compare_at_minor = 1 WHERE variant_id = 'v_bed'")


@test("17 variant axis must be select type")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO attribute_definitions (id, code, label, data_type, is_variant_axis) VALUES ('x','x','x','text',1)")


@test("18 navigation parent must be in the same menu")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO navigation_items (id, menu_id, parent_id, label) VALUES ('x','nav_header','nf_1','x')",
                 contains="navigation_parent_other_menu")


@test("19 only one active hero slider section")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO home_sections (id, title, section_type, slider_id) VALUES ('x','x','hero_slider','sl_home')", contains="UNIQUE")


# --- inventory ---------------------------------------------------------------
@test("20 reservation increases reserved")
def _():
    c = new_db(); setup_checkout(c)
    c.execute("INSERT INTO stock_reservations (id, checkout_id, variant_id, warehouse_id, quantity, expires_at, idempotency_key) VALUES ('r1','co_1','v_bed','wh_main',3,'2099','k1')")
    assert c.execute("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id='v_bed'").fetchone() == (40, 3)


@test("21 reservation beyond available stock is rejected")
def _():
    c = new_db(); setup_checkout(c)
    expect_error(c, "INSERT INTO stock_reservations (id, checkout_id, variant_id, warehouse_id, quantity, expires_at, idempotency_key) VALUES ('r1','co_1','v_knit_nv_m','wh_main',2,'2099','k1')",
                 contains="insufficient_stock")
    assert c.execute("SELECT reserved FROM inventory_balances WHERE variant_id='v_knit_nv_m'").fetchone()[0] == 0


@test("22 commit decreases on_hand and reserved")
def _():
    c = new_db(); setup_checkout(c)
    c.execute("INSERT INTO stock_reservations (id, checkout_id, variant_id, warehouse_id, quantity, expires_at, idempotency_key) VALUES ('r1','co_1','v_bed','wh_main',3,'2099','k1')")
    c.execute("UPDATE stock_reservations SET status='committed' WHERE id='r1'")
    assert c.execute("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id='v_bed'").fetchone() == (37, 0)


@test("23 release only decreases reserved")
def _():
    c = new_db(); setup_checkout(c)
    c.execute("INSERT INTO stock_reservations (id, checkout_id, variant_id, warehouse_id, quantity, expires_at, idempotency_key) VALUES ('r1','co_1','v_bed','wh_main',3,'2099','k1')")
    c.execute("UPDATE stock_reservations SET status='expired' WHERE id='r1'")
    assert c.execute("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id='v_bed'").fetchone() == (40, 0)


@test("24 terminal reservation cannot change")
def _():
    c = new_db(); setup_checkout(c)
    c.execute("INSERT INTO stock_reservations (id, checkout_id, variant_id, warehouse_id, quantity, expires_at, idempotency_key) VALUES ('r1','co_1','v_bed','wh_main',3,'2099','k1')")
    c.execute("UPDATE stock_reservations SET status='released' WHERE id='r1'")
    expect_error(c, "UPDATE stock_reservations SET status='committed' WHERE id='r1'", contains="reservation_terminal")


@test("25 reservation quantity immutable")
def _():
    c = new_db(); setup_checkout(c)
    c.execute("INSERT INTO stock_reservations (id, checkout_id, variant_id, warehouse_id, quantity, expires_at, idempotency_key) VALUES ('r1','co_1','v_bed','wh_main',3,'2099','k1')")
    expect_error(c, "UPDATE stock_reservations SET quantity=1 WHERE id='r1'", contains="reservation_immutable_fields")


@test("26 last unit race: two connections, only one wins")
def _():
    fd, path = tempfile.mkstemp(suffix=".db"); os.close(fd)
    try:
        c = new_db(path); setup_checkout(c, "co_a", "cart_a"); setup_checkout(c, "co_b", "cart_b"); c.close()
        outcomes = []
        barrier = threading.Barrier(2)

        def worker(co):
            conn = sqlite3.connect(path, isolation_level=None, timeout=5)
            conn.execute("PRAGMA foreign_keys = ON")
            barrier.wait()
            try:
                conn.execute("INSERT INTO stock_reservations (id, checkout_id, variant_id, warehouse_id, quantity, expires_at, idempotency_key)"
                             " VALUES (?, ?, 'v_knit_nv_m','wh_main',1,'2099',?)", ("r_" + co, co, "k_" + co))
                outcomes.append("ok")
            except sqlite3.DatabaseError:
                outcomes.append("fail")
            finally:
                conn.close()

        ts = [threading.Thread(target=worker, args=(x,)) for x in ("co_a", "co_b")]
        [t.start() for t in ts]; [t.join() for t in ts]
        assert sorted(outcomes) == ["fail", "ok"], outcomes
        c = sqlite3.connect(path)
        assert c.execute("SELECT on_hand, reserved FROM inventory_balances WHERE variant_id='v_knit_nv_m'").fetchone() == (1, 1)
        c.close()
    finally:
        os.remove(path)


@test("27 inventory movements are append-only")
def _():
    c = new_db()
    c.execute("INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, idempotency_key) VALUES ('mv','v_bed','wh_main','receipt',5,'mv1')")
    expect_error(c, "UPDATE inventory_movements SET reason='x'", contains="append_only")
    expect_error(c, "DELETE FROM inventory_movements", contains="append_only")


# --- campaigns ---------------------------------------------------------------
@test("28 buy_x_pay_y requires X > Y")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO campaigns (id, name, kind, buy_quantity, pay_quantity, starts_at) VALUES ('x','x','buy_x_pay_y',2,2,'2026')")


@test("29 selected campaign cannot activate without targets")
def _():
    c = new_db()
    c.execute("INSERT INTO campaigns (id, name, kind, percentage_bps, target_mode, starts_at) VALUES ('x','x','percentage',1000,'selected','2026')")
    expect_error(c, "UPDATE campaigns SET is_active = 1 WHERE id = 'x'", contains="campaign_without_targets")
    c.execute("UPDATE campaigns SET is_active = 1 WHERE id = 'cmp_3al2'")


@test("30 campaign capacity cannot be exceeded")
def _():
    c = new_db(); setup_checkout(c, "co_a", "cart_a"); setup_checkout(c, "co_b", "cart_b")
    c.execute("INSERT INTO campaigns (id, name, kind, amount_minor, starts_at, capacity_units) VALUES ('cap','x','fixed_price',49900,'2026',2)")
    c.execute("INSERT INTO campaign_allocations (id, campaign_id, checkout_id, units, discount_minor, expires_at) VALUES ('a1','cap','co_a',2,100,'2099')")
    expect_error(c, "INSERT INTO campaign_allocations (id, campaign_id, checkout_id, units, discount_minor, expires_at) VALUES ('a2','cap','co_b',1,100,'2099')",
                 contains="campaign_capacity_exceeded")


@test("31 coupon per-customer limit")
def _():
    c = new_db(); setup_checkout(c, "co_a", "cart_a"); setup_checkout(c, "co_b", "cart_b")
    c.execute("INSERT INTO campaigns (id, name, kind, percentage_bps, starts_at, requires_coupon) VALUES ('k','x','percentage',1000,'2026',1)")
    c.execute("INSERT INTO coupons (id, campaign_id, code_normalized, per_customer_limit) VALUES ('cp','k','HOSGELDIN',1)")
    c.execute("INSERT INTO coupon_redemptions (id, coupon_id, checkout_id, customer_key_hash, expires_at) VALUES ('r1','cp','co_a','cust1','2099')")
    expect_error(c, "INSERT INTO coupon_redemptions (id, coupon_id, checkout_id, customer_key_hash, expires_at) VALUES ('r2','cp','co_b','cust1','2099')",
                 contains="coupon_customer_limit_reached")


@test("32 coupon code must be normalized upper-case")
def _():
    c = new_db()
    c.execute("INSERT INTO campaigns (id, name, kind, percentage_bps, starts_at) VALUES ('k','x','percentage',1000,'2026')")
    expect_error(c, "INSERT INTO coupons (id, campaign_id, code_normalized) VALUES ('cp','k','hosgeldin')")


# --- orders & payments -------------------------------------------------------
def make_order(c):
    setup_checkout(c)
    c.execute("INSERT INTO orders (id, order_number, checkout_id, customer_email, subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, placed_at)"
              " VALUES ('o1','NV1','co_1','a@b.com',10000,1000,500,800,9500,'2026')")


@test("33 order total equation enforced")
def _():
    c = new_db(); setup_checkout(c)
    expect_error(c, "INSERT INTO orders (id, order_number, checkout_id, customer_email, subtotal_minor, discount_minor, shipping_minor, total_minor, placed_at)"
                    " VALUES ('o1','NV1','co_1','a@b.com',10000,0,0,1,'2026')")


@test("34 order line math enforced and snapshot immutable")
def _():
    c = new_db(); make_order(c)
    expect_error(c, "INSERT INTO order_items (id, order_id, variant_id, sku_snapshot, product_name_snapshot, quantity, unit_price_minor, subtotal_minor, tax_rate_bps, total_minor)"
                    " VALUES ('i1','o1','v_bed','s','n',2,5000,9000,1000,9000)")
    c.execute("INSERT INTO order_items (id, order_id, variant_id, sku_snapshot, product_name_snapshot, quantity, unit_price_minor, subtotal_minor, discount_minor, tax_rate_bps, tax_minor, total_minor)"
              " VALUES ('i1','o1','v_bed','s','n',2,5000,10000,1000,1000,818,9000)")
    expect_error(c, "UPDATE order_items SET quantity = 3 WHERE id='i1'", contains="order_snapshot_immutable")
    expect_error(c, "UPDATE orders SET total_minor = 1 WHERE id='o1'", contains="order_snapshot_immutable")
    c.execute("UPDATE orders SET status = 'paid', payment_status='paid' WHERE id='o1'")


@test("35 duplicate webhook event rejected")
def _():
    c = new_db()
    c.execute("INSERT INTO payment_events (id, provider, provider_event_id, event_type, payload_sha256, signature_valid) VALUES ('e1','iyzico','evt','x','h',1)")
    expect_error(c, "INSERT INTO payment_events (id, provider, provider_event_id, event_type, payload_sha256, signature_valid) VALUES ('e2','iyzico','evt','x','h',1)", contains="UNIQUE")


@test("36 bank transfer cannot be matched with wrong amount or without approver")
def _():
    c = new_db(); make_order(c)
    c.execute("UPDATE payment_configs SET is_active = 1 WHERE id='pc_bank'")
    c.execute("INSERT INTO bank_accounts (id, payment_config_id, bank_name, account_holder, iban_normalized) VALUES ('ba','pc_bank','Test','Nova','TR000000000000000000000000')")
    c.execute("INSERT INTO payments (id, order_id, payment_config_id, provider, conversation_id, idempotency_key, amount_minor) VALUES ('pay','o1','pc_bank','bank_transfer','conv','ik',9500)")
    c.execute("INSERT INTO bank_transfers (id, payment_id, bank_account_id, reference_code, expected_minor, expires_at) VALUES ('bt','pay','ba','NV-REF',9500,'2099')")
    expect_error(c, "UPDATE bank_transfers SET status='matched', received_minor=9000, matched_at='2026' WHERE id='bt'")


@test("37 paid payment cannot go back to pending")
def _():
    c = new_db(); make_order(c)
    c.execute("INSERT INTO payments (id, order_id, payment_config_id, provider, conversation_id, idempotency_key, amount_minor, status, paid_at) VALUES ('pay','o1','pc_iyzico_sbx','iyzico','conv','ik',9500,'paid','2026')")
    expect_error(c, "UPDATE payments SET status='pending' WHERE id='pay'", contains="payment_paid_terminal")


@test("38 shipment item must belong to same order")
def _():
    c = new_db(); make_order(c)
    c.execute("INSERT INTO order_items (id, order_id, variant_id, sku_snapshot, product_name_snapshot, quantity, unit_price_minor, subtotal_minor, discount_minor, tax_rate_bps, tax_minor, total_minor)"
              " VALUES ('i1','o1','v_bed','s','n',2,5000,10000,1000,1000,818,9000)")
    setup_checkout(c, "co_2", "cart_2")
    c.execute("INSERT INTO orders (id, order_number, checkout_id, customer_email, subtotal_minor, total_minor, placed_at) VALUES ('o2','NV2','co_2','a@b.com',100,100,'2026')")
    c.execute("INSERT INTO shipments (id, order_id, shipping_method_id) VALUES ('sh2','o2','sm_std')")
    expect_error(c, "INSERT INTO shipment_items (shipment_id, order_id, order_item_id, quantity) VALUES ('sh2','o2','i1',1)", contains="FOREIGN KEY")


@test("39 audit log is append-only")
def _():
    c = new_db()
    c.execute("INSERT INTO audit_logs (id, action, entity_type) VALUES ('a','x','y')")
    expect_error(c, "DELETE FROM audit_logs", contains="append_only")


@test("40 secret belongs to exactly one owner")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO integration_secrets (id, secret_name, ciphertext, nonce, auth_tag, key_version) VALUES ('s','k','c','n','t','v1')")


@test("41 batch guard: whole batch rolls back when the guarded update lost the race")
def _():
    c = new_db()
    c.execute("INSERT INTO audit_logs (id, action, entity_type) VALUES ('g0','x','y')")
    # expected change happened → guard row is skipped, later statements commit
    c.execute("BEGIN")
    c.execute("UPDATE site_settings SET updated_at = updated_at WHERE key = 'site.name'")
    c.execute("INSERT INTO batch_guards (guard, actual, expected) VALUES (3, changes(), 1)")
    c.execute("INSERT INTO audit_logs (id, action, entity_type) VALUES ('g1','x','y')")
    c.execute("COMMIT")
    assert c.execute("SELECT count(*) FROM batch_guards").fetchone()[0] == 0
    assert c.execute("SELECT count(*) FROM audit_logs WHERE id = 'g1'").fetchone()[0] == 1
    # nothing changed → guard aborts
    c.execute("BEGIN")
    c.execute("UPDATE site_settings SET updated_at = updated_at WHERE key = 'no.such.key'")
    try:
        c.execute("INSERT INTO batch_guards (guard, actual, expected) VALUES (3, changes(), 1)")
        raise AssertionError("guard did not abort")
    except sqlite3.DatabaseError as e:
        assert "batch_guard_failed:3" in str(e), e
    c.execute("ROLLBACK")


@test("42 content page: legal kind needs a legal type; one active page per legal type; slug format")
def _():
    c = new_db()
    ins = ("INSERT INTO content_pages (id, slug, title, kind, legal_type, body_html, status, published_at) "
           "VALUES (?, ?, 'Başlık', ?, ?, '<p>x</p>', ?, ?)")
    expect_error(c, ins, ("p1", "metin-a", "legal", None, "draft", None), "CHECK")
    expect_error(c, ins, ("p1", "metin-a", "general", "kvkk", "draft", None), "CHECK")
    expect_error(c, ins, ("p1", "Buyuk-Harf", "general", None, "draft", None), "CHECK")
    expect_error(c, ins, ("p1", "metin-a", "general", None, "published", None), "CHECK")
    # seed already holds an active distance_sales page
    expect_error(c, ins, ("p2", "ikinci-sozlesme", "legal", "distance_sales", "draft", None), "UNIQUE")
    c.execute("UPDATE content_pages SET status = 'archived' WHERE legal_type = 'distance_sales'")
    c.execute(ins, ("p2", "ikinci-sozlesme", "legal", "distance_sales", "draft", None))


@test("43 site settings: key format, known group, valid JSON")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO site_settings (key, group_name, value_json) VALUES ('Site.Name', 'general', '1')", "CHECK")
    expect_error(c, "INSERT INTO site_settings (key, group_name, value_json) VALUES ('site.x', 'checkout', '1')", "CHECK")
    expect_error(c, "INSERT INTO site_settings (key, group_name, value_json) VALUES ('site.x', 'general', '{bad')", "CHECK")


@test("44 ai integration: single row, known provider, model length")
def _():
    c = new_db()
    ins = ("INSERT INTO ai_integration (id, provider, model, api_key_ciphertext, api_key_nonce, api_key_auth_tag, key_version, api_key_hint) "
           "VALUES (?, ?, ?, 'c', 'n', 't', 'v1', '…abcd')")
    expect_error(c, ins, ("second", "openai", "gpt-x"), "CHECK")
    expect_error(c, ins, ("default", "mistral", "m-large"), "CHECK")
    expect_error(c, ins, ("default", "openai", "x"), "CHECK")
    c.execute(ins, ("default", "anthropic", "claude-sonnet-5-5"))
    expect_error(c, ins, ("default", "openai", "gpt-x"), "UNIQUE")



@test("45 provider catalog: ready firms carry form fields; JSON arrays; code format; upsert refreshes")
def _():
    c = new_db()
    ready = c.execute("SELECT code FROM integration_providers WHERE support_status = 'ready' ORDER BY code").fetchall()
    assert [r[0] for r in ready] == ["netgsm", "yurtici"], ready
    ins = "INSERT INTO integration_providers (code, kind, name, support_status, credential_fields_json) VALUES (?, ?, ?, ?, ?)"
    expect_error(c, ins, ("newsms", "sms", "Yeni", "ready", "[]"), "CHECK")
    expect_error(c, ins, ("Bad-Code", "sms", "Yeni", "planned", "[]"), "CHECK")
    expect_error(c, ins, ("newsms", "sms", "Yeni", "planned", "{}"), "CHECK")
    expect_error(c, ins, ("newsms", "fax", "Yeni", "planned", "[]"), "CHECK")
    c.execute("UPDATE integration_providers SET name = 'Eski ad' WHERE code = 'netgsm'")
    c.executescript(SCHEMA)
    assert c.execute("SELECT name FROM integration_providers WHERE code = 'netgsm'").fetchone()[0] == "Netgsm"


@test("46 integrations: one active per kind; carrier booking unique per key, failed needs an error")
def _():
    c = new_db()
    c.execute("INSERT INTO integrations (id, kind, provider_code, name, is_active) VALUES ('i1', 'sms', 'netgsm', 'Netgsm', 1)")
    expect_error(c, "INSERT INTO integrations (id, kind, provider_code, name, is_active) VALUES ('i2', 'sms', 'twilio', 'Twilio', 1)", contains="UNIQUE")
    c.execute("INSERT INTO integrations (id, kind, provider_code, name, is_active) VALUES ('i3', 'sms', 'twilio', 'Twilio', 0)")
    c.execute("INSERT INTO shipments (id, order_id, shipping_method_id) VALUES ('s1', 'ord_demo_1', 'sm_std')")
    c.execute("INSERT INTO shipments (id, order_id, shipping_method_id) VALUES ('s2', 'ord_demo_1', 'sm_std')")
    c.execute("INSERT INTO carrier_shipments (shipment_id, provider_code, cargo_key) VALUES ('s1', 'yurtici', 'NVKEY0001')")
    expect_error(c, "INSERT INTO carrier_shipments (shipment_id, provider_code, cargo_key) VALUES ('s2', 'yurtici', 'NVKEY0001')", contains="UNIQUE")
    expect_error(c, "INSERT INTO carrier_shipments (shipment_id, provider_code, cargo_key, status) VALUES ('s2', 'yurtici', 'NVKEY0002', 'failed')", contains="CHECK")


@test("47 campaign engine: offer types, tiers, one-ref conditions, single policy row, floor price <= price")
def _():
    c = new_db()
    expect_error(c, "INSERT INTO campaigns (id, name, kind, percentage_bps, offer_type, starts_at) VALUES ('x','x','percentage',1000,'mystery','2026')", contains="CHECK")
    c.execute("INSERT INTO campaigns (id, name, kind, percentage_bps, offer_type, starts_at) VALUES ('t','x','percentage',2000,'tiered_quantity','2026')")
    c.execute("INSERT INTO campaign_tiers (campaign_id, min_quantity, percentage_bps) VALUES ('t', 2, 1000), ('t', 3, 2000)")
    expect_error(c, "INSERT INTO campaign_tiers (campaign_id, min_quantity, percentage_bps) VALUES ('t', 1, 500)", contains="CHECK")
    expect_error(c, "INSERT INTO campaign_conditions (campaign_id, product_id, category_id) VALUES ('t', 'p_pan', 'c_mutfak')", contains="CHECK")
    expect_error(c, "INSERT INTO campaign_conditions (campaign_id) VALUES ('t')", contains="CHECK")
    c.execute("INSERT INTO campaign_conditions (campaign_id, category_id) VALUES ('t', 'c_mutfak')")
    c.execute("DELETE FROM campaigns WHERE id = 't'")
    assert c.execute("SELECT count(*) FROM campaign_tiers WHERE campaign_id = 't'").fetchone()[0] == 0, "tiers cascade"
    assert c.execute("SELECT conflict_strategy, max_discount_bps FROM pricing_policy").fetchall() == [("priority", 5000)]
    expect_error(c, "INSERT INTO pricing_policy (id) VALUES (2)", contains="CHECK")
    expect_error(c, "UPDATE pricing_policy SET max_discount_bps = 50", contains="CHECK")
    expect_error(c, "UPDATE variant_prices SET min_price_minor = unit_price_minor + 1 WHERE variant_id = 'v_pan'", contains="CHECK")
    c.execute("UPDATE variant_prices SET min_price_minor = unit_price_minor - 100 WHERE variant_id = 'v_pan'")
    assert c.execute("SELECT is_active, badge_emoji FROM campaigns WHERE id = 'cmp_3al2'").fetchone() == (1, "🔥"), "demo campaign is live"


@test("48 migration 2026-11-06 upgrades a database created by the previous schema")
def _():
    import subprocess
    try:
        old = subprocess.run(["git", "show", "a599ba9:db/schema.sql"], cwd=ROOT.parent, capture_output=True, text=True, check=True).stdout
        old_seed = subprocess.run(["git", "show", "a599ba9:db/seed.sql"], cwd=ROOT.parent, capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return  # no git history (e.g. exported tree): nothing to compare against
    c = sqlite3.connect(":memory:", isolation_level=None)
    c.execute("PRAGMA foreign_keys = ON")
    c.executescript(old)
    c.executescript(old_seed)
    c.executescript(SCHEMA)  # documented order: schema first (new tables), then the migrations
    for m in sorted((ROOT / "migrations").glob("*.sql")):
        c.executescript(m.read_text(encoding="utf-8"))
    cols = {r[1] for r in c.execute("PRAGMA table_info(campaigns)")}
    assert {"offer_type", "first_order_only", "condition_min_quantity", "badge_label", "badge_emoji", "badge_media_id"} <= cols, cols
    assert "allow_with_promotions" in {r[1] for r in c.execute("PRAGMA table_info(coupons)")}
    assert "min_price_minor" in {r[1] for r in c.execute("PRAGMA table_info(variant_prices)")}
    assert c.execute("SELECT is_active, offer_type FROM campaigns WHERE id = 'cmp_3al2'").fetchone() == (1, "buy_x_pay_y")
    assert c.execute("SELECT count(*) FROM campaign_products WHERE campaign_id = 'cmp_3al2'").fetchone()[0] == 0
    assert c.execute("SELECT count(*) FROM coupons WHERE id = 'cpn_demo_1'").fetchone()[0] == 1, "coupons survive"
    expect_error(c, "UPDATE variant_prices SET min_price_minor = unit_price_minor + 1 WHERE variant_id = 'v_pan'", contains="CHECK")


@test("49 bulk + feeds: https-only feed URL, header sealed together with its name, item state cascades")
def _():
    c = new_db()
    ins = "INSERT INTO product_feeds (id, name, format, url, item_path, match_key, key_path{}) VALUES ('f1', 'Tedarikçi', 'xml', '{}', 'rss.channel.item', 'barcode', 'g:gtin'{})"
    expect_error(c, ins.format("", "http://x.test/feed.xml", ""), contains="CHECK")
    expect_error(c, ins.format(", header_name", "https://x.test/feed.xml", ", 'X-Api-Key'"), contains="CHECK")
    expect_error(c, ins.format(", match_key", "https://x.test/feed.xml", ", 'name'").replace("'barcode', ", "", 1), contains="")
    c.execute(ins.format("", "https://x.test/feed.xml", ""))
    expect_error(c, "UPDATE product_feeds SET schedule_minutes = 5 WHERE id = 'f1'", contains="CHECK")
    c.execute("INSERT INTO product_feed_items (feed_id, key_value, product_id, content_hash, last_seen_at) VALUES ('f1', '869', 'p_pan', 'h', '2026')")
    c.execute("INSERT INTO bulk_jobs (id, kind, source, feed_id) VALUES ('j1', 'feed', 'Tedarikçi', 'f1')")
    expect_error(c, "INSERT INTO bulk_jobs (id, kind, source) VALUES ('j2', 'csv', 'x')", contains="CHECK")
    c.execute("DELETE FROM product_feeds WHERE id = 'f1'")
    assert c.execute("SELECT count(*) FROM product_feed_items").fetchone()[0] == 0, "items cascade"
    assert c.execute("SELECT feed_id FROM bulk_jobs WHERE id = 'j1'").fetchone()[0] is None, "job history kept"


@test("50 schema and seed are re-runnable on a populated database (local / remote sync)")
def _():
    c = new_db()
    before = {t: c.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("products", "coupon_redemptions", "campaign_allocations", "stock_reservations")}
    c.executescript(SCHEMA)
    c.executescript(SEED)
    after = {t: c.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in before}
    assert before == after, (before, after)
    assert c.execute("SELECT reserved FROM inventory_balances WHERE variant_id = 'v_pan'").fetchone()[0] == 1, "reservation not applied twice"


@test("51 change capture: product, price, stock (sellable amount only), image changes are logged; migrations have probes")
def _():
    c = new_db()
    c.execute("DELETE FROM catalog_change_log")
    c.execute("UPDATE products SET name = 'Granit Tava Seti' WHERE id = 'p_pan'")
    c.execute("UPDATE variant_prices SET unit_price_minor = 79990 WHERE variant_id = 'v_pan'")
    c.execute("UPDATE inventory_balances SET on_hand = on_hand + 1, reserved = reserved + 1 WHERE variant_id = 'v_pan'")  # sellable unchanged
    c.execute("UPDATE inventory_balances SET on_hand = on_hand + 5 WHERE variant_id = 'v_pan'")
    rows = c.execute("SELECT kind, product_id, variant_id FROM catalog_change_log ORDER BY id").fetchall()
    assert rows == [("content", "p_pan", None), ("price", "p_pan", "v_pan"), ("stock", "p_pan", "v_pan")], rows
    for m in sorted((ROOT / "migrations").glob("*.sql")):
        first = m.read_text(encoding="utf-8").splitlines()[0]
        assert first.startswith("-- probe: "), m.name
        c.execute(first[len("-- probe: "):])  # the probe succeeds on a database that has the change


@test("52 marketplaces: one package per connection (no duplicate orders), mappings need exactly one value source")
def _():
    c = new_db()
    c.execute("INSERT INTO marketplace_connections (id, provider, name, seller_id, credentials_sealed_json) VALUES ('m1','trendyol','Trendyol','12345','{}')")
    expect_error(c, "INSERT INTO marketplace_connections (id, provider, name, seller_id, credentials_sealed_json) VALUES ('m2','trendyol','T2','12345','{}')", contains="UNIQUE")
    expect_error(c, "INSERT INTO marketplace_connections (id, provider, name, seller_id, credentials_sealed_json) VALUES ('m3','amazon','A','1','{}')", contains="CHECK")
    c.execute("INSERT INTO marketplace_orders (connection_id, external_package_id, external_order_number, status, error) VALUES ('m1','9001','T-1','failed','barkod yok')")
    expect_error(c, "INSERT INTO marketplace_orders (connection_id, external_package_id, external_order_number, status) VALUES ('m1','9001','T-1','failed')", contains="UNIQUE")
    expect_error(c, "UPDATE marketplace_orders SET status = 'imported' WHERE external_package_id = '9001'", contains="CHECK")
    expect_error(c, "INSERT INTO marketplace_attribute_mappings (connection_id, external_category_id, external_attribute_id, external_attribute_name) VALUES ('m1', 1, 2, 'Renk')", contains="CHECK")
    c.execute("INSERT INTO marketplace_attribute_mappings (connection_id, external_category_id, external_attribute_id, external_attribute_name, attribute_id) VALUES ('m1', 1, 2, 'Renk', 'a_color')")
    c.execute("INSERT INTO marketplace_listings (connection_id, variant_id, product_id) VALUES ('m1','v_pan','p_pan')")
    c.execute("DELETE FROM marketplace_connections WHERE id = 'm1'")
    assert c.execute("SELECT count(*) FROM marketplace_listings").fetchone()[0] == 0, "cascade"
    assert c.execute("SELECT prefix FROM barcode_sequences").fetchone()[0] == "2000000"



@test("53 reviews + panel notifications: moderation values, one review per customer, votes / contacts cascade, single settings row")
def _():
    c = new_db()
    assert c.execute("SELECT count(*) FROM reviews WHERE status = 'pending'").fetchone()[0] == 2
    expect_error(c, "INSERT INTO reviews (id, product_id, user_id, rating, body) VALUES ('r_dup','p_knit','u_customer',4,'tekrar')", contains="UNIQUE")
    expect_error(c, "INSERT INTO reviews (id, product_id, user_id, rating, body) VALUES ('r_x','p_atlas','u_customer',6,'x')", contains="CHECK")
    expect_error(c, "UPDATE reviews SET reject_reason = 'boring' WHERE id = 'rev_demo_5'", contains="CHECK")
    expect_error(c, "UPDATE reviews SET contact_status = 'waiting' WHERE id = 'rev_demo_3'", contains="CHECK")
    expect_error(c, "INSERT INTO review_votes (review_id, user_id) VALUES ('rev_demo_1','u_cust_2')", contains="UNIQUE")
    expect_error(c, "INSERT INTO review_contacts (id, review_id, channel, body) VALUES ('rc_x','rev_demo_3','email','mail without subject')", contains="CHECK")
    expect_error(c, "INSERT INTO review_settings (id) VALUES (2)", contains="CHECK")
    expect_error(c, "UPDATE review_settings SET blocked_words = '{}'", contains="CHECK")
    expect_error(c, "INSERT INTO admin_notifications (id, type, title, href) VALUES ('n_x','review.pending','x','https://evil.test')", contains="CHECK")
    expect_error(c, "INSERT INTO admin_notifications (id, type, title, dedupe_key) VALUES ('n_y','order.placed','x','order.placed:ord_demo_1')", contains="UNIQUE")
    c.execute("DELETE FROM reviews WHERE id = 'rev_demo_1'")
    assert c.execute("SELECT count(*) FROM review_votes WHERE review_id = 'rev_demo_1'").fetchone()[0] == 0, "votes cascade"
    c.execute("DELETE FROM admin_notifications WHERE id = 'an_demo_3'")
    assert c.execute("SELECT count(*) FROM admin_notification_states").fetchone()[0] == 0, "states cascade"


@test("54 migration 2026-11-08 upgrades reviews of a database created by the previous schema")
def _():
    import subprocess
    try:
        old = subprocess.run(["git", "show", "56b4be8:db/schema.sql"], cwd=ROOT.parent, capture_output=True, text=True, check=True).stdout
        old_seed = subprocess.run(["git", "show", "56b4be8:db/seed.sql"], cwd=ROOT.parent, capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return
    c = sqlite3.connect(":memory:", isolation_level=None)
    c.execute("PRAGMA foreign_keys = ON")
    c.executescript(old)
    c.executescript(old_seed)
    c.executescript(SCHEMA)
    c.executescript((ROOT / "migrations" / "2026-11-08-reviews-notifications.sql").read_text(encoding="utf-8"))
    cols = {r[1] for r in c.execute("PRAGMA table_info(reviews)")}
    assert {"verified_purchase", "reply_body", "contact_status", "version", "published_at"} <= cols, cols
    assert c.execute("SELECT published_at IS NOT NULL FROM reviews WHERE id = 'rev_demo_1'").fetchone()[0] == 1
    assert c.execute("SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'reviews.moderate'").fetchone()[0] == 2
    assert c.execute("SELECT count(*) FROM review_settings").fetchone()[0] == 1

@test("55 variants v2: model code (format CHECK, change capture), varies_media; migration 2026-11-09 upgrades the previous schema")
def _():
    c = new_db()
    assert c.execute("SELECT varies_media FROM attribute_definitions WHERE id = 'a_color'").fetchone()[0] == 1
    assert c.execute("SELECT model_code FROM products WHERE id = 'p_knit'").fetchone()[0] == "ATL-TRK-01"
    expect_error(c, "UPDATE products SET model_code = 'kötü kod' WHERE id = 'p_pan'", contains="CHECK")
    expect_error(c, "UPDATE attribute_definitions SET varies_media = 2 WHERE id = 'a_size'", contains="CHECK")
    c.execute("DELETE FROM catalog_change_log")
    c.execute("UPDATE products SET model_code = 'GRN-SET' WHERE id = 'p_pan'")
    assert c.execute("SELECT kind, product_id FROM catalog_change_log").fetchall() == [("content", "p_pan")]
    # variant photos (product_media.variant_id) must belong to a variant of the same product
    expect_error(c, "INSERT INTO product_media (id, product_id, variant_id, media_id) VALUES ('pm_x', 'p_pan', 'v_knit_bk_l', (SELECT id FROM media_assets LIMIT 1))", contains="FOREIGN KEY")
    import subprocess
    try:
        old = subprocess.run(["git", "show", "56b4be8:db/schema.sql"], cwd=ROOT.parent, capture_output=True, text=True, check=True).stdout
        old_seed = subprocess.run(["git", "show", "56b4be8:db/seed.sql"], cwd=ROOT.parent, capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return
    u = sqlite3.connect(":memory:", isolation_level=None)
    u.execute("PRAGMA foreign_keys = ON")
    u.executescript(old)
    u.executescript(old_seed)
    u.executescript(SCHEMA)
    for m in sorted((ROOT / "migrations").glob("*.sql")):
        first = m.read_text(encoding="utf-8").splitlines()[0][len("-- probe: "):]
        try:
            u.execute(first)
            continue  # already applied (what scripts/migrate.mjs does)
        except sqlite3.DatabaseError:
            u.executescript(m.read_text(encoding="utf-8"))
    assert "model_code" in {r[1] for r in u.execute("PRAGMA table_info(products)")}
    assert u.execute("SELECT varies_media FROM attribute_definitions WHERE id = 'a_color'").fetchone()[0] == 1
    u.execute("DELETE FROM catalog_change_log")
    u.execute("UPDATE products SET model_code = 'X-1' WHERE id = 'p_pan'")
    assert u.execute("SELECT count(*) FROM catalog_change_log").fetchone()[0] == 1, "trigger recreated with model_code"


if __name__ == "__main__":
    passed = sum(1 for _, ok, _ in results if ok)
    for name, ok, err in results:
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {err}"))
    print(f"\n{passed}/{len(results)} passed")
    sys.exit(0 if passed == len(results) else 1)

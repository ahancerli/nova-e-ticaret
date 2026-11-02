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
@test("01 88 tables exist")
def _():
    c = new_db()
    n = c.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
    assert n == 88, n


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
    c.execute("INSERT INTO batch_guards (actual, expected) VALUES (changes(), 1)")
    c.execute("INSERT INTO audit_logs (id, action, entity_type) VALUES ('g1','x','y')")
    c.execute("COMMIT")
    assert c.execute("SELECT count(*) FROM batch_guards").fetchone()[0] == 0
    assert c.execute("SELECT count(*) FROM audit_logs WHERE id = 'g1'").fetchone()[0] == 1
    # nothing changed → guard aborts
    c.execute("BEGIN")
    c.execute("UPDATE site_settings SET updated_at = updated_at WHERE key = 'no.such.key'")
    try:
        c.execute("INSERT INTO batch_guards (actual, expected) VALUES (changes(), 1)")
        raise AssertionError("guard did not abort")
    except sqlite3.DatabaseError as e:
        assert "batch_guard_failed" in str(e), e
    c.execute("ROLLBACK")


if __name__ == "__main__":
    passed = sum(1 for _, ok, _ in results if ok)
    for name, ok, err in results:
        print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {err}"))
    print(f"\n{passed}/{len(results)} passed")
    sys.exit(0 if passed == len(results) else 1)

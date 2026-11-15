-- probe: SELECT payment_method, payment_fee_minor FROM orders LIMIT 0
-- foreign_keys: off
-- Kapıda ödeme (2026-11-15): payment_configs.provider and payments.provider accept cash_on_delivery. SQLite cannot
-- change a CHECK in place, so both tables are rebuilt (create new, copy, drop, rename). The runner switches foreign keys
-- off for this file and runs PRAGMA foreign_key_check before committing. Index and trigger of the rebuilt tables are
-- recreated here because schema.sql ran before this file. Orders get the chosen payment method and the COD fee.

CREATE TABLE payment_configs_new (
  -- TABLO: Ödeme yöntemi ayarları: iyzico (kredi kartı), havale/EFT ve kapıda ödeme, ortam başına (sandbox/production).
  --        Gizli anahtarlar integration_secrets ta. Kapıda ödemenin ücreti ve kuralları public_config_json da.
  id                 TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  provider           TEXT NOT NULL CHECK (provider IN ('iyzico','bank_transfer','cash_on_delivery')),  -- iyzico / bank_transfer / cash_on_delivery kapıda ödeme
  name               TEXT NOT NULL,  -- Görünen ad
  environment        TEXT NOT NULL CHECK (environment IN ('sandbox','production')),  -- sandbox test / production canlı
  public_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(public_config_json)),  -- Gizli olmayan ayarlar (JSON)
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),  -- Aktif mi (sağlayıcı başına tek aktif)
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (provider, environment)
) STRICT;
INSERT INTO payment_configs_new (id, provider, name, environment, public_config_json, is_active, updated_at)
  SELECT id, provider, name, environment, public_config_json, is_active, updated_at FROM payment_configs;
DROP TABLE payment_configs;
ALTER TABLE payment_configs_new RENAME TO payment_configs;

CREATE TABLE payments_new (
  -- TABLO: Ödeme denemeleri / tahsilatlar (sipariş başına bir veya daha fazla). created/pending → paid →
  --        partially_refunded/refunded, ya da failed/cancelled. paid olan ödeme yalnız iade durumuna geçebilir (trigger).
  id                  TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  order_id            TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,  -- Sipariş
  payment_config_id   TEXT NOT NULL REFERENCES payment_configs(id) ON DELETE RESTRICT,  -- Kullanılan ödeme ayarı
  provider            TEXT NOT NULL CHECK (provider IN ('iyzico','bank_transfer','cash_on_delivery')),  -- iyzico / bank_transfer / cash_on_delivery kapıda ödeme (teslimatta paid olur)
  provider_payment_id TEXT,  -- Sağlayıcının ödeme id si
  conversation_id     TEXT NOT NULL UNIQUE,  -- iyzico ile eşleştirme için bizim tekil id miz
  idempotency_key     TEXT NOT NULL UNIQUE,  -- Çift tahsilatı engeller
  amount_minor        INTEGER NOT NULL CHECK (amount_minor > 0),  -- Tutar (kuruş)
  currency            TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),  -- Para birimi (ISO 4217, varsayılan TRY)
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','authorized','paid','failed','cancelled','refunded','partially_refunded')),  -- created, pending, authorized, paid, failed, cancelled, refunded, partially_refunded
  paid_at             TEXT,  -- Tahsil zamanı
  failure_code        TEXT,  -- Başarısızlık kodu
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (provider, provider_payment_id),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
) STRICT;
INSERT INTO payments_new (id, order_id, payment_config_id, provider, provider_payment_id, conversation_id, idempotency_key, amount_minor, currency, status, paid_at, failure_code, created_at, updated_at)
  SELECT id, order_id, payment_config_id, provider, provider_payment_id, conversation_id, idempotency_key, amount_minor, currency, status, paid_at, failure_code, created_at, updated_at FROM payments;
DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_config_active    ON payment_configs(provider) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS ix_payments_order             ON payments(order_id, status);
CREATE TRIGGER IF NOT EXISTS trg_payment_paid_terminal
BEFORE UPDATE OF status ON payments
WHEN OLD.status = 'paid' AND NEW.status NOT IN ('paid','refunded','partially_refunded')
BEGIN
  SELECT RAISE(ABORT, 'payment_paid_terminal');
END;

ALTER TABLE orders ADD COLUMN payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('iyzico','bank_transfer','cash_on_delivery'));
ALTER TABLE orders ADD COLUMN payment_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (payment_fee_minor >= 0);
UPDATE orders SET payment_method = (SELECT p.provider FROM payments p WHERE p.order_id = orders.id ORDER BY p.created_at, p.id LIMIT 1);

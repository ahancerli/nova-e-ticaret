-- =============================================================================
-- NOVA E-COMMERCE — SINGLE DDL SCRIPT (Cloudflare D1 / SQLite)
-- 95 STRICT tables · 60 indexes · 25 triggers
-- Data rules, status transitions and value vocabularies used by the app: db/README.md
--
-- Apply:
--   npm run db:schema:remote   (wrangler d1 execute nova-db --remote --file=db/schema.sql)
--
-- D1 notes (differs from the original SQLite design in the handoff PDF):
--   * D1 enforces foreign keys by default; PRAGMA foreign_keys / WAL /
--     busy_timeout / BEGIN IMMEDIATE are NOT used. Atomicity is achieved with
--     db.batch([...]) (one implicit transaction) and with the triggers below.
--   * Do not put BEGIN/COMMIT in this file: wrangler d1 execute rejects them.
--   * Money = INTEGER minor units (kuruş), tax-inclusive. Time = UTC ISO-8601 ms.
--   * Script is idempotent for tables/indexes (IF NOT EXISTS). Triggers are
--     dropped and recreated so re-running picks up changes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. IDENTITY & ACCESS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email_normalized  TEXT NOT NULL UNIQUE CHECK (email_normalized = lower(trim(email_normalized)) AND instr(email_normalized,'@') > 1),
  phone_e164        TEXT CHECK (phone_e164 IS NULL OR phone_e164 GLOB '+[1-9]*'),
  display_name      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','anonymized')),
  email_verified_at TEXT,
  phone_verified_at TEXT,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id                  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name               TEXT NOT NULL,
  last_name                TEXT NOT NULL,
  company_name             TEXT,
  tax_office               TEXT,
  tax_identifier_encrypted TEXT,
  birth_date               TEXT,
  locale                   TEXT NOT NULL DEFAULT 'tr-TR',
  notes_internal           TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- Staff (panel) accounts. A staff member sets their own password through an invitation link
-- (verification_tokens purpose 'staff_invite'); until then there is no auth_credentials row.
CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employee_code TEXT UNIQUE,
  department    TEXT CHECK (department IS NULL OR length(department) <= 80),
  job_title     TEXT CHECK (job_title IS NULL OR length(job_title) <= 80),
  mfa_required  INTEGER NOT NULL DEFAULT 1 CHECK (mfa_required IN (0,1)),
  invited_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  invited_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- is_system roles ship with the product (code fixed, not deletable); 'admin' always holds every permission and
-- 'customer' is the storefront role (never assignable to staff).
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 2 AND 60 AND code NOT GLOB '*[^a-z0-9_]*'),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  description TEXT CHECK (description IS NULL OR length(description) <= 300),
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS permissions (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  description TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, role_id)
) STRICT;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
) STRICT;

CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash        TEXT NOT NULL CHECK (password_hash GLOB '$2[aby]$*'),
  password_changed_at  TEXT,
  mfa_secret_encrypted TEXT,
  failed_attempts      INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until         TEXT,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  ip_hash         TEXT,
  user_agent_hash TEXT,
  mfa_verified_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS verification_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('email_verify','password_reset','phone_verify','guest_order_view','staff_invite')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS user_consents (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_identity_hash TEXT,
  purpose             TEXT NOT NULL CHECK (purpose IN ('kvkk_notice','marketing_email','marketing_sms','cookies_analytics','distance_sales')),
  document_version    TEXT NOT NULL,
  granted             INTEGER NOT NULL CHECK (granted IN (0,1)),
  recorded_at         TEXT NOT NULL,
  withdrawn_at        TEXT,
  CHECK (user_id IS NOT NULL OR guest_identity_hash IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS addresses (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label               TEXT NOT NULL,
  recipient_name      TEXT NOT NULL,
  phone_e164          TEXT NOT NULL,
  country_code        TEXT NOT NULL DEFAULT 'TR' CHECK (length(country_code) = 2),
  province            TEXT NOT NULL,
  district            TEXT NOT NULL,
  line1               TEXT NOT NULL,
  line2               TEXT,
  postal_code         TEXT,
  is_default_shipping INTEGER NOT NULL DEFAULT 0 CHECK (is_default_shipping IN (0,1)),
  is_default_billing  INTEGER NOT NULL DEFAULT 0 CHECK (is_default_billing IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- -----------------------------------------------------------------------------
-- 2. CATALOG & INVENTORY
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
  id          TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  public_url  TEXT CHECK (public_url IS NULL OR public_url GLOB 'https://*' OR public_url GLOB '/*'),
  mime_type   TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/avif','image/svg+xml','video/mp4','application/pdf')),
  byte_size   INTEGER NOT NULL CHECK (byte_size > 0),
  width       INTEGER CHECK (width IS NULL OR width > 0),
  height      INTEGER CHECK (height IS NULL OR height > 0),
  alt_text    TEXT NOT NULL DEFAULT '',
  sha256      TEXT,
  rights_note TEXT,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS brands (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  description     TEXT,
  logo_media_id   TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  banner_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  website_url     TEXT CHECK (website_url IS NULL OR website_url GLOB 'http*://*'),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS categories (
  id             TEXT PRIMARY KEY,
  parent_id      TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE CHECK (slug NOT GLOB '*[^a-z0-9-]*'),
  description    TEXT,
  image_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  menu_media_id  TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;

CREATE TABLE IF NOT EXISTS suppliers (
  id                       TEXT PRIMARY KEY,
  code                     TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  contact_email            TEXT,
  phone                    TEXT,
  tax_identifier_encrypted TEXT,
  is_active                INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS products (
  id                TEXT PRIMARY KEY,
  brand_id          TEXT REFERENCES brands(id) ON DELETE RESTRICT,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE CHECK (slug NOT GLOB '*[^a-z0-9-]*'),
  short_description TEXT,
  description_html  TEXT,
  accounting_code   TEXT,
  manufacturer_code TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','published','paused','archived')),
  tax_rate_bps      INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  warranty_months   INTEGER CHECK (warranty_months IS NULL OR warranty_months >= 0),
  country_of_origin TEXT CHECK (country_of_origin IS NULL OR length(country_of_origin) = 2),
  published_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Added 2026-11-09 (existing DBs: db/migrations/2026-11-09-variant-media.sql). Model kodu (Trendyol productMainId): keeps the
  -- variants of one model together in bulk sheets and on marketplaces. Unique when set — checked by the product save use
  -- case (no index: an index on an ALTER-added column would break schema.sql on old databases before the migration).
  model_code        TEXT CHECK (model_code IS NULL OR (length(model_code) BETWEEN 1 AND 64 AND model_code NOT GLOB '*[^A-Za-z0-9._-]*'))
) STRICT;

CREATE TABLE IF NOT EXISTS product_categories (
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  PRIMARY KEY (product_id, category_id)
) STRICT;

CREATE TABLE IF NOT EXISTS product_variants (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku             TEXT NOT NULL UNIQUE,
  barcode         TEXT UNIQUE,
  name            TEXT,
  combination_key TEXT NOT NULL,
  weight_grams    INTEGER CHECK (weight_grams IS NULL OR weight_grams >= 0),
  width_mm        INTEGER CHECK (width_mm IS NULL OR width_mm >= 0),
  height_mm       INTEGER CHECK (height_mm IS NULL OR height_mm >= 0),
  depth_mm        INTEGER CHECK (depth_mm IS NULL OR depth_mm >= 0),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (product_id, combination_key),
  UNIQUE (id, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS product_media (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id TEXT,
  media_id   TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  FOREIGN KEY (variant_id, product_id) REFERENCES product_variants(id, product_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS attribute_definitions (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE CHECK (code NOT GLOB '*[^a-z0-9_]*'),
  label           TEXT NOT NULL,
  data_type       TEXT NOT NULL CHECK (data_type IN ('text','number','boolean','select','multiselect')),
  unit            TEXT,
  is_variant_axis INTEGER NOT NULL DEFAULT 0 CHECK (is_variant_axis IN (0,1)),
  is_filterable   INTEGER NOT NULL DEFAULT 0 CHECK (is_filterable IN (0,1)),
  is_comparable   INTEGER NOT NULL DEFAULT 1 CHECK (is_comparable IN (0,1)),
  -- Added 2026-11-07 (existing DBs: db/migrations/2026-11-07-variants-marketplaces.sql). How a variant axis is picked on the
  -- product page: buttons (Beden 38, 39 …), colour swatches, or a dropdown for long lists (halı ölçüleri).
  display_style   TEXT NOT NULL DEFAULT 'button' CHECK (display_style IN ('button','swatch','dropdown')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  description     TEXT CHECK (description IS NULL OR length(description) <= 300),
  -- Added 2026-11-09: product images change with this axis (Renk): the editor assigns photos per value and the shop swaps
  -- the gallery when it is picked. Only meaningful on variant axes (checked by the attribute use cases).
  varies_media    INTEGER NOT NULL DEFAULT 0 CHECK (varies_media IN (0,1)),
  CHECK (is_variant_axis = 0 OR data_type = 'select')
) STRICT;

CREATE TABLE IF NOT EXISTS attribute_options (
  id              TEXT PRIMARY KEY,
  attribute_id    TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  value_code      TEXT NOT NULL,
  label           TEXT NOT NULL,
  color_hex       TEXT CHECK (color_hex IS NULL OR (length(color_hex) = 7 AND color_hex GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]')),
  swatch_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  -- Added 2026-11-07: numeric meaning of the option (shoe size 38.5, 6 m²) for sorting / range filters; inactive options
  -- stay on existing variants but are not offered for new ones.
  numeric_value   REAL,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (attribute_id, value_code),
  UNIQUE (id, attribute_id)
) STRICT;

CREATE TABLE IF NOT EXISTS category_attributes (
  category_id    TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  attribute_id   TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  is_required    INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
  show_in_filter INTEGER NOT NULL DEFAULT 1 CHECK (show_in_filter IN (0,1)),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, attribute_id)
) STRICT;

CREATE TABLE IF NOT EXISTS product_variant_axes (
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE RESTRICT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, attribute_id)
) STRICT;

CREATE TABLE IF NOT EXISTS product_attribute_values (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id  TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE RESTRICT,
  value_index   INTEGER NOT NULL DEFAULT 0 CHECK (value_index >= 0),
  text_value    TEXT,
  number_value  REAL,
  boolean_value INTEGER CHECK (boolean_value IS NULL OR boolean_value IN (0,1)),
  option_id     TEXT,
  UNIQUE (product_id, attribute_id, value_index),
  FOREIGN KEY (option_id, attribute_id) REFERENCES attribute_options(id, attribute_id) ON DELETE RESTRICT,
  CHECK ((text_value IS NOT NULL) + (number_value IS NOT NULL) + (boolean_value IS NOT NULL) + (option_id IS NOT NULL) = 1)
) STRICT;

CREATE TABLE IF NOT EXISTS variant_options (
  variant_id   TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE RESTRICT,
  option_id    TEXT NOT NULL,
  PRIMARY KEY (variant_id, attribute_id),
  FOREIGN KEY (option_id, attribute_id) REFERENCES attribute_options(id, attribute_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS supplier_variants (
  supplier_id           TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  variant_id            TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  supplier_product_code TEXT NOT NULL,
  cost_minor            INTEGER CHECK (cost_minor IS NULL OR cost_minor >= 0),
  currency              TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),
  lead_time_days        INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  is_preferred          INTEGER NOT NULL DEFAULT 0 CHECK (is_preferred IN (0,1)),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (supplier_id, variant_id),
  UNIQUE (supplier_id, supplier_product_code)
) STRICT;

CREATE TABLE IF NOT EXISTS price_lists (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  currency      TEXT NOT NULL CHECK (length(currency) = 3),
  tax_inclusive INTEGER NOT NULL DEFAULT 1 CHECK (tax_inclusive IN (0,1)),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS variant_prices (
  variant_id       TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  price_list_id    TEXT NOT NULL REFERENCES price_lists(id) ON DELETE RESTRICT,
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  compare_at_minor INTEGER CHECK (compare_at_minor IS NULL OR compare_at_minor > unit_price_minor),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Floor price: no campaign may sell a unit below it (margin protection). Added 2026-11.
  min_price_minor  INTEGER CHECK (min_price_minor IS NULL OR (min_price_minor >= 0 AND min_price_minor <= unit_price_minor)),
  PRIMARY KEY (variant_id, price_list_id)
) STRICT;

CREATE TABLE IF NOT EXISTS warehouses (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS inventory_balances (
  variant_id   TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  on_hand      INTEGER NOT NULL DEFAULT 0,
  reserved     INTEGER NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (variant_id, warehouse_id),
  CHECK (reserved >= 0 AND on_hand >= reserved)
) STRICT;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id              TEXT PRIMARY KEY,
  variant_id      TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  kind            TEXT NOT NULL CHECK (kind IN ('receipt','adjustment','reserve','release','commit','return','transfer_in','transfer_out','count')),
  on_hand_delta   INTEGER NOT NULL,
  reserved_delta  INTEGER NOT NULL DEFAULT 0,
  reference_type  TEXT,
  reference_id    TEXT,
  reason          TEXT,
  actor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (on_hand_delta <> 0 OR reserved_delta <> 0)
) STRICT;

CREATE TABLE IF NOT EXISTS stock_reservations (
  id              TEXT PRIMARY KEY,
  checkout_id     TEXT NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
  order_id        TEXT REFERENCES orders(id) ON DELETE RESTRICT,
  variant_id      TEXT NOT NULL,
  warehouse_id    TEXT NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  status          TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),
  expires_at      TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (variant_id, warehouse_id) REFERENCES inventory_balances(variant_id, warehouse_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS product_relations (
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  related_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  relation_type      TEXT NOT NULL CHECK (relation_type IN ('similar','complementary','curated','accessory')),
  sort_order         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, related_product_id, relation_type),
  CHECK (product_id <> related_product_id)
) STRICT;

-- -----------------------------------------------------------------------------
-- 3. CONTENT & STOREFRONT
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS navigation_menus (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS navigation_items (
  id          TEXT PRIMARY KEY,
  menu_id     TEXT NOT NULL REFERENCES navigation_menus(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES navigation_items(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  href        TEXT CHECK (href IS NULL OR href GLOB '/*' OR href GLOB 'https://*'),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  brand_id    TEXT REFERENCES brands(id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK ((href IS NOT NULL) + (category_id IS NOT NULL) + (brand_id IS NOT NULL) <= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS story_collections (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS stories (
  id             TEXT PRIMARY KEY,
  collection_id  TEXT NOT NULL REFERENCES story_collections(id) ON DELETE CASCADE,
  brand_id       TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  cover_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  starts_at      TEXT,
  ends_at        TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) STRICT;

CREATE TABLE IF NOT EXISTS story_frames (
  id          TEXT PRIMARY KEY,
  story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  media_id    TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  target_url  TEXT CHECK (target_url IS NULL OR target_url GLOB '/*' OR target_url GLOB 'https://*'),
  duration_ms INTEGER NOT NULL DEFAULT 5000 CHECK (duration_ms BETWEEN 1000 AND 60000),
  sort_order  INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS sliders (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS slides (
  id               TEXT PRIMARY KEY,
  slider_id        TEXT NOT NULL REFERENCES sliders(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  subtitle         TEXT,
  desktop_media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  mobile_media_id  TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  cta_label        TEXT,
  target_url       TEXT CHECK (target_url IS NULL OR target_url GLOB '/*' OR target_url GLOB 'https://*'),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  starts_at        TEXT,
  ends_at          TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) STRICT;

-- Home page layout: ordered sections, each of one type. Type-specific data: slider / story collection,
-- product selection (home_section_products or selection_mode), category / brand lists (tables below) and
-- banner image + link. Managed in Panel → Vitrin (src/modules/showcase).
CREATE TABLE IF NOT EXISTS home_sections (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  subtitle            TEXT CHECK (subtitle IS NULL OR length(subtitle) <= 160),
  section_type        TEXT NOT NULL CHECK (section_type IN ('hero_slider','story_strip','product_carousel','product_grid','category_tiles','brand_strip','banner','recently_viewed')),
  slider_id           TEXT REFERENCES sliders(id) ON DELETE RESTRICT,
  story_collection_id TEXT REFERENCES story_collections(id) ON DELETE RESTRICT,
  selection_mode      TEXT NOT NULL DEFAULT 'manual' CHECK (selection_mode IN ('manual','popular','new','discounted','rule')),
  item_limit          INTEGER NOT NULL DEFAULT 12 CHECK (item_limit BETWEEN 1 AND 48),
  media_id            TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  mobile_media_id     TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  target_url          TEXT CHECK (target_url IS NULL OR target_url GLOB '/*' OR target_url GLOB 'https://*'),
  cta_label           TEXT CHECK (cta_label IS NULL OR length(cta_label) <= 40),
  settings_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  starts_at           TEXT,
  ends_at             TEXT,
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (section_type <> 'hero_slider' OR slider_id IS NOT NULL),
  CHECK (section_type <> 'story_strip' OR story_collection_id IS NOT NULL),
  CHECK (section_type <> 'banner' OR media_id IS NOT NULL OR is_active = 0),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) STRICT;

CREATE TABLE IF NOT EXISTS home_section_categories (
  section_id  TEXT NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (section_id, category_id)
) STRICT;

CREATE TABLE IF NOT EXISTS home_section_brands (
  section_id TEXT NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,
  brand_id   TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (section_id, brand_id)
) STRICT;

CREATE TABLE IF NOT EXISTS home_section_products (
  section_id TEXT NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (section_id, product_id)
) STRICT;

-- Content management: company-specific pages (legal texts, corporate, help). Bodies may contain {{placeholders}}
-- filled from site_settings at render time (src/modules/content/domain/template.ts). Published pages with a
-- footer_column appear in the storefront footer automatically.
CREATE TABLE IF NOT EXISTS content_pages (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 120 AND slug NOT GLOB '*[^a-z0-9-]*'),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  kind          TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('legal','corporate','help','general')),
  legal_type    TEXT CHECK (legal_type IS NULL OR legal_type IN ('kvkk','privacy','cookies','distance_sales','pre_information','return_policy','terms_of_use','membership')),
  summary       TEXT CHECK (summary IS NULL OR length(summary) <= 500),
  body_html     TEXT NOT NULL CHECK (length(body_html) <= 200000),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  footer_column TEXT CHECK (footer_column IS NULL OR footer_column IN ('corporate','help','legal')),
  footer_order  INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  published_at  TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((kind = 'legal') = (legal_type IS NOT NULL)),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
) STRICT;

-- Every saved version of a page (what a customer accepted must stay provable after later edits).
CREATE TABLE IF NOT EXISTS content_page_revisions (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES content_pages(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL CHECK (version >= 1),
  title      TEXT NOT NULL,
  body_html  TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (page_id, version)
) STRICT;

CREATE TABLE IF NOT EXISTS seo_documents (
  id               TEXT PRIMARY KEY,
  product_id       TEXT UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  category_id      TEXT UNIQUE REFERENCES categories(id) ON DELETE CASCADE,
  brand_id         TEXT UNIQUE REFERENCES brands(id) ON DELETE CASCADE,
  page_id          TEXT UNIQUE REFERENCES content_pages(id) ON DELETE CASCADE,
  route_path       TEXT UNIQUE CHECK (route_path IS NULL OR route_path GLOB '/*'),
  meta_title       TEXT CHECK (meta_title IS NULL OR length(meta_title) <= 120),
  meta_description TEXT CHECK (meta_description IS NULL OR length(meta_description) <= 320),
  canonical_url    TEXT,
  og_media_id      TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  noindex          INTEGER NOT NULL DEFAULT 0 CHECK (noindex IN (0,1)),
  CHECK ((product_id IS NOT NULL) + (category_id IS NOT NULL) + (brand_id IS NOT NULL) + (page_id IS NOT NULL) + (route_path IS NOT NULL) = 1)
) STRICT;

-- Site configuration as typed key/value pairs; the key registry and per-key validation live in
-- src/modules/settings/domain/registry.ts. is_public = readable by the storefront without a session.
CREATE TABLE IF NOT EXISTS site_settings (
  key            TEXT PRIMARY KEY CHECK (length(key) BETWEEN 3 AND 80 AND key NOT GLOB '*[^a-z0-9_.]*'),
  group_name     TEXT NOT NULL CHECK (group_name IN ('general','company','contact','branding','seo','social','footer')),
  value_json     TEXT NOT NULL CHECK (json_valid(value_json)),
  is_public      INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- -----------------------------------------------------------------------------
-- 4. CAMPAIGNS & COUPONS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('percentage','amount','fixed_price','buy_x_pay_y','buy_x_get_y','free_shipping')),
  percentage_bps     INTEGER CHECK (percentage_bps IS NULL OR percentage_bps BETWEEN 1 AND 10000),
  amount_minor       INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
  buy_quantity       INTEGER CHECK (buy_quantity IS NULL OR buy_quantity > 0),
  pay_quantity       INTEGER CHECK (pay_quantity IS NULL OR pay_quantity >= 0),
  free_quantity      INTEGER CHECK (free_quantity IS NULL OR free_quantity > 0),
  target_mode        TEXT NOT NULL DEFAULT 'all' CHECK (target_mode IN ('all','selected')),
  starts_at          TEXT NOT NULL,
  ends_at            TEXT,
  priority           INTEGER NOT NULL DEFAULT 0,
  stack_policy       TEXT NOT NULL DEFAULT 'exclusive' CHECK (stack_policy IN ('exclusive','combinable')),
  min_subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal_minor >= 0),
  max_discount_minor INTEGER CHECK (max_discount_minor IS NULL OR max_discount_minor > 0),
  capacity_units     INTEGER CHECK (capacity_units IS NULL OR capacity_units > 0),
  per_customer_limit INTEGER CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),
  requires_coupon    INTEGER NOT NULL DEFAULT 0 CHECK (requires_coupon IN (0,1)),
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  rule_version       INTEGER NOT NULL DEFAULT 1 CHECK (rule_version >= 1),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Added 2026-11 (existing DBs: db/migrations/2026-11-06-campaign-engine.sql). Column constraints only, so ALTER ADD works.
  -- offer_type = what the panel and the pricing engine use; NULL on older rows = same as `kind`. `kind` stays the storage
  -- mechanic because its CHECK cannot change on a live D1 (a table rebuild would CASCADE-delete coupons and targets):
  -- cart_percentage / tiered_quantity / cross_sell are stored as kind 'percentage'.
  offer_type             TEXT CHECK (offer_type IS NULL OR offer_type IN ('percentage','cart_percentage','amount','fixed_price','buy_x_pay_y','tiered_quantity','cross_sell','free_shipping')),
  first_order_only       INTEGER NOT NULL DEFAULT 0 CHECK (first_order_only IN (0,1)),
  condition_min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (condition_min_quantity BETWEEN 1 AND 100),
  badge_label            TEXT CHECK (badge_label IS NULL OR length(badge_label) BETWEEN 1 AND 40),
  badge_emoji            TEXT CHECK (badge_emoji IS NULL OR length(badge_emoji) BETWEEN 1 AND 16),
  badge_media_id         TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (kind <> 'percentage'  OR percentage_bps IS NOT NULL),
  CHECK (kind NOT IN ('amount','fixed_price') OR amount_minor IS NOT NULL),
  CHECK (kind <> 'buy_x_pay_y' OR (buy_quantity IS NOT NULL AND pay_quantity IS NOT NULL AND buy_quantity > pay_quantity)),
  CHECK (kind <> 'buy_x_get_y' OR (buy_quantity IS NOT NULL AND free_quantity IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_products (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'include' CHECK (mode IN ('include','exclude')),
  PRIMARY KEY (campaign_id, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_brands (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  brand_id    TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'include' CHECK (mode IN ('include','exclude')),
  PRIMARY KEY (campaign_id, brand_id)
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_categories (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'include' CHECK (mode IN ('include','exclude')),
  PRIMARY KEY (campaign_id, category_id)
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_reward_products (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  variant_id  TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, variant_id)
) STRICT;

-- Quantity tiers of a 'tiered_quantity' campaign: the same product bought min_quantity+ times gets percentage_bps off
-- every unit (highest reached tier wins). percentage_bps on the campaign row = the top tier (kind CHECK).
CREATE TABLE IF NOT EXISTS campaign_tiers (
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  min_quantity   INTEGER NOT NULL CHECK (min_quantity BETWEEN 2 AND 999),
  percentage_bps INTEGER NOT NULL CHECK (percentage_bps BETWEEN 1 AND 10000),
  PRIMARY KEY (campaign_id, min_quantity)
) STRICT;

-- Trigger scope of a 'cross_sell' campaign ("ayakkabı alana bakım spreyi %50"): the cart needs at least
-- campaigns.condition_min_quantity units from these products / brands / categories (categories include descendants);
-- the discount then goes to the campaign's own targets. Exactly one reference per row.
CREATE TABLE IF NOT EXISTS campaign_conditions (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id  TEXT REFERENCES products(id) ON DELETE CASCADE,
  brand_id    TEXT REFERENCES brands(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  CHECK ((product_id IS NOT NULL) + (brand_id IS NOT NULL) + (category_id IS NOT NULL) = 1)
) STRICT;

-- Shop-wide campaign rules (one row, reference data upserted at the end of this file).
--   conflict_strategy 'priority': higher priority applies first; a non-stackable ("Birleşmez") campaign locks the units it
--                                 discounts, so lower ones cannot touch them.
--                     'best_deal': among non-stackable campaigns the one giving the customer the most applies first.
--   max_discount_bps: total discount of a cart (shipping excluded) may not exceed this share of the cart (margin guard).
CREATE TABLE IF NOT EXISTS pricing_policy (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  conflict_strategy TEXT NOT NULL DEFAULT 'priority' CHECK (conflict_strategy IN ('priority','best_deal')),
  max_discount_bps  INTEGER NOT NULL DEFAULT 5000 CHECK (max_discount_bps BETWEEN 100 AND 10000),
  updated_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS coupons (
  id                 TEXT PRIMARY KEY,
  campaign_id        TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  code_normalized    TEXT NOT NULL UNIQUE CHECK (code_normalized = upper(trim(code_normalized)) AND length(code_normalized) BETWEEN 3 AND 40),
  max_redemptions    INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  per_customer_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  starts_at          TEXT,
  ends_at            TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- 0 = refused while an automatic campaign already discounts the cart (coupon exclusion). Added 2026-11.
  allow_with_promotions INTEGER NOT NULL DEFAULT 1 CHECK (allow_with_promotions IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id                TEXT PRIMARY KEY,
  coupon_id         TEXT NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  checkout_id       TEXT NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
  order_id          TEXT REFERENCES orders(id) ON DELETE RESTRICT,
  customer_key_hash TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (coupon_id, checkout_id)
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_allocations (
  id             TEXT PRIMARY KEY,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  checkout_id    TEXT NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
  order_id       TEXT REFERENCES orders(id) ON DELETE RESTRICT,
  units          INTEGER NOT NULL CHECK (units > 0),
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  status         TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),
  expires_at     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (campaign_id, checkout_id)
) STRICT;

-- -----------------------------------------------------------------------------
-- 4b. BULK OPERATIONS (Toplu işlemler: Excel, XML / REST product feeds)
-- -----------------------------------------------------------------------------
-- One row per bulk run (an Excel import or one product-feed sync). Rows themselves are never stored: Excel files are
-- read in the browser and only the validated values reach the server; every product change goes through the product
-- save use case (stock ledger, guards, audit). summary_json = counts + the first row errors for the history screen.
CREATE TABLE IF NOT EXISTS bulk_jobs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('excel_create','excel_update','excel_images','excel_prices','excel_stock','feed')),
  source        TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 300),
  feed_id       TEXT REFERENCES product_feeds(id) ON DELETE SET NULL,
  match_key     TEXT CHECK (match_key IS NULL OR match_key IN ('barcode','sku','accounting_code','manufacturer_code')),
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  total_rows    INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  created_rows  INTEGER NOT NULL DEFAULT 0 CHECK (created_rows >= 0),
  updated_rows  INTEGER NOT NULL DEFAULT 0 CHECK (updated_rows >= 0),
  skipped_rows  INTEGER NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),
  error_rows    INTEGER NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  summary_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(summary_json) AND length(summary_json) <= 20000),
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at   TEXT
) STRICT;

-- A supplier product feed (XML or REST/JSON URL) mapped onto our product fields. mapping_json: { "<field>": "<source path>" }
-- (field = name, price, stock, images, …; path from the feed analyser). The key path's value is matched against
-- match_key (barcode / sku / accounting_code / manufacturer_code). An optional request header (e.g. an API key) is
-- sealed with AES-256-GCM like other integration secrets and never read back by the panel.
-- schedule_minutes NULL = manual only; the cron route (/api/cron/feeds-sync) runs due feeds in budgeted slices,
-- run_cursor = index of the next feed item of an unfinished pass.
CREATE TABLE IF NOT EXISTS product_feeds (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  format           TEXT NOT NULL CHECK (format IN ('xml','json')),
  url              TEXT NOT NULL CHECK (url GLOB 'https://*' AND length(url) <= 2000),
  item_path        TEXT NOT NULL CHECK (length(item_path) <= 300),
  match_key        TEXT NOT NULL CHECK (match_key IN ('barcode','sku','accounting_code','manufacturer_code')),
  key_path         TEXT NOT NULL CHECK (length(key_path) BETWEEN 1 AND 300),
  mapping_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(mapping_json) AND length(mapping_json) <= 10000),
  options_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options_json) AND length(options_json) <= 4000),
  header_name      TEXT CHECK (header_name IS NULL OR (length(header_name) BETWEEN 1 AND 100 AND header_name NOT GLOB '*[^A-Za-z0-9-]*')),
  header_secret_json TEXT CHECK (header_secret_json IS NULL OR json_valid(header_secret_json)),
  schedule_minutes INTEGER CHECK (schedule_minutes IS NULL OR schedule_minutes IN (60, 180, 360, 720, 1440)),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  run_cursor       INTEGER NOT NULL DEFAULT 0 CHECK (run_cursor >= 0),
  pass_started_at  TEXT,
  next_run_at      TEXT,
  last_run_at      TEXT,
  last_status      TEXT CHECK (last_status IS NULL OR last_status IN ('ok','partial','failed')),
  last_message     TEXT CHECK (last_message IS NULL OR length(last_message) <= 500),
  last_job_id      TEXT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((header_name IS NULL) = (header_secret_json IS NULL))
) STRICT;

-- What a feed last wrote per item: unchanged items (same content_hash) are skipped, images are downloaded again only
-- when their URL list changes (image_hash), items missing from a whole pass can get stock 0 (last_seen_at).
CREATE TABLE IF NOT EXISTS product_feed_items (
  feed_id      TEXT NOT NULL REFERENCES product_feeds(id) ON DELETE CASCADE,
  key_value    TEXT NOT NULL CHECK (length(key_value) BETWEEN 1 AND 120),
  product_id   TEXT REFERENCES products(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  image_hash   TEXT,
  last_seen_at TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (feed_id, key_value)
) STRICT;

-- -----------------------------------------------------------------------------
-- 4c. INTEGRATIONS: change capture, message bus, marketplaces
-- -----------------------------------------------------------------------------
-- Change data capture: triggers (end of file) append one row per catalog change, whoever wrote it (panel, Excel,
-- feeds, orders, cancellations). The relay (/api/cron/integrations) coalesces rows into Kafka topics — product
-- info / stock / price / images — and advances integration_relay_state; relayed rows are pruned after 7 days.
CREATE TABLE IF NOT EXISTS catalog_change_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('content','stock','price','images')),
  product_id TEXT NOT NULL,
  variant_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS integration_relay_state (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  last_change_id INTEGER NOT NULL DEFAULT 0 CHECK (last_change_id >= 0),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- Database implementation of the message bus (INTEGRATION_BUS=database: local development, tests, small shops).
-- Same semantics as Kafka: an append-only log per topic and a committed position per consumer group.
-- With INTEGRATION_BUS=kafka these two tables stay empty.
CREATE TABLE IF NOT EXISTS integration_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  topic        TEXT NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),
  msg_key      TEXT CHECK (msg_key IS NULL OR length(msg_key) <= 200),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 100000),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS integration_consumer_offsets (
  consumer_group TEXT NOT NULL CHECK (length(consumer_group) BETWEEN 1 AND 100),
  topic          TEXT NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),
  last_id        INTEGER NOT NULL DEFAULT 0 CHECK (last_id >= 0),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (consumer_group, topic)
) STRICT;

-- A shop's account on a marketplace (Trendyol today; Hepsiburada, N11, Çiçeksepeti use the same rows).
-- credentials_sealed_json = AES-256-GCM sealed {apiKey, apiSecret} (never read back by the panel).
-- *_minutes = how often orders are pulled and stock / price / product info are pushed; next_*_at = when next due.
-- orders_synced_until = epoch-ms watermark of pulled orders (pulls overlap it, duplicates are dropped by marketplace_orders).
-- channel_cart_id = internal cart that marketplace orders hang on (orders → checkout_sessions → carts).
CREATE TABLE IF NOT EXISTS marketplace_connections (
  id                   TEXT PRIMARY KEY,
  provider             TEXT NOT NULL CHECK (provider IN ('trendyol','hepsiburada','n11','ciceksepeti')),
  name                 TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  environment          TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production','stage')),
  seller_id            TEXT NOT NULL CHECK (length(seller_id) BETWEEN 1 AND 40 AND seller_id NOT GLOB '*[^0-9A-Za-z_-]*'),
  credentials_sealed_json TEXT NOT NULL CHECK (json_valid(credentials_sealed_json)),
  settings_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json) AND length(settings_json) <= 4000),
  is_active            INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  order_pull_minutes   INTEGER NOT NULL DEFAULT 5 CHECK (order_pull_minutes IN (1,5,10,15,30,60)),
  stock_push_minutes   INTEGER NOT NULL DEFAULT 5 CHECK (stock_push_minutes IN (1,5,10,15,30,60)),
  price_push_minutes   INTEGER NOT NULL DEFAULT 15 CHECK (price_push_minutes IN (1,5,10,15,30,60)),
  content_push_minutes INTEGER NOT NULL DEFAULT 60 CHECK (content_push_minutes IN (5,15,30,60,180,360,720,1440)),
  next_order_pull_at   TEXT,
  next_stock_push_at   TEXT,
  next_price_push_at   TEXT,
  next_content_push_at TEXT,
  orders_synced_until  INTEGER CHECK (orders_synced_until IS NULL OR orders_synced_until > 0),
  last_sync_at         TEXT,
  last_error           TEXT CHECK (last_error IS NULL OR length(last_error) <= 1000),
  channel_cart_id      TEXT REFERENCES carts(id) ON DELETE RESTRICT,
  created_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, environment, seller_id)
) STRICT;

-- Our category / brand → the marketplace's id (Trendyol needs leaf category and brand ids on every product).
CREATE TABLE IF NOT EXISTS marketplace_category_mappings (
  connection_id          TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  category_id            TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  external_category_id   INTEGER NOT NULL CHECK (external_category_id > 0),
  external_category_path TEXT NOT NULL CHECK (length(external_category_path) <= 500),
  PRIMARY KEY (connection_id, category_id)
) STRICT;

CREATE TABLE IF NOT EXISTS marketplace_brand_mappings (
  connection_id       TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  brand_id            TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  external_brand_id   INTEGER NOT NULL CHECK (external_brand_id > 0),
  external_brand_name TEXT NOT NULL CHECK (length(external_brand_name) <= 200),
  PRIMARY KEY (connection_id, brand_id)
) STRICT;

-- Marketplace category attribute ← one of our attributes (its option values are mapped below) or a fixed value
-- (e.g. Menşei = TR for every product of the category).
CREATE TABLE IF NOT EXISTS marketplace_attribute_mappings (
  connection_id           TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  external_category_id    INTEGER NOT NULL,
  external_attribute_id   INTEGER NOT NULL,
  external_attribute_name TEXT NOT NULL CHECK (length(external_attribute_name) <= 200),
  attribute_id            TEXT REFERENCES attribute_definitions(id) ON DELETE CASCADE,
  fixed_value_id          INTEGER,
  fixed_custom_value      TEXT CHECK (fixed_custom_value IS NULL OR length(fixed_custom_value) BETWEEN 1 AND 200),
  PRIMARY KEY (connection_id, external_category_id, external_attribute_id),
  CHECK ((attribute_id IS NOT NULL) + (fixed_value_id IS NOT NULL) + (fixed_custom_value IS NOT NULL) = 1)
) STRICT;

-- Our option (Kırmızı, 38, 160x230) → the marketplace's value id, or free text where the attribute allows custom values.
CREATE TABLE IF NOT EXISTS marketplace_value_mappings (
  connection_id         TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  external_attribute_id INTEGER NOT NULL,
  option_id             TEXT NOT NULL REFERENCES attribute_options(id) ON DELETE CASCADE,
  external_value_id     INTEGER,
  custom_value          TEXT CHECK (custom_value IS NULL OR length(custom_value) BETWEEN 1 AND 200),
  PRIMARY KEY (connection_id, external_attribute_id, option_id),
  CHECK ((external_value_id IS NOT NULL) + (custom_value IS NOT NULL) = 1)
) STRICT;

-- One variant (barcode) on one marketplace. content_id comes from the marketplace once the product is approved.
-- *_hash = what was last sent, so an unchanged product / price / stock is not sent again (Trendyol refuses
-- identical price-stock requests within 15 minutes).
CREATE TABLE IF NOT EXISTS marketplace_listings (
  connection_id    TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  variant_id       TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','approved','rejected','error','paused')),
  content_id       INTEGER,
  last_batch_id    TEXT,
  last_error       TEXT CHECK (last_error IS NULL OR length(last_error) <= 1000),
  content_hash     TEXT,
  price_stock_hash TEXT,
  last_pushed_at   TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (connection_id, variant_id)
) STRICT;

-- Work waiting for the next push of a connection (filled by the bus consumer; one row per variant and kind, so ten
-- stock changes of a variant become one update). Stock and price are separate kinds: each has its own interval.
CREATE TABLE IF NOT EXISTS marketplace_pending (
  connection_id TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('content','stock','price')),
  variant_id    TEXT NOT NULL,
  queued_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (connection_id, kind, variant_id)
) STRICT;

-- Asynchronous marketplace batches (Trendyol batchRequestId) until their result is read.
CREATE TABLE IF NOT EXISTS marketplace_batches (
  id            TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('content','stock','price')),
  status        TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed')),
  item_count    INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  failed_count  INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  variant_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(variant_ids_json)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  checked_at    TEXT
) STRICT;

-- Every marketplace package seen, keyed by the marketplace's package id: a package is written to orders exactly once
-- however often (and however overlapping) orders are pulled. 'failed' (e.g. unknown barcode) is retried on later pulls.
CREATE TABLE IF NOT EXISTS marketplace_orders (
  connection_id         TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  external_package_id   TEXT NOT NULL CHECK (length(external_package_id) BETWEEN 1 AND 60),
  external_order_number TEXT NOT NULL CHECK (length(external_order_number) BETWEEN 1 AND 60),
  order_id              TEXT REFERENCES orders(id) ON DELETE SET NULL,
  external_status       TEXT CHECK (external_status IS NULL OR length(external_status) <= 40),
  status                TEXT NOT NULL CHECK (status IN ('imported','failed','skipped')),
  error                 TEXT CHECK (error IS NULL OR length(error) <= 1000),
  last_modified_ms      INTEGER,
  attempts              INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (connection_id, external_package_id),
  CHECK (status <> 'imported' OR order_id IS NOT NULL)
) STRICT;

-- Marketplace reference data, cached (Trendyol asks to refresh the category tree weekly).
CREATE TABLE IF NOT EXISTS marketplace_category_cache (
  provider    TEXT NOT NULL CHECK (provider IN ('trendyol','hepsiburada','n11','ciceksepeti')),
  external_id INTEGER NOT NULL,
  parent_id   INTEGER,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  is_leaf     INTEGER NOT NULL CHECK (is_leaf IN (0,1)),
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (provider, external_id)
) STRICT;

CREATE TABLE IF NOT EXISTS marketplace_attribute_cache (
  provider             TEXT NOT NULL CHECK (provider IN ('trendyol','hepsiburada','n11','ciceksepeti')),
  external_category_id INTEGER NOT NULL,
  payload_json         TEXT NOT NULL CHECK (json_valid(payload_json)),
  fetched_at           TEXT NOT NULL,
  PRIMARY KEY (provider, external_category_id)
) STRICT;

-- Barcodes the shop generates for variants without a GS1 barcode: EAN-13 = prefix + running number + check digit.
-- Prefix 2… is the GS1 "restricted circulation" range (in-store use); a shop with its own GS1 company prefix sets it.
CREATE TABLE IF NOT EXISTS barcode_sequences (
  id         TEXT PRIMARY KEY CHECK (id = 'default'),
  prefix     TEXT NOT NULL CHECK (length(prefix) BETWEEN 3 AND 10 AND prefix NOT GLOB '*[^0-9]*'),
  next_value INTEGER NOT NULL CHECK (next_value >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- -----------------------------------------------------------------------------
-- 5. CART & ORDERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carts (
  id               TEXT PRIMARY KEY,
  user_id          TEXT REFERENCES users(id) ON DELETE CASCADE,
  guest_token_hash TEXT UNIQUE,
  currency         TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','converted','abandoned')),
  version          INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  expires_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((user_id IS NULL) <> (guest_token_hash IS NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS cart_items (
  id         TEXT PRIMARY KEY,
  cart_id    TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (cart_id, variant_id)
) STRICT;

CREATE TABLE IF NOT EXISTS cart_coupons (
  cart_id    TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  coupon_id  TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (cart_id, coupon_id)
) STRICT;

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id                  TEXT PRIMARY KEY,
  cart_id             TEXT NOT NULL REFERENCES carts(id) ON DELETE RESTRICT,
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  guest_identity_hash TEXT,
  quote_hash          TEXT NOT NULL,
  quote_json          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(quote_json)),
  cart_version        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),
  total_minor         INTEGER NOT NULL CHECK (total_minor >= 0),
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','expired','cancelled')),
  expires_at          TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL UNIQUE,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  order_number   TEXT NOT NULL UNIQUE,
  checkout_id    TEXT NOT NULL UNIQUE REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  currency       TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),
  status         TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','awaiting_transfer','paid','preparing','shipped','delivered','completed','cancelled','refunded','partially_refunded')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded','partially_refunded')),
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0 AND discount_minor <= subtotal_minor),
  shipping_minor INTEGER NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),
  tax_minor      INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor    INTEGER NOT NULL CHECK (total_minor >= 0),
  customer_note  TEXT CHECK (customer_note IS NULL OR length(customer_note) <= 1000),
  placed_at      TEXT NOT NULL,
  -- Added 2026-11-07: where the order was placed (web shop or a marketplace) and the marketplace's own order number.
  sales_channel  TEXT NOT NULL DEFAULT 'web' CHECK (sales_channel IN ('web','trendyol','hepsiburada','n11','ciceksepeti')),
  external_order_number TEXT CHECK (external_order_number IS NULL OR length(external_order_number) <= 60),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (total_minor = subtotal_minor - discount_minor + shipping_minor),
  CHECK (tax_minor <= total_minor)
) STRICT;

CREATE TABLE IF NOT EXISTS order_addresses (
  id                       TEXT PRIMARY KEY,
  order_id                 TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind                     TEXT NOT NULL CHECK (kind IN ('shipping','billing')),
  recipient_name           TEXT NOT NULL,
  phone_e164               TEXT NOT NULL,
  country_code             TEXT NOT NULL CHECK (length(country_code) = 2),
  province                 TEXT NOT NULL,
  district                 TEXT NOT NULL,
  line1                    TEXT NOT NULL,
  line2                    TEXT,
  postal_code              TEXT,
  company_name             TEXT,
  tax_identifier_encrypted TEXT,
  tax_office               TEXT,
  UNIQUE (order_id, kind)
) STRICT;

CREATE TABLE IF NOT EXISTS order_items (
  id                    TEXT PRIMARY KEY,
  order_id              TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id            TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  sku_snapshot          TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  variant_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(variant_snapshot_json)),
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor      INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  subtotal_minor        INTEGER NOT NULL,
  discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_rate_bps          INTEGER NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_minor             INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor           INTEGER NOT NULL,
  UNIQUE (id, order_id),
  CHECK (subtotal_minor = quantity * unit_price_minor),
  CHECK (discount_minor <= subtotal_minor),
  CHECK (total_minor = subtotal_minor - discount_minor),
  CHECK (tax_minor <= total_minor)
) STRICT;

CREATE TABLE IF NOT EXISTS order_adjustments (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id      TEXT,
  campaign_id        TEXT REFERENCES campaigns(id) ON DELETE RESTRICT,
  coupon_id          TEXT REFERENCES coupons(id) ON DELETE RESTRICT,
  label_snapshot     TEXT NOT NULL,
  rule_snapshot_json TEXT NOT NULL CHECK (json_valid(rule_snapshot_json)),
  amount_minor       INTEGER NOT NULL CHECK (amount_minor >= 0),
  target             TEXT NOT NULL CHECK (target IN ('item','order','shipping')),
  FOREIGN KEY (order_item_id, order_id) REFERENCES order_items(id, order_id) ON DELETE CASCADE,
  CHECK (target <> 'item' OR order_item_id IS NOT NULL),
  CHECK (campaign_id IS NOT NULL OR coupon_id IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS order_events (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  event_type      TEXT NOT NULL,
  from_status     TEXT,
  to_status       TEXT,
  note            TEXT,
  actor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- -----------------------------------------------------------------------------
-- 6. PAYMENTS & LOGISTICS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_configs (
  id                 TEXT PRIMARY KEY,
  provider           TEXT NOT NULL CHECK (provider IN ('iyzico','bank_transfer')),
  name               TEXT NOT NULL,
  environment        TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
  public_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(public_config_json)),
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, environment)
) STRICT;

CREATE TABLE IF NOT EXISTS bank_accounts (
  id                TEXT PRIMARY KEY,
  payment_config_id TEXT NOT NULL REFERENCES payment_configs(id) ON DELETE RESTRICT,
  bank_name         TEXT NOT NULL,
  account_holder    TEXT NOT NULL,
  iban_normalized   TEXT NOT NULL UNIQUE CHECK (length(iban_normalized) BETWEEN 15 AND 34 AND iban_normalized = upper(iban_normalized) AND iban_normalized NOT GLOB '* *'),
  currency          TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),
  instructions      TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  payment_config_id   TEXT NOT NULL REFERENCES payment_configs(id) ON DELETE RESTRICT,
  provider            TEXT NOT NULL CHECK (provider IN ('iyzico','bank_transfer')),
  provider_payment_id TEXT,
  conversation_id     TEXT NOT NULL UNIQUE,
  idempotency_key     TEXT NOT NULL UNIQUE,
  amount_minor        INTEGER NOT NULL CHECK (amount_minor > 0),
  currency            TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','authorized','paid','failed','cancelled','refunded','partially_refunded')),
  paid_at             TEXT,
  failure_code        TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_payment_id),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS payment_events (
  id                TEXT PRIMARY KEY,
  payment_id        TEXT REFERENCES payments(id) ON DELETE RESTRICT,
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  payload_sha256    TEXT NOT NULL,
  signature_valid   INTEGER NOT NULL CHECK (signature_valid IN (0,1)),
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','ignored','failed')),
  processed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_event_id)
) STRICT;

CREATE TABLE IF NOT EXISTS bank_transfers (
  id               TEXT PRIMARY KEY,
  payment_id       TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  bank_account_id  TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  reference_code   TEXT NOT NULL UNIQUE,
  expected_minor   INTEGER NOT NULL CHECK (expected_minor > 0),
  received_minor   INTEGER CHECK (received_minor IS NULL OR received_minor >= 0),
  receipt_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting','notified','matched','mismatch','expired','cancelled')),
  matched_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  matched_at       TEXT,
  expires_at       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status <> 'matched' OR (matched_by IS NOT NULL AND matched_at IS NOT NULL AND received_minor = expected_minor))
) STRICT;

CREATE TABLE IF NOT EXISTS refunds (
  id                 TEXT PRIMARY KEY,
  payment_id         TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_minor       INTEGER NOT NULL CHECK (amount_minor > 0),
  reason             TEXT NOT NULL,
  provider_refund_id TEXT,
  idempotency_key    TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','processing','succeeded','failed','cancelled')),
  requested_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS integrations (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('shipping','sms','email','external_search','accounting')),
  provider_code      TEXT NOT NULL,
  name               TEXT NOT NULL,
  public_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(public_config_json)),
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (kind, provider_code)
) STRICT;

CREATE TABLE IF NOT EXISTS integration_secrets (
  id                TEXT PRIMARY KEY,
  integration_id    TEXT REFERENCES integrations(id) ON DELETE CASCADE,
  payment_config_id TEXT REFERENCES payment_configs(id) ON DELETE CASCADE,
  secret_name       TEXT NOT NULL,
  ciphertext        TEXT NOT NULL,
  nonce             TEXT NOT NULL,
  auth_tag          TEXT NOT NULL,
  key_version       TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((integration_id IS NULL) <> (payment_config_id IS NULL)),
  UNIQUE (integration_id, payment_config_id, secret_name)
) STRICT;

-- The shop's single AI provider (admin: Entegrasyonlar › AI entegrasyonları). One row at most (id = 'default'):
-- choosing another provider replaces it. The API key uses the same AES-256-GCM envelope as integration_secrets
-- (master key = SECRETS_MASTER_KEY); only its last characters are kept in clear for the panel.
-- Separate table because adding 'ai' to integrations.kind would mean rebuilding a table other rows point at.
CREATE TABLE IF NOT EXISTS ai_integration (
  id                 TEXT PRIMARY KEY CHECK (id = 'default'),
  provider           TEXT NOT NULL CHECK (provider IN ('openai','gemini','anthropic')),
  model              TEXT NOT NULL CHECK (length(model) BETWEEN 2 AND 100),
  api_key_ciphertext TEXT NOT NULL,
  api_key_nonce      TEXT NOT NULL,
  api_key_auth_tag   TEXT NOT NULL,
  key_version        TEXT NOT NULL,
  api_key_hint       TEXT NOT NULL CHECK (length(api_key_hint) <= 8),
  updated_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- Models offered in the AI panel's model select (reference data, upserted at the end of this file). The panel
-- only accepts listed, non-retired models. Default model of a provider = its first 'active' row by sort_order.
-- Models are never deleted (ai_integration.model may still name one): set status 'deprecated' when the provider
-- announces a shutdown (shown with a warning), 'retired' once it is gone (hidden from the select).
CREATE TABLE IF NOT EXISTS ai_models (
  provider   TEXT NOT NULL CHECK (provider IN ('openai','gemini','anthropic')),
  model_id   TEXT NOT NULL CHECK (length(model_id) BETWEEN 2 AND 100 AND model_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
  label      TEXT NOT NULL CHECK (length(label) BETWEEN 2 AND 60),
  note       TEXT CHECK (note IS NULL OR length(note) <= 160),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','retired')),
  retires_at TEXT CHECK (retires_at IS NULL OR retires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, model_id)
) STRICT;

-- Outgoing e-mail over SMTP (password reset, later order mails). One row; the SMTP password is sealed with
-- AES-256-GCM (master key = SECRETS_MASTER_KEY) — it cannot be hashed because the server must present it to the
-- mail server. The panel never reads it back.
CREATE TABLE IF NOT EXISTS mail_integration (
  id                  TEXT PRIMARY KEY CHECK (id = 'default'),
  host                TEXT NOT NULL CHECK (length(host) BETWEEN 3 AND 253),
  port                INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  security            TEXT NOT NULL CHECK (security IN ('ssl','starttls')),
  username            TEXT NOT NULL CHECK (length(username) BETWEEN 1 AND 254),
  password_ciphertext TEXT NOT NULL,
  password_nonce      TEXT NOT NULL,
  password_auth_tag   TEXT NOT NULL,
  key_version         TEXT NOT NULL,
  from_email          TEXT NOT NULL CHECK (instr(from_email, '@') > 1 AND length(from_email) <= 254),
  from_name           TEXT NOT NULL CHECK (length(from_name) BETWEEN 1 AND 100),
  updated_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- One row per outgoing e-mail attempt (MailSender) — the panel's "Son gönderimler" list, so a failed password-reset
-- mail (sent in the background, invisible to the requester) shows why it failed. `error_*` / `stage` come from the
-- SMTP failure classifier; `server_reply` = the SMTP server's own answer (accept line with queue id, or rejection).
-- Never holds message bodies, links or passwords. Rows older than 30 days are pruned on write.
CREATE TABLE IF NOT EXISTS mail_deliveries (
  id            TEXT PRIMARY KEY,
  purpose       TEXT NOT NULL CHECK (purpose IN ('password_reset','test','other')),
  recipient     TEXT NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254),
  status        TEXT NOT NULL CHECK (status IN ('sent','failed','not_configured','throttled')),
  smtp_host     TEXT CHECK (smtp_host IS NULL OR length(smtp_host) <= 253),
  stage         TEXT CHECK (stage IS NULL OR length(stage) <= 20),
  error_code    TEXT CHECK (error_code IS NULL OR length(error_code) <= 60),
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 500),
  server_reply  TEXT CHECK (server_reply IS NULL OR length(server_reply) <= 500),
  latency_ms    INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((status = 'failed') = (error_code IS NOT NULL))
) STRICT;

-- Catalog of third-party providers offered in the panel (Entegrasyonlar › SMS / Kargo). Reference data: the upsert
-- below keeps it in sync on every schema run. support_status 'ready' = an adapter ships with the app
-- (src/modules/integrations/infrastructure/connectors); 'planned' = listed, but choosing it is refused with
-- provider_not_integrated ("firmaya bilgi verin"). credential_fields_json drives the panel form:
-- [{key, label, type: text|password|select, required, secret, placeholder?, hint?, options?, pattern?, maxLength?, default?}]
-- secret fields go to integration_secrets (secret_name = key), the others to integrations.public_config_json.
CREATE TABLE IF NOT EXISTS integration_providers (
  code                   TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 40 AND code NOT GLOB '*[^a-z0-9_]*'),
  kind                   TEXT NOT NULL CHECK (kind IN ('shipping','sms','email','external_search','accounting')),
  name                   TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  description            TEXT CHECK (description IS NULL OR length(description) <= 300),
  website                TEXT CHECK (website IS NULL OR website GLOB 'https://*'),
  support_status         TEXT NOT NULL DEFAULT 'planned' CHECK (support_status IN ('ready','planned')),
  credential_fields_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(credential_fields_json) AND json_type(credential_fields_json) = 'array'),
  capabilities_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json) AND json_type(capabilities_json) = 'array'),
  sort_order             INTEGER NOT NULL DEFAULT 0,
  is_listed              INTEGER NOT NULL DEFAULT 1 CHECK (is_listed IN (0,1)),
  CHECK (support_status = 'planned' OR json_array_length(credential_fields_json) > 0)
) STRICT;

-- One booking per shipment at the carrier. cargo_key is OUR reference sent to the carrier (stable per shipment, so an
-- outbox retry never books twice); the carrier's tracking number lands on shipments when it is assigned.
-- status: booked → closed (terminal tracking state reached, sync stops) | cancelled; failed = carrier refused (last_error).
CREATE TABLE IF NOT EXISTS carrier_shipments (
  shipment_id    TEXT PRIMARY KEY REFERENCES shipments(id) ON DELETE CASCADE,
  integration_id TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  provider_code  TEXT NOT NULL,
  cargo_key      TEXT NOT NULL CHECK (length(cargo_key) BETWEEN 4 AND 40),
  status         TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','failed','cancelled','closed')),
  carrier_status TEXT CHECK (carrier_status IS NULL OR length(carrier_status) <= 200),
  provider_ref   TEXT,
  last_error     TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),
  last_synced_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider_code, cargo_key),
  CHECK (status <> 'failed' OR last_error IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS shipping_methods (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  integration_id   TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  fee_minor        INTEGER NOT NULL CHECK (fee_minor >= 0),
  free_above_minor INTEGER CHECK (free_above_minor IS NULL OR free_above_minor > 0),
  currency         TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
) STRICT;

CREATE TABLE IF NOT EXISTS shipments (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  shipping_method_id TEXT NOT NULL REFERENCES shipping_methods(id) ON DELETE RESTRICT,
  tracking_number    TEXT,
  tracking_url       TEXT CHECK (tracking_url IS NULL OR tracking_url GLOB 'https://*'),
  status             TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','shipped','in_transit','delivered','returned','lost','cancelled')),
  shipped_at         TEXT,
  delivered_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (id, order_id)
) STRICT;

CREATE TABLE IF NOT EXISTS shipment_items (
  shipment_id   TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_id      TEXT NOT NULL,
  order_item_id TEXT NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (shipment_id, order_item_id),
  FOREIGN KEY (shipment_id, order_id) REFERENCES shipments(id, order_id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id, order_id) REFERENCES order_items(id, order_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS shipment_events (
  id                TEXT PRIMARY KEY,
  shipment_id       TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  status            TEXT NOT NULL,
  description       TEXT,
  occurred_at       TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (shipment_id, provider_event_id)
) STRICT;

-- -----------------------------------------------------------------------------
-- 7. ENGAGEMENT & OPERATIONS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wishlists (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Favorilerim',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS wishlist_items (
  wishlist_id TEXT NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (wishlist_id, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS recent_views (
  visitor_key_hash TEXT NOT NULL,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  viewed_at        TEXT NOT NULL,
  PRIMARY KEY (visitor_key_hash, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_item_id TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         TEXT CHECK (title IS NULL OR length(title) <= 120),
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','hidden')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Added 2026-11-08 (db/migrations/2026-11-08-reviews-notifications.sql): moderation, store reply, customer contact.
  variant_id        TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  is_anonymous      INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0,1)),
  verified_purchase INTEGER NOT NULL DEFAULT 0 CHECK (verified_purchase IN (0,1)),
  helpful_count     INTEGER NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
  reject_reason     TEXT CHECK (reject_reason IS NULL OR reject_reason IN ('spam','offensive','personal_data','irrelevant','advertising','other')),
  moderation_note   TEXT CHECK (moderation_note IS NULL OR length(moderation_note) <= 1000),
  moderated_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  moderated_at      TEXT,
  published_at      TEXT,
  reply_body        TEXT CHECK (reply_body IS NULL OR length(reply_body) BETWEEN 1 AND 2000),
  reply_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  replied_at        TEXT,
  contact_status    TEXT NOT NULL DEFAULT 'none' CHECK (contact_status IN ('none','contacted','resolved')),
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (product_id, user_id)
) STRICT;

-- "Faydalı buldum": one vote per signed-in customer; reviews.helpful_count is the cached total.
CREATE TABLE IF NOT EXISTS review_votes (
  review_id  TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (review_id, user_id)
) STRICT;

-- Staff ↔ reviewer contact log: e-mails sent from the panel (shown to the customer under Hesabım), phone calls and
-- internal notes (staff only).
CREATE TABLE IF NOT EXISTS review_contacts (
  id                  TEXT PRIMARY KEY,
  review_id           TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL CHECK (channel IN ('email','phone','note')),
  subject             TEXT CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 200),
  body                TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  delivery            TEXT NOT NULL DEFAULT 'logged' CHECK (delivery IN ('logged','sent','failed','not_configured')),
  visible_to_customer INTEGER NOT NULL DEFAULT 0 CHECK (visible_to_customer IN (0,1)),
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (channel <> 'email' OR subject IS NOT NULL)
) STRICT;

-- Single row (id = 1). 'manual' = every review waits for approval; 'auto_trusted' publishes verified buyers' 4–5 star
-- reviews without links / blocked words at once, everything else still waits.
CREATE TABLE IF NOT EXISTS review_settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  moderation_mode  TEXT NOT NULL DEFAULT 'manual' CHECK (moderation_mode IN ('manual','auto_trusted')),
  require_purchase INTEGER NOT NULL DEFAULT 1 CHECK (require_purchase IN (0,1)),
  allow_anonymous  INTEGER NOT NULL DEFAULT 1 CHECK (allow_anonymous IN (0,1)),
  min_body_length  INTEGER NOT NULL DEFAULT 10 CHECK (min_body_length BETWEEN 1 AND 500),
  blocked_words    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blocked_words) AND json_type(blocked_words) = 'array'),
  updated_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- Panel notifications (bell + Bildirimler): one row per event, visible to staff holding `permission` (NULL = all
-- staff). Read / archived state is per staff member. `dedupe_key` makes producers (outbox handlers) idempotent.
CREATE TABLE IF NOT EXISTS admin_notifications (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (length(type) BETWEEN 3 AND 60 AND type NOT GLOB '*[^a-z0-9_.]*'),
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','danger')),
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body        TEXT CHECK (body IS NULL OR length(body) <= 1000),
  href        TEXT CHECK (href IS NULL OR (href GLOB '/admin*' AND length(href) <= 300)),
  permission  TEXT CHECK (permission IS NULL OR length(permission) <= 60),
  entity_type TEXT,
  entity_id   TEXT,
  dedupe_key  TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS admin_notification_states (
  notification_id TEXT NOT NULL REFERENCES admin_notifications(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TEXT,
  archived_at     TEXT,
  PRIMARY KEY (notification_id, user_id)
) STRICT;

-- Per notification type (shop-wide, Bildirimler › Ayarlar): show in the panel, and e-mail to a fixed list.
-- A type without a row uses the defaults of NOTIFICATION_TYPES (code).
CREATE TABLE IF NOT EXISTS admin_notification_rules (
  type       TEXT PRIMARY KEY CHECK (length(type) BETWEEN 3 AND 60),
  in_app     INTEGER NOT NULL DEFAULT 1 CHECK (in_app IN (0,1)),
  email      INTEGER NOT NULL DEFAULT 0 CHECK (email IN (0,1)),
  email_to   TEXT CHECK (email_to IS NULL OR length(email_to) <= 500),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- Personal preference: a staff member hides one notification type for themselves.
CREATE TABLE IF NOT EXISTS admin_notification_mutes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (length(type) BETWEEN 3 AND 60),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, type)
) STRICT;

CREATE TABLE IF NOT EXISTS comparison_sessions (
  id               TEXT PRIMARY KEY,
  visitor_key_hash TEXT NOT NULL UNIQUE,
  expires_at       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS comparison_items (
  comparison_id TEXT NOT NULL REFERENCES comparison_sessions(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (comparison_id, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS external_search_jobs (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id        TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  integration_id  TEXT REFERENCES integrations(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','not_configured')),
  error_code      TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS external_offers (
  id               TEXT PRIMARY KEY,
  search_job_id    TEXT NOT NULL REFERENCES external_search_jobs(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id       TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  merchant_name    TEXT NOT NULL,
  offer_url        TEXT NOT NULL CHECK (offer_url GLOB 'http://*' OR offer_url GLOB 'https://*'),
  price_minor      INTEGER CHECK (price_minor IS NULL OR price_minor > 0),
  currency         TEXT CHECK (currency IS NULL OR length(currency) = 3),
  shipping_minor   INTEGER CHECK (shipping_minor IS NULL OR shipping_minor >= 0),
  availability     TEXT CHECK (availability IS NULL OR availability IN ('in_stock','out_of_stock','unknown')),
  match_confidence REAL CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1),
  match_basis      TEXT CHECK (match_basis IS NULL OR match_basis IN ('gtin','mpn','image','title')),
  observed_at      TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  CHECK (price_minor IS NULL OR currency IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope           TEXT NOT NULL,
  key             TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER,
  response_json   TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  status          TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (scope, key)
) STRICT;

CREATE TABLE IF NOT EXISTS outbox_events (
  id              TEXT PRIMARY KEY,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload_json    TEXT NOT NULL CHECK (json_valid(payload_json)),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed','dead')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  locked_until    TEXT,
  dedupe_key      TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS audit_logs (
  id                 TEXT PRIMARY KEY,
  actor_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  action             TEXT NOT NULL,
  entity_type        TEXT NOT NULL,
  entity_id          TEXT,
  diff_redacted_json TEXT CHECK (diff_redacted_json IS NULL OR json_valid(diff_redacted_json)),
  request_id         TEXT,
  ip_hash            TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key   TEXT NOT NULL,
  window_start TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at   TEXT NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
) STRICT;

-- Optimistic-concurrency guard for multi-statement D1 batches (D1 has no BEGIN/COMMIT).
-- core/db/unit-of-work.ts inserts `changes()` of the previous statement right after it; the triggers
-- below either skip the row (count as expected) or abort the WHOLE batch with 'batch_guard_failed:<guard>'
-- so the caller knows which guard fired. The table always stays empty, so it is safely re-created here.
DROP TABLE IF EXISTS batch_guards;
CREATE TABLE batch_guards (
  guard    INTEGER NOT NULL,
  actual   INTEGER NOT NULL,
  expected INTEGER NOT NULL
) STRICT;

-- =============================================================================
-- INDEXES
-- =============================================================================
-- partial unique: business "only one" rules
CREATE UNIQUE INDEX IF NOT EXISTS ux_variants_one_default      ON product_variants(product_id) WHERE is_default = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_categories_primary ON product_categories(product_id) WHERE is_primary = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_media_primary      ON product_media(product_id) WHERE is_primary = 1 AND variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_home_one_hero              ON home_sections(section_type) WHERE section_type = 'hero_slider' AND is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_addresses_default_ship     ON addresses(user_id) WHERE is_default_shipping = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_addresses_default_bill     ON addresses(user_id) WHERE is_default_billing = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_carts_active_user          ON carts(user_id) WHERE status = 'active' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_config_active    ON payment_configs(provider) WHERE is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_integration_active_kind   ON integrations(kind) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS ix_integration_providers_kind        ON integration_providers(kind, sort_order);
CREATE INDEX IF NOT EXISTS ix_mail_deliveries_created            ON mail_deliveries(created_at);
CREATE INDEX IF NOT EXISTS ix_carrier_shipments_sync            ON carrier_shipments(status, last_synced_at);
-- lookups
CREATE INDEX IF NOT EXISTS ix_sessions_user              ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS ix_user_roles_role            ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS ix_verification_user_purpose  ON verification_tokens(user_id, purpose, consumed_at);
CREATE INDEX IF NOT EXISTS ix_users_created              ON users(created_at);
CREATE INDEX IF NOT EXISTS ix_addresses_user             ON addresses(user_id);
CREATE INDEX IF NOT EXISTS ix_categories_parent          ON categories(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_products_brand_status      ON products(brand_id, status);
CREATE INDEX IF NOT EXISTS ix_products_status_published  ON products(status, published_at DESC);
CREATE INDEX IF NOT EXISTS ix_product_categories_cat     ON product_categories(category_id, product_id);
CREATE INDEX IF NOT EXISTS ix_variants_product           ON product_variants(product_id, is_active);
CREATE INDEX IF NOT EXISTS ix_product_media_product      ON product_media(product_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_pav_attr_option            ON product_attribute_values(attribute_id, option_id, product_id);
CREATE INDEX IF NOT EXISTS ix_pav_attr_number            ON product_attribute_values(attribute_id, number_value);
CREATE INDEX IF NOT EXISTS ix_variant_options_option     ON variant_options(attribute_id, option_id, variant_id);
CREATE INDEX IF NOT EXISTS ix_variant_prices_price       ON variant_prices(price_list_id, unit_price_minor);
CREATE INDEX IF NOT EXISTS ix_inv_movements_variant      ON inventory_movements(variant_id, created_at);
CREATE INDEX IF NOT EXISTS ix_stock_res_status_exp       ON stock_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS ix_stock_res_checkout         ON stock_reservations(checkout_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_content_pages_legal_type ON content_pages(legal_type) WHERE legal_type IS NOT NULL AND status <> 'archived';
CREATE INDEX IF NOT EXISTS ix_content_pages_footer       ON content_pages(status, footer_column, footer_order);
CREATE INDEX IF NOT EXISTS ix_site_settings_group        ON site_settings(group_name);
CREATE INDEX IF NOT EXISTS ix_nav_items_menu             ON navigation_items(menu_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_stories_collection         ON stories(collection_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS ix_slides_slider              ON slides(slider_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS ix_home_sections_order        ON home_sections(is_active, sort_order);
CREATE INDEX IF NOT EXISTS ix_campaigns_active_window    ON campaigns(is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS ix_campaign_conditions          ON campaign_conditions(campaign_id);
CREATE INDEX IF NOT EXISTS ix_bulk_jobs_created             ON bulk_jobs(created_at);
CREATE INDEX IF NOT EXISTS ix_catalog_change_log_created    ON catalog_change_log(created_at);
CREATE INDEX IF NOT EXISTS ix_integration_messages_topic    ON integration_messages(topic, id);
CREATE INDEX IF NOT EXISTS ix_marketplace_listings_status   ON marketplace_listings(connection_id, status);
CREATE INDEX IF NOT EXISTS ix_marketplace_listings_product  ON marketplace_listings(product_id);
CREATE INDEX IF NOT EXISTS ix_marketplace_orders_status     ON marketplace_orders(connection_id, status);
CREATE INDEX IF NOT EXISTS ix_marketplace_batches_open      ON marketplace_batches(connection_id, status);
CREATE INDEX IF NOT EXISTS ix_marketplace_category_cache_path ON marketplace_category_cache(provider, path);
CREATE INDEX IF NOT EXISTS ix_product_feeds_due             ON product_feeds(is_active, next_run_at);
CREATE INDEX IF NOT EXISTS ix_product_feed_items_seen       ON product_feed_items(feed_id, last_seen_at);
CREATE INDEX IF NOT EXISTS ix_products_accounting_code      ON products(accounting_code);
CREATE INDEX IF NOT EXISTS ix_products_manufacturer_code    ON products(manufacturer_code);
CREATE INDEX IF NOT EXISTS ix_coupon_red_coupon_status   ON coupon_redemptions(coupon_id, status, customer_key_hash);
CREATE INDEX IF NOT EXISTS ix_campaign_alloc_status      ON campaign_allocations(campaign_id, status);
CREATE INDEX IF NOT EXISTS ix_cart_items_cart            ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS ix_checkout_status_exp        ON checkout_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS ix_orders_user_placed         ON orders(user_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_status_placed       ON orders(status, payment_status, placed_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_placed              ON orders(placed_at);
CREATE INDEX IF NOT EXISTS ix_orders_email               ON orders(customer_email);
CREATE INDEX IF NOT EXISTS ix_order_items_order          ON order_items(order_id);
CREATE INDEX IF NOT EXISTS ix_order_events_order         ON order_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS ix_payments_order             ON payments(order_id, status);
CREATE INDEX IF NOT EXISTS ix_bank_transfers_status      ON bank_transfers(status, expires_at);
CREATE INDEX IF NOT EXISTS ix_refunds_payment            ON refunds(payment_id, status);
CREATE INDEX IF NOT EXISTS ix_shipments_order            ON shipments(order_id);
CREATE INDEX IF NOT EXISTS ix_reviews_product_status     ON reviews(product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_reviews_status_created     ON reviews(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_reviews_user                ON reviews(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_review_votes_user           ON review_votes(user_id);
CREATE INDEX IF NOT EXISTS ix_review_contacts_review      ON review_contacts(review_id, created_at);
CREATE INDEX IF NOT EXISTS ix_admin_notifications_created ON admin_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_admin_notifications_type    ON admin_notifications(type, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_admin_notif_states_user     ON admin_notification_states(user_id, read_at);
CREATE INDEX IF NOT EXISTS ix_recent_views_visitor       ON recent_views(visitor_key_hash, viewed_at DESC);
CREATE INDEX IF NOT EXISTS ix_external_offers_product    ON external_offers(product_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_outbox_pending             ON outbox_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_audit_entity               ON audit_logs(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS ix_audit_created              ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS ix_audit_actor                ON audit_logs(actor_id, created_at);
CREATE INDEX IF NOT EXISTS ix_audit_request              ON audit_logs(request_id);
CREATE INDEX IF NOT EXISTS ix_rate_limit_expires         ON rate_limit_buckets(expires_at);

-- =============================================================================
-- TRIGGERS
-- =============================================================================
DROP TRIGGER IF EXISTS trg_categories_no_cycle_ins;
DROP TRIGGER IF EXISTS trg_categories_no_cycle_upd;
DROP TRIGGER IF EXISTS trg_nav_items_no_cycle_upd;
DROP TRIGGER IF EXISTS trg_nav_items_same_menu;
DROP TRIGGER IF EXISTS trg_pav_type_ins;
DROP TRIGGER IF EXISTS trg_pav_type_upd;
DROP TRIGGER IF EXISTS trg_variant_options_axis;
DROP TRIGGER IF EXISTS trg_stock_res_check;
DROP TRIGGER IF EXISTS trg_stock_res_apply;
DROP TRIGGER IF EXISTS trg_stock_res_guard;
DROP TRIGGER IF EXISTS trg_stock_res_transition;
DROP TRIGGER IF EXISTS trg_inv_movements_no_update;
DROP TRIGGER IF EXISTS trg_inv_movements_no_delete;
DROP TRIGGER IF EXISTS trg_order_events_no_update;
DROP TRIGGER IF EXISTS trg_order_events_no_delete;
DROP TRIGGER IF EXISTS trg_audit_no_update;
DROP TRIGGER IF EXISTS trg_audit_no_delete;
DROP TRIGGER IF EXISTS trg_order_amounts_immutable;
DROP TRIGGER IF EXISTS trg_order_items_immutable;
DROP TRIGGER IF EXISTS trg_campaign_capacity;
DROP TRIGGER IF EXISTS trg_coupon_limits;
DROP TRIGGER IF EXISTS trg_campaign_activate_targets;
DROP TRIGGER IF EXISTS trg_payment_paid_terminal;
DROP TRIGGER IF EXISTS trg_batch_guard_fail;
DROP TRIGGER IF EXISTS trg_batch_guard_pass;

-- category tree: no cycles (insert can only create a cycle via self-reference, blocked by CHECK;
-- kept for completeness when ids are reused)
CREATE TRIGGER IF NOT EXISTS trg_categories_no_cycle_ins
BEFORE INSERT ON categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'category_parent_missing')
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.parent_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_no_cycle_upd
BEFORE UPDATE OF parent_id ON categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'category_cycle')
  WHERE EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_id
      UNION
      SELECT c.parent_id FROM categories c JOIN ancestors a ON c.id = a.id WHERE c.parent_id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_nav_items_no_cycle_upd
BEFORE UPDATE OF parent_id ON navigation_items
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'navigation_cycle')
  WHERE EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT NEW.parent_id
      UNION
      SELECT n.parent_id FROM navigation_items n JOIN ancestors a ON n.id = a.id WHERE n.parent_id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_nav_items_same_menu
BEFORE INSERT ON navigation_items
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'navigation_parent_other_menu')
  WHERE (SELECT menu_id FROM navigation_items WHERE id = NEW.parent_id) IS NOT NEW.menu_id;
END;

-- typed attribute values: filled column must match attribute data_type
CREATE TRIGGER IF NOT EXISTS trg_pav_type_ins
BEFORE INSERT ON product_attribute_values
BEGIN
  SELECT RAISE(ABORT, 'attribute_type_mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM attribute_definitions d WHERE d.id = NEW.attribute_id AND (
         (d.data_type = 'text'    AND NEW.text_value    IS NOT NULL)
      OR (d.data_type = 'number'  AND NEW.number_value  IS NOT NULL)
      OR (d.data_type = 'boolean' AND NEW.boolean_value IS NOT NULL)
      OR (d.data_type IN ('select','multiselect') AND NEW.option_id IS NOT NULL)
    )
  );
  SELECT RAISE(ABORT, 'attribute_single_value')
  WHERE NEW.value_index > 0
    AND (SELECT data_type FROM attribute_definitions WHERE id = NEW.attribute_id) <> 'multiselect';
END;

CREATE TRIGGER IF NOT EXISTS trg_pav_type_upd
BEFORE UPDATE ON product_attribute_values
BEGIN
  SELECT RAISE(ABORT, 'attribute_type_mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM attribute_definitions d WHERE d.id = NEW.attribute_id AND (
         (d.data_type = 'text'    AND NEW.text_value    IS NOT NULL)
      OR (d.data_type = 'number'  AND NEW.number_value  IS NOT NULL)
      OR (d.data_type = 'boolean' AND NEW.boolean_value IS NOT NULL)
      OR (d.data_type IN ('select','multiselect') AND NEW.option_id IS NOT NULL)
    )
  );
END;

-- SKU option must use an axis assigned to the variant's product
CREATE TRIGGER IF NOT EXISTS trg_variant_options_axis
BEFORE INSERT ON variant_options
BEGIN
  SELECT RAISE(ABORT, 'variant_axis_not_assigned')
  WHERE NOT EXISTS (
    SELECT 1 FROM product_variants v
    JOIN product_variant_axes ax ON ax.product_id = v.product_id AND ax.attribute_id = NEW.attribute_id
    WHERE v.id = NEW.variant_id
  );
END;

-- atomic stock reservation
CREATE TRIGGER IF NOT EXISTS trg_stock_res_check
BEFORE INSERT ON stock_reservations
WHEN NEW.status = 'reserved'
BEGIN
  SELECT RAISE(ABORT, 'insufficient_stock')
  WHERE COALESCE((SELECT on_hand - reserved FROM inventory_balances
                  WHERE variant_id = NEW.variant_id AND warehouse_id = NEW.warehouse_id), 0) < NEW.quantity;
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_res_apply
AFTER INSERT ON stock_reservations
WHEN NEW.status = 'reserved'
BEGIN
  UPDATE inventory_balances
     SET reserved = reserved + NEW.quantity,
         version = version + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE variant_id = NEW.variant_id AND warehouse_id = NEW.warehouse_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_res_guard
BEFORE UPDATE ON stock_reservations
BEGIN
  SELECT RAISE(ABORT, 'reservation_immutable_fields')
  WHERE NEW.quantity <> OLD.quantity OR NEW.variant_id <> OLD.variant_id OR NEW.warehouse_id <> OLD.warehouse_id;
  SELECT RAISE(ABORT, 'reservation_terminal')
  WHERE OLD.status <> 'reserved' AND NEW.status <> OLD.status;
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_res_transition
AFTER UPDATE OF status ON stock_reservations
WHEN OLD.status = 'reserved' AND NEW.status <> 'reserved'
BEGIN
  UPDATE inventory_balances
     SET on_hand  = on_hand  - CASE WHEN NEW.status = 'committed' THEN NEW.quantity ELSE 0 END,
         reserved = reserved - NEW.quantity,
         version = version + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE variant_id = NEW.variant_id AND warehouse_id = NEW.warehouse_id;
END;

-- append-only ledgers
CREATE TRIGGER IF NOT EXISTS trg_inv_movements_no_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_inv_movements_no_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_order_events_no_update BEFORE UPDATE ON order_events
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_order_events_no_delete BEFORE DELETE ON order_events
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'append_only'); END;

-- order snapshots are immutable after placement
CREATE TRIGGER IF NOT EXISTS trg_order_amounts_immutable
BEFORE UPDATE OF subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, currency, checkout_id, order_number ON orders
BEGIN
  SELECT RAISE(ABORT, 'order_snapshot_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_order_items_immutable
BEFORE UPDATE ON order_items
BEGIN
  SELECT RAISE(ABORT, 'order_snapshot_immutable');
END;

-- campaign capacity (last-unit race is decided inside one D1 write)
CREATE TRIGGER IF NOT EXISTS trg_campaign_capacity
BEFORE INSERT ON campaign_allocations
WHEN NEW.status = 'reserved'
BEGIN
  SELECT RAISE(ABORT, 'campaign_capacity_exceeded')
  WHERE (SELECT capacity_units FROM campaigns WHERE id = NEW.campaign_id) IS NOT NULL
    AND (SELECT COALESCE(SUM(units),0) FROM campaign_allocations
          WHERE campaign_id = NEW.campaign_id AND status IN ('reserved','committed')) + NEW.units
        > (SELECT capacity_units FROM campaigns WHERE id = NEW.campaign_id);
END;

-- coupon global and per-customer limits
CREATE TRIGGER IF NOT EXISTS trg_coupon_limits
BEFORE INSERT ON coupon_redemptions
WHEN NEW.status = 'reserved'
BEGIN
  SELECT RAISE(ABORT, 'coupon_inactive')
  WHERE NOT EXISTS (SELECT 1 FROM coupons WHERE id = NEW.coupon_id AND is_active = 1);
  SELECT RAISE(ABORT, 'coupon_limit_reached')
  WHERE (SELECT max_redemptions FROM coupons WHERE id = NEW.coupon_id) IS NOT NULL
    AND (SELECT COUNT(*) FROM coupon_redemptions WHERE coupon_id = NEW.coupon_id AND status IN ('reserved','committed'))
        >= (SELECT max_redemptions FROM coupons WHERE id = NEW.coupon_id);
  SELECT RAISE(ABORT, 'coupon_customer_limit_reached')
  WHERE (SELECT COUNT(*) FROM coupon_redemptions
          WHERE coupon_id = NEW.coupon_id AND customer_key_hash = NEW.customer_key_hash AND status IN ('reserved','committed'))
        >= (SELECT per_customer_limit FROM coupons WHERE id = NEW.coupon_id);
END;

-- a "selected" campaign needs at least one include target before activation
CREATE TRIGGER IF NOT EXISTS trg_campaign_activate_targets
BEFORE UPDATE OF is_active ON campaigns
WHEN NEW.is_active = 1 AND NEW.target_mode = 'selected'
BEGIN
  SELECT RAISE(ABORT, 'campaign_without_targets')
  WHERE NOT EXISTS (SELECT 1 FROM campaign_products   WHERE campaign_id = NEW.id AND mode = 'include')
    AND NOT EXISTS (SELECT 1 FROM campaign_brands     WHERE campaign_id = NEW.id AND mode = 'include')
    AND NOT EXISTS (SELECT 1 FROM campaign_categories WHERE campaign_id = NEW.id AND mode = 'include');
END;

-- a paid payment can only move to refund states
CREATE TRIGGER IF NOT EXISTS trg_payment_paid_terminal
BEFORE UPDATE OF status ON payments
WHEN OLD.status = 'paid' AND NEW.status NOT IN ('paid','refunded','partially_refunded')
BEGIN
  SELECT RAISE(ABORT, 'payment_paid_terminal');
END;

-- batch guard: abort the batch when the guarded statement did not change the expected number of rows
CREATE TRIGGER IF NOT EXISTS trg_batch_guard_fail
BEFORE INSERT ON batch_guards
WHEN NEW.actual <> NEW.expected
BEGIN
  SELECT RAISE(ABORT, 'batch_guard_failed:' || NEW.guard);
END;

CREATE TRIGGER IF NOT EXISTS trg_batch_guard_pass
BEFORE INSERT ON batch_guards
WHEN NEW.actual = NEW.expected
BEGIN
  SELECT RAISE(IGNORE);
END;

-- Provider catalog (see integration_providers). Upsert: re-running the schema refreshes names, fields and status.
INSERT INTO integration_providers (code, kind, name, description, website, support_status, credential_fields_json, capabilities_json, sort_order) VALUES
 ('yurtici','shipping','Yurtiçi Kargo','Gönderi kaydı (createShipment), takip numarası ve durum sorgulama (queryShipment), iptal.','https://www.yurticikargo.com','ready',
  '[{"key":"environment","label":"Ortam","type":"select","required":true,"secret":false,"default":"test","options":[{"value":"test","label":"Test (testws.yurticikargo.com)"},{"value":"live","label":"Canlı"}],"hint":"Canlıya geçmeden önce Yurtiçi''nin verdiği test kullanıcısıyla deneyin."},{"key":"username","label":"Web servis kullanıcı adı","type":"text","required":true,"secret":false,"placeholder":"YKTEST","maxLength":60,"hint":"Yurtiçi Kargo müşteri temsilcinizden alınır (gönderici ödemeli hesap)."},{"key":"password","label":"Web servis şifresi","type":"password","required":true,"secret":true,"maxLength":100}]',
  '["create_shipment","tracking"]',10),
 ('aras','shipping','Aras Kargo','Gönderi kaydı ve takip.','https://www.araskargo.com.tr','planned','[]','[]',20),
 ('mng','shipping','MNG Kargo (DHL eCommerce)','Gönderi kaydı ve takip.','https://www.mngkargo.com.tr','planned','[]','[]',30),
 ('ptt','shipping','PTT Kargo','Gönderi kaydı ve barkod.','https://www.ptt.gov.tr','planned','[]','[]',40),
 ('surat','shipping','Sürat Kargo','Gönderi kaydı ve takip.','https://www.suratkargo.com.tr','planned','[]','[]',50),
 ('hepsijet','shipping','HepsiJET','Gönderi kaydı ve takip.','https://www.hepsijet.com','planned','[]','[]',60),
 ('kolaygelsin','shipping','Kolay Gelsin','Gönderi kaydı ve takip.','https://www.kolaygelsin.com','planned','[]','[]',70),
 ('sendeo','shipping','Sendeo','Gönderi kaydı ve takip.','https://www.sendeo.com.tr','planned','[]','[]',80),
 ('ups','shipping','UPS Kargo','Gönderi kaydı ve takip.','https://www.ups.com.tr','planned','[]','[]',90),
 ('dhl_express','shipping','DHL Express','Yurt dışı gönderi kaydı ve takip.','https://www.dhl.com','planned','[]','[]',100),
 ('netgsm','sms','Netgsm','Sipariş ve kargo bildirimleri (REST v2, Türkçe karakter).','https://www.netgsm.com.tr','ready',
  '[{"key":"usercode","label":"Kullanıcı adı (abone no)","type":"text","required":true,"secret":false,"placeholder":"850XXXXXXX","maxLength":30,"pattern":"^[0-9A-Za-z._-]{3,30}$"},{"key":"password","label":"API şifresi","type":"password","required":true,"secret":true,"maxLength":100,"hint":"Netgsm panelinde API yetkisi verilen alt kullanıcının şifresi."},{"key":"msgheader","label":"Gönderici adı (SMS başlığı)","type":"text","required":true,"secret":false,"placeholder":"MAGAZAADI","maxLength":11,"hint":"Netgsm''de onaylı başlığınız; harfi harfine aynı yazılmalı."}]',
  '["send_sms","turkish_chars"]',10),
 ('iletimerkezi','sms','İleti Merkezi','Toplu ve bilgilendirme SMS''i.','https://www.iletimerkezi.com','planned','[]','[]',20),
 ('mutlucell','sms','Mutlucell','Toplu ve bilgilendirme SMS''i.','https://www.mutlucell.com.tr','planned','[]','[]',30),
 ('verimor','sms','Verimor','Toplu ve bilgilendirme SMS''i.','https://www.verimor.com.tr','planned','[]','[]',40),
 ('jetsms','sms','JetSMS','Toplu ve bilgilendirme SMS''i.','https://www.jetsms.com.tr','planned','[]','[]',50),
 ('vatansms','sms','Vatan SMS','Toplu ve bilgilendirme SMS''i.','https://www.vatansms.com','planned','[]','[]',60),
 ('organiksms','sms','Organik SMS','Toplu ve bilgilendirme SMS''i.','https://www.organikhaberlesme.com','planned','[]','[]',70),
 ('twilio','sms','Twilio','Uluslararası SMS.','https://www.twilio.com','planned','[]','[]',80)
ON CONFLICT (code) DO UPDATE SET
  kind = excluded.kind, name = excluded.name, description = excluded.description, website = excluded.website,
  support_status = excluded.support_status, credential_fields_json = excluded.credential_fields_json,
  capabilities_json = excluded.capabilities_json, sort_order = excluded.sort_order;

-- AI model catalog (see ai_models). Upsert: re-running the schema refreshes labels, notes and status. Check a list
-- against real keys with `npm run ai:health` (scripts/ai-health.mjs reads the rows below). Sources (2026-11):
-- developers.openai.com/api/docs/models + /deprecations, aistudio.google.com/docs/models, platform.claude.com/docs/en/about-claude/models.
INSERT INTO ai_models (provider, model_id, label, note, status, retires_at, sort_order) VALUES
 ('openai','gpt-6.1-terra','GPT-6.1 Terra','Hızlı ve ekonomik; ürün metinleri için önerilir','active',NULL,10),
 ('openai','gpt-6.1-sol','GPT-6.1 Sol','Hız ve kalite dengesi','active',NULL,20),
 ('openai','gpt-6-luna','GPT-6 Luna','En düşük maliyet, yüksek hacim','active',NULL,30),
 ('openai','gpt-6-astra','GPT-6 Astra','En güçlü model, daha yavaş ve pahalı','active',NULL,40),
 ('openai','gpt-4.1-mini','GPT-4.1 mini','Yerine GPT-6 Luna önerilir.','deprecated','2027-01-14',90),
 ('openai','gpt-4.1','GPT-4.1','Yerine GPT-6 Luna önerilir.','deprecated','2027-01-14',91),
 ('openai','gpt-4o','GPT-4o','Yerine GPT-6 Luna önerilir.','deprecated','2027-01-14',92),
 ('gemini','gemini-3.6-flash','Gemini 3.6 Flash','Kararlı ve hızlı; ürün metinleri için önerilir','active',NULL,10),
 ('gemini','gemini-3.5-flash-lite','Gemini 3.5 Flash-Lite','Kararlı, en düşük maliyet','active',NULL,20),
 ('gemini','gemini-3.8-flash','Gemini 3.8 Flash','Yeni; yoğun saatlerde meşgul olabilir','active',NULL,30),
 ('gemini','gemini-4-argon','Gemini 4 Argon','En güçlü model, daha yavaş ve pahalı','active',NULL,40),
 ('gemini','gemini-2.5-flash','Gemini 2.5 Flash','İstekler Gemini 3.5 Flash-Lite''a yönlendirilecek.','deprecated','2026-12-01',90),
 ('gemini','gemini-2.5-pro','Gemini 2.5 Pro','İstekler Gemini 3.8 Flash''a yönlendirilecek.','deprecated','2026-12-01',91),
 ('anthropic','claude-sonnet-5-5','Claude Sonnet 5.5','Hız ve kalite dengesi; ürün metinleri için önerilir','active',NULL,10),
 ('anthropic','claude-haiku-5-5','Claude Haiku 5.5','En hızlı ve en ekonomik','active',NULL,20),
 ('anthropic','claude-opus-5-5','Claude Opus 5.5','Daha güçlü, daha yavaş ve pahalı','active',NULL,30),
 ('anthropic','claude-fable-5-1','Claude Fable 5.1','En güçlü model, en yavaş ve en pahalı','active',NULL,40)
ON CONFLICT (provider, model_id) DO UPDATE SET
  label = excluded.label, note = excluded.note, status = excluded.status, retires_at = excluded.retires_at, sort_order = excluded.sort_order;

-- Campaign rules (see pricing_policy). Insert only: the panel owns the values afterwards.
INSERT OR IGNORE INTO pricing_policy (id, conflict_strategy, max_discount_bps) VALUES (1, 'priority', 5000);

-- -----------------------------------------------------------------------------
-- Change data capture for integrations (catalog_change_log; see section 4c). AFTER triggers only: they never
-- block a write. Stock is captured only when the sellable amount (on_hand − reserved) changes.
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_ccl_products
AFTER UPDATE OF name, short_description, description_html, brand_id, status, tax_rate_bps, accounting_code, manufacturer_code, country_of_origin, model_code ON products
BEGIN
  INSERT INTO catalog_change_log (kind, product_id) VALUES ('content', NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_variants_ins
AFTER INSERT ON product_variants
BEGIN
  INSERT INTO catalog_change_log (kind, product_id, variant_id) VALUES ('content', NEW.product_id, NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_variants_upd
AFTER UPDATE OF sku, barcode, name, is_active, weight_grams, width_mm, height_mm, depth_mm ON product_variants
BEGIN
  INSERT INTO catalog_change_log (kind, product_id, variant_id) VALUES ('content', NEW.product_id, NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_categories_ins
AFTER INSERT ON product_categories
BEGIN
  INSERT INTO catalog_change_log (kind, product_id) VALUES ('content', NEW.product_id);
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_attributes_ins
AFTER INSERT ON product_attribute_values
BEGIN
  INSERT INTO catalog_change_log (kind, product_id) VALUES ('content', NEW.product_id);
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_attributes_del
AFTER DELETE ON product_attribute_values
BEGIN
  INSERT INTO catalog_change_log (kind, product_id) VALUES ('content', OLD.product_id);
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_media_ins
AFTER INSERT ON product_media
BEGIN
  INSERT INTO catalog_change_log (kind, product_id, variant_id) VALUES ('images', NEW.product_id, NEW.variant_id);
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_media_del
AFTER DELETE ON product_media
BEGIN
  INSERT INTO catalog_change_log (kind, product_id, variant_id) VALUES ('images', OLD.product_id, OLD.variant_id);
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_prices_ins
AFTER INSERT ON variant_prices
BEGIN
  INSERT INTO catalog_change_log (kind, product_id, variant_id) SELECT 'price', product_id, id FROM product_variants WHERE id = NEW.variant_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_prices_upd
AFTER UPDATE OF unit_price_minor, compare_at_minor ON variant_prices
BEGIN
  INSERT INTO catalog_change_log (kind, product_id, variant_id) SELECT 'price', product_id, id FROM product_variants WHERE id = NEW.variant_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_stock_ins
AFTER INSERT ON inventory_balances
BEGIN
  INSERT INTO catalog_change_log (kind, product_id, variant_id) SELECT 'stock', product_id, id FROM product_variants WHERE id = NEW.variant_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_ccl_stock_upd
AFTER UPDATE OF on_hand, reserved ON inventory_balances
WHEN NEW.on_hand - NEW.reserved <> OLD.on_hand - OLD.reserved
BEGIN
  INSERT INTO catalog_change_log (kind, product_id, variant_id) SELECT 'stock', product_id, id FROM product_variants WHERE id = NEW.variant_id;
END;

-- Integrations reference rows (insert only).
INSERT OR IGNORE INTO integration_relay_state (id, last_change_id) VALUES (1, 0);
INSERT OR IGNORE INTO barcode_sequences (id, prefix, next_value) VALUES ('default', '2000000', 1);

-- Reviews / notifications reference rows (insert only: the panel owns the values afterwards).
INSERT OR IGNORE INTO review_settings (id) VALUES (1);

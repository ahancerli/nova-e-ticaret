-- =============================================================================
-- NOVA E-COMMERCE — SINGLE DDL SCRIPT (Cloudflare D1 / SQLite)
-- 87 STRICT tables · 47 indexes · 23 triggers
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

CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employee_code TEXT UNIQUE,
  department    TEXT,
  mfa_required  INTEGER NOT NULL DEFAULT 1 CHECK (mfa_required IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE IF NOT EXISTS roles (
  id        TEXT PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1))
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
  purpose     TEXT NOT NULL CHECK (purpose IN ('email_verify','password_reset','phone_verify','guest_order_view')),
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
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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

CREATE TABLE IF NOT EXISTS home_sections (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  section_type        TEXT NOT NULL CHECK (section_type IN ('hero_slider','story_strip','product_carousel','product_grid','category_tiles','brand_strip','banner','recently_viewed')),
  slider_id           TEXT REFERENCES sliders(id) ON DELETE SET NULL,
  story_collection_id TEXT REFERENCES story_collections(id) ON DELETE SET NULL,
  selection_mode      TEXT NOT NULL DEFAULT 'manual' CHECK (selection_mode IN ('manual','popular','new','discounted','rule')),
  settings_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  starts_at           TEXT,
  ends_at             TEXT,
  CHECK (section_type <> 'hero_slider' OR slider_id IS NOT NULL),
  CHECK (section_type <> 'story_strip' OR story_collection_id IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS home_section_products (
  section_id TEXT NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (section_id, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS content_pages (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  body_html    TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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

CREATE TABLE IF NOT EXISTS site_settings (
  key            TEXT PRIMARY KEY,
  group_name     TEXT NOT NULL CHECK (group_name IN ('general','contact','branding','seo','social','checkout','shipping','legal')),
  value_json     TEXT NOT NULL CHECK (json_valid(value_json)),
  is_public      INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  schema_version INTEGER NOT NULL DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS coupons (
  id                 TEXT PRIMARY KEY,
  campaign_id        TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  code_normalized    TEXT NOT NULL UNIQUE CHECK (code_normalized = upper(trim(code_normalized)) AND length(code_normalized) BETWEEN 3 AND 40),
  max_redemptions    INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  per_customer_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  starts_at          TEXT,
  ends_at            TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  UNIQUE (product_id, user_id)
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
-- lookups
CREATE INDEX IF NOT EXISTS ix_sessions_user              ON sessions(user_id, expires_at);
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
CREATE INDEX IF NOT EXISTS ix_nav_items_menu             ON navigation_items(menu_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_stories_collection         ON stories(collection_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS ix_slides_slider              ON slides(slider_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS ix_home_sections_order        ON home_sections(is_active, sort_order);
CREATE INDEX IF NOT EXISTS ix_campaigns_active_window    ON campaigns(is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS ix_coupon_red_coupon_status   ON coupon_redemptions(coupon_id, status, customer_key_hash);
CREATE INDEX IF NOT EXISTS ix_campaign_alloc_status      ON campaign_allocations(campaign_id, status);
CREATE INDEX IF NOT EXISTS ix_cart_items_cart            ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS ix_checkout_status_exp        ON checkout_sessions(status, expires_at);
CREATE INDEX IF NOT EXISTS ix_orders_user_placed         ON orders(user_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_status_placed       ON orders(status, payment_status, placed_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_email               ON orders(customer_email);
CREATE INDEX IF NOT EXISTS ix_order_items_order          ON order_items(order_id);
CREATE INDEX IF NOT EXISTS ix_order_events_order         ON order_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS ix_payments_order             ON payments(order_id, status);
CREATE INDEX IF NOT EXISTS ix_bank_transfers_status      ON bank_transfers(status, expires_at);
CREATE INDEX IF NOT EXISTS ix_refunds_payment            ON refunds(payment_id, status);
CREATE INDEX IF NOT EXISTS ix_shipments_order            ON shipments(order_id);
CREATE INDEX IF NOT EXISTS ix_reviews_product_status     ON reviews(product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_recent_views_visitor       ON recent_views(visitor_key_hash, viewed_at DESC);
CREATE INDEX IF NOT EXISTS ix_external_offers_product    ON external_offers(product_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ix_outbox_pending             ON outbox_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_audit_entity               ON audit_logs(entity_type, entity_id, created_at);
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

-- category tree: no cycles (insert can only create a cycle via self-reference, blocked by CHECK;
-- kept for completeness when ids are reused)
CREATE TRIGGER trg_categories_no_cycle_ins
BEFORE INSERT ON categories
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'category_parent_missing')
  WHERE NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.parent_id);
END;

CREATE TRIGGER trg_categories_no_cycle_upd
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

CREATE TRIGGER trg_nav_items_no_cycle_upd
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

CREATE TRIGGER trg_nav_items_same_menu
BEFORE INSERT ON navigation_items
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'navigation_parent_other_menu')
  WHERE (SELECT menu_id FROM navigation_items WHERE id = NEW.parent_id) IS NOT NEW.menu_id;
END;

-- typed attribute values: filled column must match attribute data_type
CREATE TRIGGER trg_pav_type_ins
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

CREATE TRIGGER trg_pav_type_upd
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
CREATE TRIGGER trg_variant_options_axis
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
CREATE TRIGGER trg_stock_res_check
BEFORE INSERT ON stock_reservations
WHEN NEW.status = 'reserved'
BEGIN
  SELECT RAISE(ABORT, 'insufficient_stock')
  WHERE COALESCE((SELECT on_hand - reserved FROM inventory_balances
                  WHERE variant_id = NEW.variant_id AND warehouse_id = NEW.warehouse_id), 0) < NEW.quantity;
END;

CREATE TRIGGER trg_stock_res_apply
AFTER INSERT ON stock_reservations
WHEN NEW.status = 'reserved'
BEGIN
  UPDATE inventory_balances
     SET reserved = reserved + NEW.quantity,
         version = version + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE variant_id = NEW.variant_id AND warehouse_id = NEW.warehouse_id;
END;

CREATE TRIGGER trg_stock_res_guard
BEFORE UPDATE ON stock_reservations
BEGIN
  SELECT RAISE(ABORT, 'reservation_immutable_fields')
  WHERE NEW.quantity <> OLD.quantity OR NEW.variant_id <> OLD.variant_id OR NEW.warehouse_id <> OLD.warehouse_id;
  SELECT RAISE(ABORT, 'reservation_terminal')
  WHERE OLD.status <> 'reserved' AND NEW.status <> OLD.status;
END;

CREATE TRIGGER trg_stock_res_transition
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
CREATE TRIGGER trg_inv_movements_no_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER trg_inv_movements_no_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER trg_order_events_no_update BEFORE UPDATE ON order_events
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER trg_order_events_no_delete BEFORE DELETE ON order_events
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'append_only'); END;

-- order snapshots are immutable after placement
CREATE TRIGGER trg_order_amounts_immutable
BEFORE UPDATE OF subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, currency, checkout_id, order_number ON orders
BEGIN
  SELECT RAISE(ABORT, 'order_snapshot_immutable');
END;

CREATE TRIGGER trg_order_items_immutable
BEFORE UPDATE ON order_items
BEGIN
  SELECT RAISE(ABORT, 'order_snapshot_immutable');
END;

-- campaign capacity (last-unit race is decided inside one D1 write)
CREATE TRIGGER trg_campaign_capacity
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
CREATE TRIGGER trg_coupon_limits
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
CREATE TRIGGER trg_campaign_activate_targets
BEFORE UPDATE OF is_active ON campaigns
WHEN NEW.is_active = 1 AND NEW.target_mode = 'selected'
BEGIN
  SELECT RAISE(ABORT, 'campaign_without_targets')
  WHERE NOT EXISTS (SELECT 1 FROM campaign_products   WHERE campaign_id = NEW.id AND mode = 'include')
    AND NOT EXISTS (SELECT 1 FROM campaign_brands     WHERE campaign_id = NEW.id AND mode = 'include')
    AND NOT EXISTS (SELECT 1 FROM campaign_categories WHERE campaign_id = NEW.id AND mode = 'include');
END;

-- a paid payment can only move to refund states
CREATE TRIGGER trg_payment_paid_terminal
BEFORE UPDATE OF status ON payments
WHEN OLD.status = 'paid' AND NEW.status NOT IN ('paid','refunded','partially_refunded')
BEGIN
  SELECT RAISE(ABORT, 'payment_paid_terminal');
END;

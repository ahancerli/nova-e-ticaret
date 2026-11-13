-- =============================================================================
-- NOVA E-COMMERCE — SINGLE DDL SCRIPT (SQLite, node:sqlite)
-- 126 STRICT tables · 81 indexes · 37 triggers
-- Every table has a Turkish `-- TABLO:` description and every column a trailing Turkish comment (kept inside the
-- CREATE TABLE text, so it is also visible in sqlite_master / DataGrip). Keep them in sync when adding columns.
-- Data rules, status transitions and value vocabularies used by the app: db/README.md
--
-- Apply:
--   npm run db:setup   (scripts/db.mjs init — also run by the Docker container on every start)
--
-- Notes:
--   * The connection runs with PRAGMA foreign_keys = ON and WAL (src/server/sqlite-driver.ts).
--     Atomicity is achieved with db.batch([...]) (one BEGIN IMMEDIATE … COMMIT) and with the triggers below.
--   * Do not put BEGIN/COMMIT in this file.
--   * Money = INTEGER minor units (kuruş), tax-inclusive. Time = UTC ISO-8601 ms.
--   * Script is idempotent for tables/indexes (IF NOT EXISTS). Triggers are
--     dropped and recreated so re-running picks up changes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. IDENTITY & ACCESS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  -- TABLO: Tüm kişiler (müşteri + personel) için tek kimlik tablosu. Müşteri mi personel mi olduğu customer_profiles /
  --        staff_profiles ve user_roles ile belirlenir. Giriş, sipariş, yorum, audit hep buraya bağlanır.
  id                TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  email_normalized  TEXT NOT NULL UNIQUE CHECK (email_normalized = lower(trim(email_normalized)) AND instr(email_normalized,'@') > 1),  -- Giriş e-postası, küçük harf + boşluksuz saklanır, sistemde tekil
  phone_e164        TEXT CHECK (phone_e164 IS NULL OR phone_e164 GLOB '+[1-9]*'),  -- Telefon (+90… E.164 formatı), SMS bildirimleri için
  display_name      TEXT NOT NULL,  -- Ekranda gösterilen ad soyad
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','anonymized')),  -- Hesap durumu: active (aktif) / suspended (askıya alınmış) / anonymized (KVKK silme talebiyle kişisel veri temizlenmiş)
  email_verified_at TEXT,  -- E-postanın doğrulandığı zaman (NULL = doğrulanmamış)
  phone_verified_at TEXT,  -- Telefonun doğrulandığı zaman
  last_login_at     TEXT,  -- Son başarılı giriş (panel veya mağaza), listelerde gösterilir
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS customer_profiles (
  -- TABLO: Müşteriye özel bilgiler (users ile 1-1). Mağazadan üye olan herkesin satırı vardır, Hesabım ve panel
  --        Müşteriler ekranı buradan okur.
  user_id                  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,  -- Sahip kullanıcı (users.id), aynı zamanda birincil anahtar
  first_name               TEXT NOT NULL,  -- Ad
  last_name                TEXT NOT NULL,  -- Soyad
  company_name             TEXT,  -- Kurumsal fatura için firma adı
  tax_office               TEXT,  -- Vergi dairesi
  tax_identifier_encrypted TEXT,  -- VKN / TCKN, şifrelenmiş saklanır
  birth_date               TEXT,  -- Doğum tarihi (YYYY-MM-DD)
  locale                   TEXT NOT NULL DEFAULT 'tr-TR',  -- Dil/bölge tercihi (varsayılan tr-TR)
  notes_internal           TEXT,  -- Personelin müşteri hakkında iç notu (müşteri görmez)
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

-- Staff (panel) accounts. A staff member sets their own password through an invitation link
-- (verification_tokens purpose 'staff_invite'); until then there is no auth_credentials row.
CREATE TABLE IF NOT EXISTS staff_profiles (
  -- TABLO: Panel personeli (users ile 1-1). Personel davet linkiyle kendi şifresini belirler, o zamana kadar
  --        auth_credentials satırı yoktur (Davet bekliyor).
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,  -- Personelin kullanıcı kaydı (users.id)
  employee_code TEXT UNIQUE,  -- Sicil / personel kodu (tekil)
  department    TEXT CHECK (department IS NULL OR length(department) <= 80),  -- Departman
  job_title     TEXT CHECK (job_title IS NULL OR length(job_title) <= 80),  -- Unvan
  mfa_required  INTEGER NOT NULL DEFAULT 1 CHECK (mfa_required IN (0,1)),  -- İki adımlı doğrulama zorunlu mu (0/1)
  invited_by    TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Daveti gönderen personel
  invited_at    TEXT,  -- Davetin gönderildiği zaman
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

-- is_system roles ship with the product (code fixed, not deletable); 'admin' always holds every permission and
-- 'customer' is the storefront role (never assignable to staff).
CREATE TABLE IF NOT EXISTS roles (
  -- TABLO: Yetki rolleri (admin, catalog_manager, order_manager, marketing_manager, customer + özel roller). Panel
  --        Kullanıcılar › Roller ekranında yönetilir.
  id          TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  code        TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 2 AND 60 AND code NOT GLOB '*[^a-z0-9_]*'),  -- Rolün sabit kodu (a-z0-9_), özel rollerde addan türetilir
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),  -- Rolün görünen adı
  description TEXT CHECK (description IS NULL OR length(description) <= 300),  -- Rol açıklaması
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),  -- 1 = hazır sistem rolü (silinemez, kodu değişmez). admin her izne sahiptir, customer personele atanamaz
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son düzenleme, aynı anda iki kişi düzenlerse çakışma kontrolü için de kullanılır
) STRICT;

CREATE TABLE IF NOT EXISTS permissions (
  -- TABLO: İzin sözlüğü (catalog.read, orders.write, settings.write …). Rollere role_permissions ile bağlanır, etiketleri
  --        src/modules/staff/domain/permissions.ts içindedir.
  id          TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  code        TEXT NOT NULL UNIQUE,  -- İzin kodu, ör. catalog.publish
  description TEXT  -- İzin açıklaması
) STRICT;

CREATE TABLE IF NOT EXISTS user_roles (
  -- TABLO: Kullanıcı ↔ rol ataması (çoktan çoğa). Bir personelin hangi rolleri olduğunu söyler.
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Kullanıcı
  role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,  -- Atanan rol (kullanımdaki rol silinemez: RESTRICT)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Atama zamanı
  PRIMARY KEY (user_id, role_id)
) STRICT;

CREATE TABLE IF NOT EXISTS role_permissions (
  -- TABLO: Rol ↔ izin ataması (çoktan çoğa). Bir rolün hangi işleri yapabileceğini belirler.
  role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,  -- Rol
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,  -- Role verilen izin
  PRIMARY KEY (role_id, permission_id)
) STRICT;

CREATE TABLE IF NOT EXISTS auth_credentials (
  -- TABLO: Şifre ile giriş bilgileri (users ile 1-1). Şifre bcrypt hash olarak saklanır, düz şifre hiçbir yerde tutulmaz.
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,  -- Kullanıcı
  password_hash        TEXT NOT NULL CHECK (password_hash GLOB '$2[aby]$*'),  -- bcrypt şifre özeti ($2a/$2b/$2y)
  password_changed_at  TEXT,  -- Şifrenin son değiştirildiği zaman
  mfa_secret_encrypted TEXT,  -- İki adımlı doğrulama (TOTP) gizli anahtarı, şifreli
  failed_attempts      INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),  -- Art arda hatalı giriş sayısı (sadece bilgi amaçlı, başarılı girişte sıfırlanır)
  locked_until         TEXT,  -- Eski hesap kilidi alanı, artık kullanılmıyor (girişte temizlenir)
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  -- TABLO: Açık oturumlar (mağaza ve panel). Tarayıcıdaki çerez token ının yalnızca HMAC özeti saklanır.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Oturumun sahibi
  token_hash      TEXT NOT NULL UNIQUE,  -- Oturum token ının HMAC özeti (çerezdeki değer burada yok)
  expires_at      TEXT NOT NULL,  -- Oturumun sona erme zamanı
  revoked_at      TEXT,  -- Çıkış / iptal zamanı (NULL = geçerli)
  ip_hash         TEXT,  -- Giriş IP adresinin özeti (KVKK: düz IP tutulmaz)
  user_agent_hash TEXT,  -- Tarayıcı bilgisinin özeti
  mfa_verified_at TEXT,  -- Bu oturumda iki adımlı doğrulamanın yapıldığı zaman
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

CREATE TABLE IF NOT EXISTS verification_tokens (
  -- TABLO: Tek kullanımlık bağlantılar: e-posta doğrulama, şifre sıfırlama (24 saat), personel daveti (7 gün), misafir
  --        sipariş görüntüleme.
  id          TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Bağlantının ait olduğu kullanıcı
  purpose     TEXT NOT NULL CHECK (purpose IN ('email_verify','password_reset','phone_verify','guest_order_view','staff_invite')),  -- Amaç: email_verify / password_reset / phone_verify / guest_order_view / staff_invite
  token_hash  TEXT NOT NULL UNIQUE,  -- Bağlantıdaki token ın HMAC özeti
  expires_at  TEXT NOT NULL,  -- Geçerlilik sonu
  consumed_at TEXT,  -- Kullanıldığı (veya yenisi verildiği için geçersiz kılındığı) zaman
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

CREATE TABLE IF NOT EXISTS user_consents (
  -- TABLO: KVKK / ticari ileti / çerez / mesafeli satış onay kayıtları. Hangi metnin hangi sürümünün onaylandığı ispat
  --        için saklanır.
  id                  TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Onay veren üye (misafirde NULL)
  guest_identity_hash TEXT,  -- Misafir alışverişte onay vereni tanımlayan özet
  purpose             TEXT NOT NULL CHECK (purpose IN ('kvkk_notice','marketing_email','marketing_sms','cookies_analytics','distance_sales')),  -- Onay türü: kvkk_notice, marketing_email, marketing_sms, cookies_analytics, distance_sales
  document_version    TEXT NOT NULL,  -- Onaylanan metnin sürümü (checkout ta ms<v>-ob<v>)
  granted             INTEGER NOT NULL CHECK (granted IN (0,1)),  -- 1 = onay verildi, 0 = reddedildi
  recorded_at         TEXT NOT NULL,  -- Onayın kaydedildiği zaman
  withdrawn_at        TEXT,  -- Onayın geri çekildiği zaman
  CHECK (user_id IS NOT NULL OR guest_identity_hash IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS addresses (
  -- TABLO: Müşterinin adres defteri (Hesabım › Adreslerim). Siparişte kopyası order_addresses e alınır, burası sonradan
  --        değişse de sipariş etkilenmez.
  id                  TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Adresin sahibi
  label               TEXT NOT NULL,  -- Adres başlığı (Ev, İş …)
  recipient_name      TEXT NOT NULL,  -- Alıcı ad soyad
  phone_e164          TEXT NOT NULL,  -- Alıcı telefonu
  country_code        TEXT NOT NULL DEFAULT 'TR' CHECK (length(country_code) = 2),  -- Ülke kodu (ISO-2, varsayılan TR)
  province            TEXT NOT NULL,  -- İl
  district            TEXT NOT NULL,  -- İlçe
  line1               TEXT NOT NULL,  -- Açık adres satırı 1
  line2               TEXT,  -- Açık adres satırı 2
  postal_code         TEXT,  -- Posta kodu
  is_default_shipping INTEGER NOT NULL DEFAULT 0 CHECK (is_default_shipping IN (0,1)),  -- Varsayılan teslimat adresi mi (kullanıcı başına tek)
  is_default_billing  INTEGER NOT NULL DEFAULT 0 CHECK (is_default_billing IN (0,1)),  -- Varsayılan fatura adresi mi (kullanıcı başına tek)
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

-- -----------------------------------------------------------------------------
-- 2. CATALOG & INVENTORY
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
  -- TABLO: Yüklenen tüm dosyalar (ürün/kategori/marka görselleri, logo, dekont). Dosyanın kendisi medya deposunda (MEDIA_DIR) durur, burada
  --        kaydı tutulur. Hiçbir yerden kullanılmayan görsel otomatik silinir.
  id          TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  storage_key TEXT NOT NULL UNIQUE,  -- Medya deposundaki yol: <klasör>/<uuid>.<uzantı>
  public_url  TEXT CHECK (public_url IS NULL OR public_url GLOB 'https://*' OR public_url GLOB '/*'),  -- Tarayıcının kullandığı adres (/assets/… veya https://…)
  mime_type   TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','image/avif','image/svg+xml','video/mp4','application/pdf')),  -- Dosya türü (jpeg, png, webp, avif, svg, mp4, pdf)
  byte_size   INTEGER NOT NULL CHECK (byte_size > 0),  -- Dosya boyutu (byte)
  width       INTEGER CHECK (width IS NULL OR width > 0),  -- Genişlik (px)
  height      INTEGER CHECK (height IS NULL OR height > 0),  -- Yükseklik (px)
  alt_text    TEXT NOT NULL DEFAULT '',  -- Alternatif metin (erişilebilirlik / SEO), varsayılan orijinal dosya adı
  sha256      TEXT,  -- Dosya içeriğinin özeti (aynı dosyanın tekrar yüklenmesini tanımak için)
  rights_note TEXT,  -- Telif / kullanım hakkı notu
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Yükleyen personel
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

CREATE TABLE IF NOT EXISTS brands (
  -- TABLO: Markalar. Ürünlere, vitrin marka şeridine, hikayelere ve kampanya hedeflerine bağlanır. Ürünü veya hikayesi
  --        olan marka silinemez.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  name            TEXT NOT NULL,  -- Marka adı
  slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),  -- URL de kullanılan kısa ad (a-z0-9-)
  description     TEXT,  -- Marka açıklaması
  logo_media_id   TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Marka logosu
  banner_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Marka sayfası üst görseli
  website_url     TEXT CHECK (website_url IS NULL OR website_url GLOB 'http*://*'),  -- Markanın web sitesi
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS categories (
  -- TABLO: Kategori ağacı (Moda › Erkek › Kazak gibi). parent_id ile hiyerarşi kurulur, döngü trigger ile engellenir.
  --        Vitrin menüsü, filtreler ve zorunlu özellikler buradan çıkar.
  id             TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  parent_id      TEXT REFERENCES categories(id) ON DELETE RESTRICT,  -- Üst kategori (NULL = kök kategori)
  name           TEXT NOT NULL,  -- Kategori adı
  slug           TEXT NOT NULL UNIQUE CHECK (slug NOT GLOB '*[^a-z0-9-]*'),  -- URL kısa adı (tekil)
  description    TEXT,  -- Kategori açıklaması (liste sayfasında)
  image_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Kategori görseli (kutucuk / liste başlığı)
  menu_media_id  TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Mega menüde gösterilen görsel
  sort_order     INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;

CREATE TABLE IF NOT EXISTS suppliers (
  -- TABLO: Tedarikçiler (ürünün alındığı firmalar). Varyant bazında tedarikçi kodu ve maliyet supplier_variants ta
  --        tutulur.
  id                       TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  code                     TEXT NOT NULL UNIQUE,  -- Tedarikçi kodu (tekil)
  name                     TEXT NOT NULL,  -- Tedarikçi adı
  contact_email            TEXT,  -- İletişim e-postası
  phone                    TEXT,  -- Telefon
  tax_identifier_encrypted TEXT,  -- Vergi numarası, şifreli
  is_active                INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS products (
  -- TABLO: Ürün kartı (model düzeyi). Fiyat, stok ve barkod ürünün değil varyantın özelliğidir (product_variants). Sadece
  --        status = published olanlar vitrinde görünür. Silinmez, archived yapılır.
  id                TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  brand_id          TEXT REFERENCES brands(id) ON DELETE RESTRICT,  -- Ürünün markası
  name              TEXT NOT NULL,  -- Ürün adı
  slug              TEXT NOT NULL UNIQUE CHECK (slug NOT GLOB '*[^a-z0-9-]*'),  -- Ürün sayfası URL si (/urun/<slug>)
  short_description TEXT,  -- Kısa açıklama (kart / üst bilgi)
  description_html  TEXT,  -- Uzun açıklama (HTML, sanitize edilir)
  accounting_code   TEXT,  -- Muhasebe / ERP stok kodu (toplu işlemlerde eşleştirme anahtarı olabilir)
  manufacturer_code TEXT,  -- Üretici parça kodu (MPN)
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','published','paused','archived')),  -- Yayın durumu: draft taslak / in_review onayda / published vitrinde / paused durduruldu / archived arşiv
  tax_rate_bps      INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),  -- KDV oranı, baz puan (2000 = %20)
  warranty_months   INTEGER CHECK (warranty_months IS NULL OR warranty_months >= 0),  -- Garanti süresi (ay)
  country_of_origin TEXT CHECK (country_of_origin IS NULL OR length(country_of_origin) = 2),  -- Menşei ülke (ISO-2)
  published_at      TEXT,  -- İlk yayınlanma zamanı (yeni ürünler sıralaması)
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  -- Added 2026-11-09 (existing DBs: db/migrations/2026-11-09-variant-media.sql). Model kodu (Trendyol productMainId): keeps the
  -- variants of one model together in bulk sheets and on marketplaces. Unique when set — checked by the product save use
  -- case (no index: an index on an ALTER-added column would break schema.sql on old databases before the migration).
  model_code        TEXT CHECK (model_code IS NULL OR (length(model_code) BETWEEN 1 AND 64 AND model_code NOT GLOB '*[^A-Za-z0-9._-]*'))  -- Model kodu (Trendyol productMainId): aynı modelin varyantlarını bir arada tutar, büyük harf, doluysa tekil
) STRICT;

CREATE TABLE IF NOT EXISTS product_categories (
  -- TABLO: Ürün ↔ kategori bağlantısı (bir ürün birden çok kategoride olabilir, biri ana kategoridir).
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,  -- Kategori
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),  -- Ana kategori mi (ürün başına tek, breadcrumb ve pazaryeri eşlemesi bunu kullanır)
  PRIMARY KEY (product_id, category_id)
) STRICT;

CREATE TABLE IF NOT EXISTS product_variants (
  -- TABLO: Satılabilir birim (SKU). Renk × beden gibi her kombinasyon bir varyanttır, eksensiz ürünün tek varyantı
  --        vardır. Fiyat, stok, barkod, sepet ve sipariş satırı hep varyanta bağlanır.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,  -- Ait olduğu ürün
  sku             TEXT NOT NULL UNIQUE,  -- Stok kodu, katalog genelinde tekil
  barcode         TEXT UNIQUE,  -- Barkod (EAN-13 / GTIN), doluysa tekil. Pazaryerinde ürünü tanıyan anahtar
  name            TEXT,  -- Varyant adı (ör. Kırmızı / M)
  combination_key TEXT NOT NULL,  -- Seçeneklerden üretilen kombinasyon anahtarı, ürün içinde tekil
  weight_grams    INTEGER CHECK (weight_grams IS NULL OR weight_grams >= 0),  -- Ağırlık (gram), kargo için
  width_mm        INTEGER CHECK (width_mm IS NULL OR width_mm >= 0),  -- Genişlik (mm)
  height_mm       INTEGER CHECK (height_mm IS NULL OR height_mm >= 0),  -- Yükseklik (mm)
  depth_mm        INTEGER CHECK (depth_mm IS NULL OR depth_mm >= 0),  -- Derinlik (mm)
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Satışta mı. Satılmış/hareketli varyant silinmez, 0 yapılır
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),  -- Ürün sayfasında ilk seçili varyant (ürün başına tek)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (product_id, combination_key),
  UNIQUE (id, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS product_media (
  -- TABLO: Ürün galerisi. variant_id doluysa görsel o renge (varies_media eksenine) aittir ve o renk seçilince
  --        gösterilir.
  id         TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  variant_id TEXT,  -- Varyanta özel görsel ise varyant (NULL = genel galeri)
  media_id   TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,  -- Görsel dosyası (media_assets)
  sort_order INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),  -- Kapak görseli mi (genel galeride ürün başına tek, varyant görsellerinde hep 0)
  FOREIGN KEY (variant_id, product_id) REFERENCES product_variants(id, product_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS attribute_definitions (
  -- TABLO: Özellik tanımları (Renk, Beden, Materyal, Kapasite …). is_variant_axis = 1 olanlar varyant ekseni (fiyat/stok
  --        ayrışır), 0 olanlar ürün bilgisi/teknik özelliktir. Panel Katalog › Özellikler & varyantlar.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  code            TEXT NOT NULL UNIQUE CHECK (code NOT GLOB '*[^a-z0-9_]*'),  -- Sabit kod (a-z0-9_), toplu Excel başlıklarında da kullanılabilir
  label           TEXT NOT NULL,  -- Görünen ad
  data_type       TEXT NOT NULL CHECK (data_type IN ('text','number','boolean','select','multiselect')),  -- Değer tipi: text / number / boolean / select / multiselect
  unit            TEXT,  -- Birim (cm, GB …)
  is_variant_axis INTEGER NOT NULL DEFAULT 0 CHECK (is_variant_axis IN (0,1)),  -- 1 = varyant ekseni (yalnız select tipinde olabilir)
  is_filterable   INTEGER NOT NULL DEFAULT 0 CHECK (is_filterable IN (0,1)),  -- Vitrin filtrelerinde kullanılabilir mi
  is_comparable   INTEGER NOT NULL DEFAULT 1 CHECK (is_comparable IN (0,1)),  -- Karşılaştırma tablosunda gösterilsin mi
  -- Added 2026-11-07 (existing DBs: db/migrations/2026-11-07-variants-marketplaces.sql). How a variant axis is picked on the
  -- product page: buttons (Beden 38, 39 …), colour swatches, or a dropdown for long lists (halı ölçüleri).
  display_style   TEXT NOT NULL DEFAULT 'button' CHECK (display_style IN ('button','swatch','dropdown')),  -- Ürün sayfasında seçim şekli: button / swatch (renk kutusu) / dropdown
  sort_order      INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  description     TEXT CHECK (description IS NULL OR length(description) <= 300),  -- Panelde yardım metni
  -- Added 2026-11-09: product images change with this axis (Renk): the editor assigns photos per value and the shop swaps
  -- the gallery when it is picked. Only meaningful on variant axes (checked by the attribute use cases).
  varies_media    INTEGER NOT NULL DEFAULT 0 CHECK (varies_media IN (0,1)),  -- 1 = bu eksen değiştikçe ürün görselleri değişir (Renk)
  CHECK (is_variant_axis = 0 OR data_type = 'select')
) STRICT;

CREATE TABLE IF NOT EXISTS attribute_options (
  -- TABLO: Seçimli özelliklerin değerleri (Kırmızı, 38, 160x230 …).
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  attribute_id    TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,  -- Ait olduğu özellik
  value_code      TEXT NOT NULL,  -- Değer kodu, özellik içinde tekil
  label           TEXT NOT NULL,  -- Görünen değer
  color_hex       TEXT CHECK (color_hex IS NULL OR (length(color_hex) = 7 AND color_hex GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]')),  -- Renk kutusu için #RRGGBB
  swatch_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Renk kutusu yerine desen görseli
  sort_order      INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  -- Added 2026-11-07: numeric meaning of the option (shoe size 38.5, 6 m²) for sorting / range filters; inactive options
  -- stay on existing variants but are not offered for new ones.
  numeric_value   REAL,  -- Sayısal karşılık (numara 38.5, 6 m²): sıralama ve aralık filtresi için
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Pasif değer mevcut varyantlarda kalır ama yenilere önerilmez
  UNIQUE (attribute_id, value_code),
  UNIQUE (id, attribute_id)
) STRICT;

CREATE TABLE IF NOT EXISTS category_attributes (
  -- TABLO: Kategori ↔ özellik bağlantısı: bu kategorideki ürünlerde hangi özellikler sorulur, hangileri zorunludur,
  --        hangileri filtrede çıkar.
  category_id    TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,  -- Kategori (alt kategoriler üst kategorinin kurallarını da alır)
  attribute_id   TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,  -- Özellik
  is_required    INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),  -- Yayınlamak için doldurulması zorunlu mu
  show_in_filter INTEGER NOT NULL DEFAULT 1 CHECK (show_in_filter IN (0,1)),  -- Kategori sayfası filtresinde gösterilsin mi
  sort_order     INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  PRIMARY KEY (category_id, attribute_id)
) STRICT;

CREATE TABLE IF NOT EXISTS product_variant_axes (
  -- TABLO: Bir ürünün hangi eksenlerde varyantlandığı (ör. triko: Renk + Beden).
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  attribute_id TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE RESTRICT,  -- Varyant ekseni olan özellik
  sort_order   INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  PRIMARY KEY (product_id, attribute_id)
) STRICT;

CREATE TABLE IF NOT EXISTS product_attribute_values (
  -- TABLO: Ürünün teknik özellik değerleri (Materyal = Pamuk, Kapasite = 512 GB …). Değer tipine göre tek bir kolon dolu
  --        olur (trigger kontrol eder).
  id            TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  attribute_id  TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE RESTRICT,  -- Özellik
  value_index   INTEGER NOT NULL DEFAULT 0 CHECK (value_index >= 0),  -- Çoklu seçimde sıra no (tek değerli tiplerde hep 0)
  text_value    TEXT,  -- Metin değer
  number_value  REAL,  -- Sayısal değer
  boolean_value INTEGER CHECK (boolean_value IS NULL OR boolean_value IN (0,1)),  -- Evet/Hayır değer
  option_id     TEXT,  -- Seçimli değer (attribute_options)
  UNIQUE (product_id, attribute_id, value_index),
  FOREIGN KEY (option_id, attribute_id) REFERENCES attribute_options(id, attribute_id) ON DELETE RESTRICT,
  CHECK ((text_value IS NOT NULL) + (number_value IS NOT NULL) + (boolean_value IS NOT NULL) + (option_id IS NOT NULL) = 1)
) STRICT;

CREATE TABLE IF NOT EXISTS variant_options (
  -- TABLO: Varyantın eksen değerleri (varyant X = Renk:Kırmızı + Beden:M). Eksen ürüne atanmış olmalıdır (trigger).
  variant_id   TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,  -- Varyant
  attribute_id TEXT NOT NULL REFERENCES attribute_definitions(id) ON DELETE RESTRICT,  -- Eksen özelliği
  option_id    TEXT NOT NULL,  -- Seçilen değer
  PRIMARY KEY (variant_id, attribute_id),
  FOREIGN KEY (option_id, attribute_id) REFERENCES attribute_options(id, attribute_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS supplier_variants (
  -- TABLO: Varyantın tedarikçideki karşılığı: tedarikçi ürün kodu, alış maliyeti, tedarik süresi.
  supplier_id           TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,  -- Tedarikçi
  variant_id            TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,  -- Varyant
  supplier_product_code TEXT NOT NULL,  -- Tedarikçinin ürün kodu
  cost_minor            INTEGER CHECK (cost_minor IS NULL OR cost_minor >= 0),  -- Alış maliyeti (kuruş)
  currency              TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),  -- Para birimi (ISO 4217, varsayılan TRY)
  lead_time_days        INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),  -- Tedarik süresi (gün)
  is_preferred          INTEGER NOT NULL DEFAULT 0 CHECK (is_preferred IN (0,1)),  -- Tercih edilen tedarikçi mi
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  PRIMARY KEY (supplier_id, variant_id),
  UNIQUE (supplier_id, supplier_product_code)
) STRICT;

CREATE TABLE IF NOT EXISTS price_lists (
  -- TABLO: Fiyat listeleri. Uygulama şu an yalnız pl_retail (perakende, TRY) kullanır.
  id            TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  code          TEXT NOT NULL UNIQUE,  -- Liste kodu
  name          TEXT NOT NULL,  -- Liste adı
  currency      TEXT NOT NULL CHECK (length(currency) = 3),  -- Para birimi (ISO 4217, varsayılan TRY)
  tax_inclusive INTEGER NOT NULL DEFAULT 1 CHECK (tax_inclusive IN (0,1)),  -- Fiyatlar KDV dahil mi (1)
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
) STRICT;

CREATE TABLE IF NOT EXISTS variant_prices (
  -- TABLO: Varyantın satış fiyatı (fiyat listesi başına). Fiyat değişince CDC trigger pazaryerine fiyat gönderimi
  --        tetikler.
  variant_id       TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,  -- Varyant
  price_list_id    TEXT NOT NULL REFERENCES price_lists(id) ON DELETE RESTRICT,  -- Fiyat listesi
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),  -- Satış fiyatı (kuruş, KDV dahil)
  compare_at_minor INTEGER CHECK (compare_at_minor IS NULL OR compare_at_minor > unit_price_minor),  -- Üstü çizili eski fiyat, satış fiyatından büyük olmalı
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  -- Floor price: no campaign may sell a unit below it (margin protection). Added 2026-11.
  min_price_minor  INTEGER CHECK (min_price_minor IS NULL OR (min_price_minor >= 0 AND min_price_minor <= unit_price_minor)),  -- Taban fiyat: hiçbir kampanya bu fiyatın altına indiremez (kâr koruması)
  PRIMARY KEY (variant_id, price_list_id)
) STRICT;

CREATE TABLE IF NOT EXISTS warehouses (
  -- TABLO: Depolar. Uygulama şu an yalnız wh_main deposunu kullanır.
  id        TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  code      TEXT NOT NULL UNIQUE,  -- Depo kodu
  name      TEXT NOT NULL,  -- Depo adı
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
) STRICT;

CREATE TABLE IF NOT EXISTS inventory_balances (
  -- TABLO: Anlık stok bakiyesi (varyant × depo). Satılabilir = on_hand − reserved. Her değişiklik aynı batch te
  --        inventory_movements a yazılır.
  variant_id   TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,  -- Varyant
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,  -- Depo
  on_hand      INTEGER NOT NULL DEFAULT 0,  -- Fiziksel eldeki adet
  reserved     INTEGER NOT NULL DEFAULT 0,  -- Ödemesi beklenen siparişler için ayrılmış adet
  version      INTEGER NOT NULL DEFAULT 0,  -- Eşzamanlı güncelleme sayacı
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  PRIMARY KEY (variant_id, warehouse_id),
  CHECK (reserved >= 0 AND on_hand >= reserved)
) STRICT;

CREATE TABLE IF NOT EXISTS inventory_movements (
  -- TABLO: Stok defteri (append-only, değiştirilemez/silinemez). Her stok değişiminin nedeni ve referansı burada izlenir.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  variant_id      TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,  -- Varyant
  warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,  -- Depo
  kind            TEXT NOT NULL CHECK (kind IN ('receipt','adjustment','reserve','release','commit','return','transfer_in','transfer_out','count')),  -- Hareket türü: receipt ilk giriş, adjustment panel düzeltme, reserve ayırma, release serbest bırakma, commit satış, return iade, transfer/count
  on_hand_delta   INTEGER NOT NULL,  -- Eldeki adet değişimi (+/−)
  reserved_delta  INTEGER NOT NULL DEFAULT 0,  -- Ayrılmış adet değişimi (+/−)
  reference_type  TEXT,  -- Kaynak türü (product, order, checkout, order_item)
  reference_id    TEXT,  -- Kaynak kaydın id si
  reason          TEXT,  -- Açıklama / neden
  actor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,  -- İşlemi yapan personel
  idempotency_key TEXT NOT NULL UNIQUE,  -- Aynı hareketin iki kez yazılmasını engelleyen anahtar
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  CHECK (on_hand_delta <> 0 OR reserved_delta <> 0)
) STRICT;

CREATE TABLE IF NOT EXISTS stock_reservations (
  -- TABLO: Checkout sırasında stok ayırma. reserved → committed (ödeme alındı) / released (iptal) / expired (süre doldu).
  --        Son adet yarışını trigger tek kazananla çözer.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  checkout_id     TEXT NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,  -- Ayırmayı yapan checkout oturumu
  order_id        TEXT REFERENCES orders(id) ON DELETE RESTRICT,  -- Oluşan sipariş
  variant_id      TEXT NOT NULL,  -- Varyant
  warehouse_id    TEXT NOT NULL,  -- Depo
  quantity        INTEGER NOT NULL CHECK (quantity > 0),  -- Ayrılan adet (değiştirilemez)
  status          TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),  -- reserved / committed / released / expired
  expires_at      TEXT NOT NULL,  -- Ödeme gelmezse ayırmanın düşeceği zaman
  idempotency_key TEXT NOT NULL UNIQUE,  -- Tekrar denemelerde çift ayırmayı engeller
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  FOREIGN KEY (variant_id, warehouse_id) REFERENCES inventory_balances(variant_id, warehouse_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS product_relations (
  -- TABLO: Ürünler arası elle kurulan ilişkiler (benzer, tamamlayıcı, aksesuar, küratörlü).
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Kaynak ürün
  related_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- İlişkili ürün
  relation_type      TEXT NOT NULL CHECK (relation_type IN ('similar','complementary','curated','accessory')),  -- similar benzer / complementary tamamlayıcı / curated seçilmiş / accessory aksesuar
  sort_order         INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  PRIMARY KEY (product_id, related_product_id, relation_type),
  CHECK (product_id <> related_product_id)
) STRICT;

-- -----------------------------------------------------------------------------
-- 3. CONTENT & STOREFRONT
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS navigation_menus (
  -- TABLO: Site menüleri (header, footer Keşfet sütunu …).
  id        TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  code      TEXT NOT NULL UNIQUE,  -- Menü kodu (header, footer …)
  name      TEXT NOT NULL,  -- Menü adı
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
) STRICT;

CREATE TABLE IF NOT EXISTS navigation_items (
  -- TABLO: Menü öğeleri (ağaç yapısı). Bir öğe ya serbest link, ya kategori, ya da marka gösterir.
  id          TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  menu_id     TEXT NOT NULL REFERENCES navigation_menus(id) ON DELETE CASCADE,  -- Ait olduğu menü
  parent_id   TEXT REFERENCES navigation_items(id) ON DELETE CASCADE,  -- Üst öğe (alt menü için)
  label       TEXT NOT NULL,  -- Görünen metin
  href        TEXT CHECK (href IS NULL OR href GLOB '/*' OR href GLOB 'https://*'),  -- Serbest link (/… veya https://…)
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,  -- Kategoriye link
  brand_id    TEXT REFERENCES brands(id) ON DELETE SET NULL,  -- Markaya link
  sort_order  INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK ((href IS NOT NULL) + (category_id IS NOT NULL) + (brand_id IS NOT NULL) <= 1)
) STRICT;

CREATE TABLE IF NOT EXISTS story_collections (
  -- TABLO: Hikaye grupları (ana sayfadaki Instagram tarzı yuvarlak hikaye şeridi).
  id        TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  name      TEXT NOT NULL,  -- Grup adı
  slug      TEXT NOT NULL UNIQUE,  -- Kısa ad
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
) STRICT;

CREATE TABLE IF NOT EXISTS stories (
  -- TABLO: Marka hikayeleri (her hikaye bir markaya aittir, içinde kareler vardır).
  id             TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  collection_id  TEXT NOT NULL REFERENCES story_collections(id) ON DELETE CASCADE,  -- Ait olduğu hikaye grubu
  brand_id       TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,  -- Hikayenin markası
  title          TEXT NOT NULL,  -- Hikaye başlığı
  cover_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Yuvarlak kapak görseli
  sort_order     INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  starts_at      TEXT,  -- Yayın başlangıcı
  ends_at        TEXT,  -- Yayın bitişi
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) STRICT;

CREATE TABLE IF NOT EXISTS story_frames (
  -- TABLO: Hikayenin tek tek kareleri (görsel/video + tıklanınca gidilecek link).
  id          TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  story_id    TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,  -- Ait olduğu hikaye
  media_id    TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,  -- Kare görseli/videosu
  target_url  TEXT CHECK (target_url IS NULL OR target_url GLOB '/*' OR target_url GLOB 'https://*'),  -- Tıklanınca gidilecek adres
  duration_ms INTEGER NOT NULL DEFAULT 5000 CHECK (duration_ms BETWEEN 1000 AND 60000),  -- Karenin ekranda kalma süresi (ms)
  sort_order  INTEGER NOT NULL DEFAULT 0  -- Sıralama (küçük olan önce)
) STRICT;

CREATE TABLE IF NOT EXISTS sliders (
  -- TABLO: Kayan banner grupları (ana sayfa hero slider).
  id        TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  code      TEXT NOT NULL UNIQUE,  -- Slider kodu
  name      TEXT NOT NULL,  -- Slider adı
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
) STRICT;

CREATE TABLE IF NOT EXISTS slides (
  -- TABLO: Slider içindeki banner lar (masaüstü + mobil görsel, başlık, buton).
  id               TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  slider_id        TEXT NOT NULL REFERENCES sliders(id) ON DELETE CASCADE,  -- Ait olduğu slider
  title            TEXT NOT NULL,  -- Başlık
  subtitle         TEXT,  -- Alt başlık
  desktop_media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,  -- Masaüstü görseli
  mobile_media_id  TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Mobil görseli
  cta_label        TEXT,  -- Buton metni
  target_url       TEXT CHECK (target_url IS NULL OR target_url GLOB '/*' OR target_url GLOB 'https://*'),  -- Tıklanınca gidilecek adres
  sort_order       INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  starts_at        TEXT,  -- Yayın başlangıcı
  ends_at          TEXT,  -- Yayın bitişi
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) STRICT;

-- Home page layout: ordered sections, each of one type. Type-specific data: slider / story collection,
-- product selection (home_section_products or selection_mode), category / brand lists (tables below) and
-- banner image + link. Managed in Panel → Vitrin (src/modules/showcase).
CREATE TABLE IF NOT EXISTS home_sections (
  -- TABLO: Ana sayfa düzeni: sıralı bölümler (slider, hikaye şeridi, ürün karuseli, kategori kutuları, marka şeridi,
  --        banner, son bakılanlar). Panel Vitrin ekranı.
  id                  TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  title               TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),  -- Bölüm başlığı
  subtitle            TEXT CHECK (subtitle IS NULL OR length(subtitle) <= 160),  -- Alt başlık
  section_type        TEXT NOT NULL CHECK (section_type IN ('hero_slider','story_strip','product_carousel','product_grid','category_tiles','brand_strip','banner','recently_viewed')),  -- Bölüm tipi: hero_slider, story_strip, product_carousel, product_grid, category_tiles, brand_strip, banner, recently_viewed
  slider_id           TEXT REFERENCES sliders(id) ON DELETE RESTRICT,  -- hero_slider ise gösterilecek slider
  story_collection_id TEXT REFERENCES story_collections(id) ON DELETE RESTRICT,  -- story_strip ise hikaye grubu
  selection_mode      TEXT NOT NULL DEFAULT 'manual' CHECK (selection_mode IN ('manual','popular','new','discounted','rule')),  -- Ürün seçimi: manual elle / popular / new yeni / discounted indirimli / rule kural
  item_limit          INTEGER NOT NULL DEFAULT 12 CHECK (item_limit BETWEEN 1 AND 48),  -- Gösterilecek en fazla öğe
  media_id            TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Banner görseli (masaüstü)
  mobile_media_id     TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Banner görseli (mobil)
  target_url          TEXT CHECK (target_url IS NULL OR target_url GLOB '/*' OR target_url GLOB 'https://*'),  -- Banner / tümünü gör linki
  cta_label           TEXT CHECK (cta_label IS NULL OR length(cta_label) <= 40),  -- Buton metni
  settings_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),  -- Tipe özel ek ayarlar (JSON)
  sort_order          INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  starts_at           TEXT,  -- Yayın başlangıcı
  ends_at             TEXT,  -- Yayın bitişi
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  CHECK (section_type <> 'hero_slider' OR slider_id IS NOT NULL),
  CHECK (section_type <> 'story_strip' OR story_collection_id IS NOT NULL),
  CHECK (section_type <> 'banner' OR media_id IS NOT NULL OR is_active = 0),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) STRICT;

CREATE TABLE IF NOT EXISTS home_section_categories (
  -- TABLO: category_tiles bölümünde gösterilen kategoriler.
  section_id  TEXT NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,  -- Ana sayfa bölümü
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,  -- Gösterilecek kategori
  sort_order  INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  PRIMARY KEY (section_id, category_id)
) STRICT;

CREATE TABLE IF NOT EXISTS home_section_brands (
  -- TABLO: brand_strip bölümünde gösterilen markalar.
  section_id TEXT NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,  -- Ana sayfa bölümü
  brand_id   TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,  -- Gösterilecek marka
  sort_order INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  PRIMARY KEY (section_id, brand_id)
) STRICT;

CREATE TABLE IF NOT EXISTS home_section_products (
  -- TABLO: selection_mode = manual olan ürün bölümünde elle seçilmiş ürünler.
  section_id TEXT NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,  -- Ana sayfa bölümü
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Gösterilecek ürün
  sort_order INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  PRIMARY KEY (section_id, product_id)
) STRICT;

-- Content management: company-specific pages (legal texts, corporate, help). Bodies may contain {{placeholders}}
-- filled from site_settings at render time (src/modules/content/domain/template.ts). Published pages with a
-- footer_column appear in the storefront footer automatically.
CREATE TABLE IF NOT EXISTS content_pages (
  -- TABLO: İçerik sayfaları: yasal metinler (KVKK, mesafeli satış …), kurumsal, yardım. Her kayıtta version artar ve
  --        revizyon yazılır, footer_column dolu yayındaki sayfa footer da otomatik çıkar.
  id            TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  slug          TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 120 AND slug NOT GLOB '*[^a-z0-9-]*'),  -- Sayfa adresi (/sayfa/<slug>)
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 200),  -- Sayfa başlığı
  kind          TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('legal','corporate','help','general')),  -- Tür: legal yasal / corporate kurumsal / help yardım / general genel
  legal_type    TEXT CHECK (legal_type IS NULL OR legal_type IN ('kvkk','privacy','cookies','distance_sales','pre_information','return_policy','terms_of_use','membership')),  -- Yasal metin tipi (kvkk, privacy, cookies, distance_sales, pre_information, return_policy, terms_of_use, membership), her tipten tek aktif sayfa
  summary       TEXT CHECK (summary IS NULL OR length(summary) <= 500),  -- Kısa özet
  body_html     TEXT NOT NULL CHECK (length(body_html) <= 200000),  -- Sayfa içeriği (HTML, {{firma.unvan}} gibi yer tutucular site ayarlarından dolar)
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),  -- draft taslak / published yayında / archived arşiv
  footer_column TEXT CHECK (footer_column IS NULL OR footer_column IN ('corporate','help','legal')),  -- Footer da hangi sütunda (corporate, help, legal, NULL = gösterme)
  footer_order  INTEGER NOT NULL DEFAULT 0,  -- Footer sütunu içindeki sıra
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),  -- Sürüm no, her kayıtta +1 (müşteri onayında bu sürüm saklanır)
  published_at  TEXT,  -- Yayınlanma zamanı
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Oluşturan personel (users.id)
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son güncelleyen personel (users.id)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  CHECK ((kind = 'legal') = (legal_type IS NOT NULL)),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
) STRICT;

-- Every saved version of a page (what a customer accepted must stay provable after later edits).
CREATE TABLE IF NOT EXISTS content_page_revisions (
  -- TABLO: İçerik sayfalarının tüm sürümleri. Müşterinin onayladığı metnin sonradan ispatlanabilmesi için silinmez.
  id         TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  page_id    TEXT NOT NULL REFERENCES content_pages(id) ON DELETE CASCADE,  -- Sayfa
  version    INTEGER NOT NULL CHECK (version >= 1),  -- Sürüm no
  title      TEXT NOT NULL,  -- O sürümdeki başlık
  body_html  TEXT NOT NULL,  -- O sürümdeki içerik
  status     TEXT NOT NULL CHECK (status IN ('draft','published','archived')),  -- O sürümdeki durum
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Sürümü kaydeden personel
  created_at TEXT NOT NULL,  -- Sürümün kaydedildiği zaman
  UNIQUE (page_id, version)
) STRICT;

CREATE TABLE IF NOT EXISTS seo_documents (
  -- TABLO: SEO bilgileri (meta başlık/açıklama, canonical, noindex). Her satır tam olarak bir hedefe aittir: ürün,
  --        kategori, marka, içerik sayfası veya sabit bir sayfa yolu.
  id               TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  product_id       TEXT UNIQUE REFERENCES products(id) ON DELETE CASCADE,  -- Ürün sayfası SEO su
  category_id      TEXT UNIQUE REFERENCES categories(id) ON DELETE CASCADE,  -- Kategori sayfası SEO su
  brand_id         TEXT UNIQUE REFERENCES brands(id) ON DELETE CASCADE,  -- Marka sayfası SEO su
  page_id          TEXT UNIQUE REFERENCES content_pages(id) ON DELETE CASCADE,  -- İçerik sayfası SEO su
  route_path       TEXT UNIQUE CHECK (route_path IS NULL OR route_path GLOB '/*'),  -- Sabit sayfa yolu (/kampanyalar gibi)
  meta_title       TEXT CHECK (meta_title IS NULL OR length(meta_title) <= 120),  -- Arama motoru başlığı
  meta_description TEXT CHECK (meta_description IS NULL OR length(meta_description) <= 320),  -- Arama motoru açıklaması
  canonical_url    TEXT,  -- Asıl adres (kopya içerik için)
  og_media_id      TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Sosyal medya paylaşım görseli
  noindex          INTEGER NOT NULL DEFAULT 0 CHECK (noindex IN (0,1)),  -- 1 = arama motorlarında dizine eklenmesin
  CHECK ((product_id IS NOT NULL) + (category_id IS NOT NULL) + (brand_id IS NOT NULL) + (page_id IS NOT NULL) + (route_path IS NOT NULL) = 1)
) STRICT;

-- Site configuration as typed key/value pairs; the key registry and per-key validation live in
-- src/modules/settings/domain/registry.ts. is_public = readable by the storefront without a session.
CREATE TABLE IF NOT EXISTS site_settings (
  -- TABLO: Site ayarları (anahtar/değer). Firma bilgileri, iletişim, logo, SEO varsayılanları, sosyal hesaplar, footer.
  --        Geçerli anahtar listesi src/modules/settings/domain/registry.ts te.
  key            TEXT PRIMARY KEY CHECK (length(key) BETWEEN 3 AND 80 AND key NOT GLOB '*[^a-z0-9_.]*'),  -- Ayar anahtarı (site.name, company.tax_number …)
  group_name     TEXT NOT NULL CHECK (group_name IN ('general','company','contact','branding','seo','social','footer')),  -- Grup: general, company, contact, branding, seo, social, footer
  value_json     TEXT NOT NULL CHECK (json_valid(value_json)),  -- Değer (JSON)
  is_public      INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),  -- 1 = mağaza oturumsuz okuyabilir
  schema_version INTEGER NOT NULL DEFAULT 1,  -- Değer formatı sürümü
  updated_by     TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

-- -----------------------------------------------------------------------------
-- 4. CAMPAIGNS & COUPONS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  -- TABLO: Kampanyalar (yüzde/tutar indirim, X al Y öde, kademeli, çapraz satış, ücretsiz kargo). Fiyat motoru
  --        (modules/pricing) sepeti hesaplarken aktif ve tarihi uygun kampanyaları uygular. Panel Kampanyalar.
  id                 TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  name               TEXT NOT NULL,  -- Kampanya adı
  kind               TEXT NOT NULL CHECK (kind IN ('percentage','amount','fixed_price','buy_x_pay_y','buy_x_get_y','free_shipping')),  -- Saklama tipi (eski CHECK): percentage, amount, fixed_price, buy_x_pay_y, buy_x_get_y, free_shipping. Gerçek tür offer_type tadır
  percentage_bps     INTEGER CHECK (percentage_bps IS NULL OR percentage_bps BETWEEN 1 AND 10000),  -- İndirim yüzdesi, baz puan (1000 = %10), kademelide en üst kademe
  amount_minor       INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),  -- Tutar indirimi veya sabit fiyat (kuruş)
  buy_quantity       INTEGER CHECK (buy_quantity IS NULL OR buy_quantity > 0),  -- X al Y öde: alınacak adet (X)
  pay_quantity       INTEGER CHECK (pay_quantity IS NULL OR pay_quantity >= 0),  -- X al Y öde: ödenecek adet (Y)
  free_quantity      INTEGER CHECK (free_quantity IS NULL OR free_quantity > 0),  -- X alana Y bedava: bedava adet
  target_mode        TEXT NOT NULL DEFAULT 'all' CHECK (target_mode IN ('all','selected')),  -- all = tüm ürünler, selected = yalnız campaign_products/brands/categories hedefleri
  starts_at          TEXT NOT NULL,  -- Başlangıç zamanı
  ends_at            TEXT,  -- Bitiş zamanı (NULL = süresiz)
  priority           INTEGER NOT NULL DEFAULT 0,  -- Öncelik (büyük önce uygulanır)
  stack_policy       TEXT NOT NULL DEFAULT 'exclusive' CHECK (stack_policy IN ('exclusive','combinable')),  -- exclusive birleşmez (indirdiği adetleri kilitler) / combinable diğerleriyle birleşir
  min_subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal_minor >= 0),  -- Kampanyanın geçerli olması için en düşük sepet tutarı
  max_discount_minor INTEGER CHECK (max_discount_minor IS NULL OR max_discount_minor > 0),  -- Bu kampanyanın verebileceği en fazla indirim
  capacity_units     INTEGER CHECK (capacity_units IS NULL OR capacity_units > 0),  -- Toplam kampanya kapasitesi (adet), trigger aşılmasını engeller
  per_customer_limit INTEGER CHECK (per_customer_limit IS NULL OR per_customer_limit > 0),  -- Müşteri başı kullanım sınırı
  requires_coupon    INTEGER NOT NULL DEFAULT 0 CHECK (requires_coupon IN (0,1)),  -- 1 = yalnız kupon koduyla çalışır
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),  -- Aktif mi (selected kampanya hedefsiz aktif edilemez)
  rule_version       INTEGER NOT NULL DEFAULT 1 CHECK (rule_version >= 1),  -- Kural değişince artar, siparişteki snapshot ile eşleştirmek için
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  -- Added 2026-11 (existing DBs: db/migrations/2026-11-06-campaign-engine.sql). Column constraints only, so ALTER ADD works.
  -- offer_type = what the panel and the pricing engine use; NULL on older rows = same as `kind`. `kind` stays the storage
  -- mechanic because its CHECK cannot change on a live D1 (a table rebuild would CASCADE-delete coupons and targets):
  -- cart_percentage / tiered_quantity / cross_sell are stored as kind 'percentage'.
  offer_type             TEXT CHECK (offer_type IS NULL OR offer_type IN ('percentage','cart_percentage','amount','fixed_price','buy_x_pay_y','tiered_quantity','cross_sell','free_shipping')),  -- Panel ve fiyat motorunun kullandığı gerçek tür (NULL = kind ile aynı). cart_percentage/tiered_quantity/cross_sell burada
  first_order_only       INTEGER NOT NULL DEFAULT 0 CHECK (first_order_only IN (0,1)),  -- 1 = yalnız müşterinin ilk siparişinde
  condition_min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (condition_min_quantity BETWEEN 1 AND 100),  -- Çapraz satışta tetikleyici üründen en az adet
  badge_label            TEXT CHECK (badge_label IS NULL OR length(badge_label) BETWEEN 1 AND 40),  -- Ürün kartı rozet metni (ör. 3 Al 2 Öde)
  badge_emoji            TEXT CHECK (badge_emoji IS NULL OR length(badge_emoji) BETWEEN 1 AND 16),  -- Rozet emojisi
  badge_media_id         TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Rozet görseli
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (kind <> 'percentage'  OR percentage_bps IS NOT NULL),
  CHECK (kind NOT IN ('amount','fixed_price') OR amount_minor IS NOT NULL),
  CHECK (kind <> 'buy_x_pay_y' OR (buy_quantity IS NOT NULL AND pay_quantity IS NOT NULL AND buy_quantity > pay_quantity)),
  CHECK (kind <> 'buy_x_get_y' OR (buy_quantity IS NOT NULL AND free_quantity IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_products (
  -- TABLO: Kampanyanın ürün hedefleri (dahil / hariç).
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,  -- Kampanya
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  mode        TEXT NOT NULL DEFAULT 'include' CHECK (mode IN ('include','exclude')),  -- include dahil / exclude hariç
  PRIMARY KEY (campaign_id, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_brands (
  -- TABLO: Kampanyanın marka hedefleri (dahil / hariç).
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,  -- Kampanya
  brand_id    TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,  -- Marka
  mode        TEXT NOT NULL DEFAULT 'include' CHECK (mode IN ('include','exclude')),  -- include dahil / exclude hariç
  PRIMARY KEY (campaign_id, brand_id)
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_categories (
  -- TABLO: Kampanyanın kategori hedefleri (alt kategoriler dahil, dahil / hariç).
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,  -- Kampanya
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,  -- Kategori
  mode        TEXT NOT NULL DEFAULT 'include' CHECK (mode IN ('include','exclude')),  -- include dahil / exclude hariç
  PRIMARY KEY (campaign_id, category_id)
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_reward_products (
  -- TABLO: X alana Y hediye tipinde hediye edilen varyantlar.
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,  -- Kampanya
  variant_id  TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,  -- Hediye varyant
  PRIMARY KEY (campaign_id, variant_id)
) STRICT;

-- Quantity tiers of a 'tiered_quantity' campaign: the same product bought min_quantity+ times gets percentage_bps off
-- every unit (highest reached tier wins). percentage_bps on the campaign row = the top tier (kind CHECK).
CREATE TABLE IF NOT EXISTS campaign_tiers (
  -- TABLO: Kademeli kampanya basamakları: aynı üründen min_quantity ve üzeri alınca her adete yüzde indirim (ulaşılan en
  --        yüksek kademe geçerli).
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,  -- Kampanya
  min_quantity   INTEGER NOT NULL CHECK (min_quantity BETWEEN 2 AND 999),  -- Kademenin başladığı adet
  percentage_bps INTEGER NOT NULL CHECK (percentage_bps BETWEEN 1 AND 10000),  -- Bu kademedeki indirim (baz puan)
  PRIMARY KEY (campaign_id, min_quantity)
) STRICT;

-- Trigger scope of a 'cross_sell' campaign ("ayakkabı alana bakım spreyi %50"): the cart needs at least
-- campaigns.condition_min_quantity units from these products / brands / categories (categories include descendants);
-- the discount then goes to the campaign's own targets. Exactly one reference per row.
CREATE TABLE IF NOT EXISTS campaign_conditions (
  -- TABLO: Çapraz satış tetikleyicisi: sepette bu ürün/marka/kategoriden yeterli adet varsa kampanyanın kendi hedeflerine
  --        indirim uygulanır (ayakkabı alana sprey %50). Her satırda tam bir referans dolu.
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,  -- Kampanya
  product_id  TEXT REFERENCES products(id) ON DELETE CASCADE,  -- Tetikleyici ürün
  brand_id    TEXT REFERENCES brands(id) ON DELETE CASCADE,  -- Tetikleyici marka
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,  -- Tetikleyici kategori (alt kategoriler dahil)
  CHECK ((product_id IS NOT NULL) + (brand_id IS NOT NULL) + (category_id IS NOT NULL) = 1)
) STRICT;

-- Shop-wide campaign rules (one row, reference data upserted at the end of this file).
--   conflict_strategy 'priority': higher priority applies first; a non-stackable ("Birleşmez") campaign locks the units it
--                                 discounts, so lower ones cannot touch them.
--                     'best_deal': among non-stackable campaigns the one giving the customer the most applies first.
--   max_discount_bps: total discount of a cart (shipping excluded) may not exceed this share of the cart (margin guard).
CREATE TABLE IF NOT EXISTS pricing_policy (
  -- TABLO: Mağaza geneli kampanya kuralı (tek satır, id = 1). Kampanyalar çakışınca hangisinin önce uygulanacağını ve
  --        toplam indirim tavanını belirler.
  id                INTEGER PRIMARY KEY CHECK (id = 1),  -- Hep 1 (tek satırlık tablo)
  conflict_strategy TEXT NOT NULL DEFAULT 'priority' CHECK (conflict_strategy IN ('priority','best_deal')),  -- priority = önceliğe göre / best_deal = müşteriye en avantajlı olan önce
  max_discount_bps  INTEGER NOT NULL DEFAULT 5000 CHECK (max_discount_bps BETWEEN 100 AND 10000),  -- Bir sepetteki toplam indirimin sepete oranı en fazla (kargo hariç), kâr koruması
  updated_by        TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS coupons (
  -- TABLO: Kupon kodları. Her kupon bir kampanyaya bağlıdır, indirimi kampanya kuralı belirler, kupon yalnız kodu ve
  --        kullanım limitlerini tutar.
  id                 TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  campaign_id        TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,  -- Kuponun uyguladığı kampanya
  code_normalized    TEXT NOT NULL UNIQUE CHECK (code_normalized = upper(trim(code_normalized)) AND length(code_normalized) BETWEEN 3 AND 40),  -- Kupon kodu (BÜYÜK harf, boşluksuz, tekil)
  max_redemptions    INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),  -- Toplam kullanım limiti (NULL = sınırsız)
  per_customer_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),  -- Müşteri başı kullanım limiti
  starts_at          TEXT,  -- Geçerlilik başlangıcı
  ends_at            TEXT,  -- Geçerlilik bitişi
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  -- 0 = refused while an automatic campaign already discounts the cart (coupon exclusion). Added 2026-11.
  allow_with_promotions INTEGER NOT NULL DEFAULT 1 CHECK (allow_with_promotions IN (0,1))  -- 0 = sepette otomatik kampanya indirimi varsa kupon reddedilir
) STRICT;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  -- TABLO: Kupon kullanımları. Checkout ta reserved, ödeme alınınca committed, iptal/süre dolunca released/expired.
  --        Limitleri trigger korur.
  id                TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  coupon_id         TEXT NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,  -- Kupon
  checkout_id       TEXT NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,  -- Kullanıldığı checkout
  order_id          TEXT REFERENCES orders(id) ON DELETE RESTRICT,  -- Oluşan sipariş
  customer_key_hash TEXT NOT NULL,  -- Müşteriyi tanımlayan özet (üye veya misafir e-postası), müşteri başı limit için
  status            TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),  -- reserved / committed / released / expired
  expires_at        TEXT NOT NULL,  -- Ayırmanın düşeceği zaman
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  UNIQUE (coupon_id, checkout_id)
) STRICT;

CREATE TABLE IF NOT EXISTS campaign_allocations (
  -- TABLO: Kampanya kapasite tüketimi: bir checkout ta kampanyanın kaç adete ne kadar indirim verdiği. Kapasiteyi trigger
  --        korur.
  id             TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,  -- Kampanya
  checkout_id    TEXT NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,  -- Checkout
  order_id       TEXT REFERENCES orders(id) ON DELETE RESTRICT,  -- Oluşan sipariş
  units          INTEGER NOT NULL CHECK (units > 0),  -- İndirim uygulanan adet
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),  -- Verilen indirim (kuruş)
  status         TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','released','expired')),  -- reserved / committed / released / expired
  expires_at     TEXT NOT NULL,  -- Ayırmanın düşeceği zaman
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  UNIQUE (campaign_id, checkout_id)
) STRICT;

-- -----------------------------------------------------------------------------
-- 4b. BULK OPERATIONS (Toplu işlemler: Excel, XML / REST product feeds)
-- -----------------------------------------------------------------------------
-- One row per bulk run (an Excel import or one product-feed sync). Rows themselves are never stored: Excel files are
-- read in the browser and only the validated values reach the server; every product change goes through the product
-- save use case (stock ledger, guards, audit). summary_json = counts + the first row errors for the history screen.
CREATE TABLE IF NOT EXISTS bulk_jobs (
  -- TABLO: Toplu işlem geçmişi: her Excel yüklemesi veya XML/REST akış çalıştırması bir satır. Satır verisi saklanmaz,
  --        yalnız sayaçlar ve ilk hatalar.
  id            TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  kind          TEXT NOT NULL CHECK (kind IN ('excel_create','excel_update','excel_images','excel_prices','excel_stock','feed')),  -- İşlem: excel_create ürün ekle, excel_update güncelle, excel_images görsel, excel_prices fiyat, excel_stock stok, feed akış
  source        TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 300),  -- Kaynak (dosya adı veya akış adı)
  feed_id       TEXT REFERENCES product_feeds(id) ON DELETE SET NULL,  -- Akış ise ilgili product_feeds kaydı
  match_key     TEXT CHECK (match_key IS NULL OR match_key IN ('barcode','sku','accounting_code','manufacturer_code')),  -- Satırları ürünle eşleştiren anahtar: barcode, sku, accounting_code, manufacturer_code
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),  -- running / completed / failed
  total_rows    INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),  -- Toplam satır
  created_rows  INTEGER NOT NULL DEFAULT 0 CHECK (created_rows >= 0),  -- Oluşturulan
  updated_rows  INTEGER NOT NULL DEFAULT 0 CHECK (updated_rows >= 0),  -- Güncellenen
  skipped_rows  INTEGER NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),  -- Değişmediği için atlanan
  error_rows    INTEGER NOT NULL DEFAULT 0 CHECK (error_rows >= 0),  -- Hatalı satır
  summary_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(summary_json) AND length(summary_json) <= 20000),  -- Özet + ilk 100 satır hatası (JSON)
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Başlatan personel
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  finished_at   TEXT  -- Bitiş zamanı
) STRICT;

-- A supplier product feed (XML or REST/JSON URL) mapped onto our product fields. mapping_json: { "<field>": "<source path>" }
-- (field = name, price, stock, images, …; path from the feed analyser). The key path's value is matched against
-- match_key (barcode / sku / accounting_code / manufacturer_code). An optional request header (e.g. an API key) is
-- sealed with AES-256-GCM like other integration secrets and never read back by the panel.
-- schedule_minutes NULL = manual only; the cron route (/api/cron/feeds-sync) runs due feeds in budgeted slices,
-- run_cursor = index of the next feed item of an unfinished pass.
CREATE TABLE IF NOT EXISTS product_feeds (
  -- TABLO: Tedarikçi ürün akışları (XML veya JSON URL). Alan eşlemesiyle ürünlere fiyat/stok/görsel yazar, cron ile
  --        zamanlanmış çalışır.
  id               TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),  -- Akış adı
  format           TEXT NOT NULL CHECK (format IN ('xml','json')),  -- xml / json
  url              TEXT NOT NULL CHECK (url GLOB 'https://*' AND length(url) <= 2000),  -- Akış adresi (yalnız https)
  item_path        TEXT NOT NULL CHECK (length(item_path) <= 300),  -- Ürün listesinin akıştaki yolu
  match_key        TEXT NOT NULL CHECK (match_key IN ('barcode','sku','accounting_code','manufacturer_code')),  -- Ürün eşleştirme anahtarı (barcode, sku, accounting_code, manufacturer_code)
  key_path         TEXT NOT NULL CHECK (length(key_path) BETWEEN 1 AND 300),  -- Anahtar değerin akıştaki yolu
  mapping_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(mapping_json) AND length(mapping_json) <= 10000),  -- Alan eşlemesi {alan: kaynak/yol} (name, price, stock, images …)
  options_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options_json) AND length(options_json) <= 4000),  -- Ek seçenekler (kaynakta olmayana stok 0 vb.)
  header_name      TEXT CHECK (header_name IS NULL OR (length(header_name) BETWEEN 1 AND 100 AND header_name NOT GLOB '*[^A-Za-z0-9-]*')),  -- İstekte gönderilecek başlık adı (API anahtarı için)
  header_secret_json TEXT CHECK (header_secret_json IS NULL OR json_valid(header_secret_json)),  -- Başlık değeri, AES-256-GCM şifreli (panel geri okumaz)
  schedule_minutes INTEGER CHECK (schedule_minutes IS NULL OR schedule_minutes IN (60, 180, 360, 720, 1440)),  -- Çalışma sıklığı (60…1440 dk, NULL = sadece elle)
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  run_cursor       INTEGER NOT NULL DEFAULT 0 CHECK (run_cursor >= 0),  -- Yarım kalan geçişte sıradaki öğe indeksi
  pass_started_at  TEXT,  -- Devam eden geçişin başlangıcı
  next_run_at      TEXT,  -- Bir sonraki planlı çalışma
  last_run_at      TEXT,  -- Son çalışma
  last_status      TEXT CHECK (last_status IS NULL OR last_status IN ('ok','partial','failed')),  -- Son sonuç: ok / partial / failed
  last_message     TEXT CHECK (last_message IS NULL OR length(last_message) <= 500),  -- Son sonuç mesajı
  last_job_id      TEXT,  -- Son bulk_jobs kaydı
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Oluşturan personel
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  CHECK ((header_name IS NULL) = (header_secret_json IS NULL))
) STRICT;

-- What a feed last wrote per item: unchanged items (same content_hash) are skipped, images are downloaded again only
-- when their URL list changes (image_hash), items missing from a whole pass can get stock 0 (last_seen_at).
CREATE TABLE IF NOT EXISTS product_feed_items (
  -- TABLO: Akışın her öğe için en son yazdığı içerik özeti. Değişmeyen öğe atlanır, görsel listesi değişmedikçe görsel
  --        tekrar indirilmez.
  feed_id      TEXT NOT NULL REFERENCES product_feeds(id) ON DELETE CASCADE,  -- Akış
  key_value    TEXT NOT NULL CHECK (length(key_value) BETWEEN 1 AND 120),  -- Öğenin anahtar değeri (barkod, SKU …)
  product_id   TEXT REFERENCES products(id) ON DELETE CASCADE,  -- Eşleşen ürün
  content_hash TEXT NOT NULL,  -- Son yazılan içeriğin özeti
  image_hash   TEXT,  -- Son yazılan görsel listesinin özeti
  last_seen_at TEXT NOT NULL,  -- Öğenin akışta en son görüldüğü zaman (yoksa stok 0 yapılabilir)
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  PRIMARY KEY (feed_id, key_value)
) STRICT;

-- -----------------------------------------------------------------------------
-- 4c. INTEGRATIONS: change capture, message bus, marketplaces
-- -----------------------------------------------------------------------------
-- Change data capture: triggers (end of file) append one row per catalog change, whoever wrote it (panel, Excel,
-- feeds, orders, cancellations). The relay (/api/cron/integrations) coalesces rows into Kafka topics — product
-- info / stock / price / images — and advances integration_relay_state; relayed rows are pruned after 7 days.
CREATE TABLE IF NOT EXISTS catalog_change_log (
  -- TABLO: Katalog değişiklik kaydı (CDC). Ürün/varyant/fiyat/stok/görsel değiştikçe trigger lar satır ekler, relay
  --        bunları mesaj kuyruğuna (Kafka veya DB) aktarır, pazaryerleri buradan beslenir. 7 gün sonra temizlenir.
  id         INTEGER PRIMARY KEY AUTOINCREMENT,  -- Artan sıra no (relay imleci bu sayıyı takip eder)
  kind       TEXT NOT NULL CHECK (kind IN ('content','stock','price','images')),  -- Değişiklik türü: content içerik / stock stok / price fiyat / images görsel
  product_id TEXT NOT NULL,  -- Değişen ürün
  variant_id TEXT,  -- Değişen varyant (ürün düzeyinde NULL)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Değişiklik zamanı
) STRICT;

CREATE TABLE IF NOT EXISTS integration_relay_state (
  -- TABLO: Relay imleci (tek satır): catalog_change_log ta en son hangi satıra kadar mesaj kuyruğuna aktarıldığı.
  id             INTEGER PRIMARY KEY CHECK (id = 1),  -- Hep 1
  last_change_id INTEGER NOT NULL DEFAULT 0 CHECK (last_change_id >= 0),  -- Aktarılan son catalog_change_log.id
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son ilerleme zamanı
) STRICT;

-- Database implementation of the message bus (INTEGRATION_BUS=database: local development, tests, small shops).
-- Same semantics as Kafka: an append-only log per topic and a committed position per consumer group.
-- With INTEGRATION_BUS=kafka these two tables stay empty.
CREATE TABLE IF NOT EXISTS integration_messages (
  -- TABLO: Veritabanı mesaj kuyruğu (INTEGRATION_BUS=database iken Kafka yerine). Konu başına sıralı log. Kafka
  --        kullanılınca boş kalır.
  id           INTEGER PRIMARY KEY AUTOINCREMENT,  -- Artan mesaj no (offset)
  topic        TEXT NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),  -- Konu (…catalog.stock, …catalog.price …)
  msg_key      TEXT CHECK (msg_key IS NULL OR length(msg_key) <= 200),  -- Mesaj anahtarı (genelde ürün/varyant id)
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 100000),  -- Mesaj içeriği (JSON)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Yazılma zamanı
) STRICT;

CREATE TABLE IF NOT EXISTS integration_consumer_offsets (
  -- TABLO: Kuyruk tüketicilerinin konu başına okuduğu son mesaj (Kafka consumer group offset karşılığı).
  consumer_group TEXT NOT NULL CHECK (length(consumer_group) BETWEEN 1 AND 100),  -- Tüketici grubu adı
  topic          TEXT NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),  -- Konu
  last_id        INTEGER NOT NULL DEFAULT 0 CHECK (last_id >= 0),  -- İşlenen son integration_messages.id
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son ilerleme
  PRIMARY KEY (consumer_group, topic)
) STRICT;

-- A shop's account on a marketplace (Trendyol today; Hepsiburada, N11, Çiçeksepeti use the same rows).
-- credentials_sealed_json = AES-256-GCM sealed {apiKey, apiSecret} (never read back by the panel).
-- *_minutes = how often orders are pulled and stock / price / product info are pushed; next_*_at = when next due.
-- orders_synced_until = epoch-ms watermark of pulled orders (pulls overlap it, duplicates are dropped by marketplace_orders).
-- channel_cart_id = internal cart that marketplace orders hang on (orders → checkout_sessions → carts).
CREATE TABLE IF NOT EXISTS marketplace_connections (
  -- TABLO: Pazaryeri mağaza hesabı (Trendyol, ileride Hepsiburada, N11, Çiçeksepeti). Sipariş çekme ve stok/fiyat/içerik
  --        gönderme sıklıkları burada. Panel Entegrasyonlar › Pazaryerleri.
  id                   TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  provider             TEXT NOT NULL CHECK (provider IN ('trendyol','hepsiburada','n11','ciceksepeti')),  -- Pazaryeri: trendyol / hepsiburada / n11 / ciceksepeti
  name                 TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),  -- Bağlantı adı
  environment          TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production','stage')),  -- production canlı / stage test ortamı
  seller_id            TEXT NOT NULL CHECK (length(seller_id) BETWEEN 1 AND 40 AND seller_id NOT GLOB '*[^0-9A-Za-z_-]*'),  -- Pazaryerindeki satıcı id
  credentials_sealed_json TEXT NOT NULL CHECK (json_valid(credentials_sealed_json)),  -- API anahtar/secret, AES-256-GCM şifreli (panel geri okumaz)
  settings_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json) AND length(settings_json) <= 4000),  -- Bağlantı ayarları (kargo firması, teslim süresi vb.)
  is_active            INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),  -- Senkronizasyon açık mı
  order_pull_minutes   INTEGER NOT NULL DEFAULT 5 CHECK (order_pull_minutes IN (1,5,10,15,30,60)),  -- Sipariş çekme sıklığı (dk)
  stock_push_minutes   INTEGER NOT NULL DEFAULT 5 CHECK (stock_push_minutes IN (1,5,10,15,30,60)),  -- Stok gönderme sıklığı (dk)
  price_push_minutes   INTEGER NOT NULL DEFAULT 15 CHECK (price_push_minutes IN (1,5,10,15,30,60)),  -- Fiyat gönderme sıklığı (dk)
  content_push_minutes INTEGER NOT NULL DEFAULT 60 CHECK (content_push_minutes IN (5,15,30,60,180,360,720,1440)),  -- Ürün bilgisi gönderme sıklığı (dk)
  next_order_pull_at   TEXT,  -- Sıradaki sipariş çekme zamanı
  next_stock_push_at   TEXT,  -- Sıradaki stok gönderimi
  next_price_push_at   TEXT,  -- Sıradaki fiyat gönderimi
  next_content_push_at TEXT,  -- Sıradaki içerik gönderimi
  orders_synced_until  INTEGER CHECK (orders_synced_until IS NULL OR orders_synced_until > 0),  -- Çekilen siparişlerin zaman damgası (epoch ms), çekimler 2 saat geriden örtüşür
  last_sync_at         TEXT,  -- Son senkronizasyon
  last_error           TEXT CHECK (last_error IS NULL OR length(last_error) <= 1000),  -- Son hata mesajı
  channel_cart_id      TEXT REFERENCES carts(id) ON DELETE RESTRICT,  -- Bu kanaldan gelen siparişlerin bağlandığı iç sepet
  created_by           TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Oluşturan personel
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (provider, environment, seller_id)
) STRICT;

-- Our category / brand → the marketplace's id (Trendyol needs leaf category and brand ids on every product).
CREATE TABLE IF NOT EXISTS marketplace_category_mappings (
  -- TABLO: Bizim kategori → pazaryeri kategori id eşlemesi (Trendyol her üründe yaprak kategori ister).
  connection_id          TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,  -- Pazaryeri bağlantısı
  category_id            TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,  -- Bizim kategori
  external_category_id   INTEGER NOT NULL CHECK (external_category_id > 0),  -- Pazaryeri kategori id
  external_category_path TEXT NOT NULL CHECK (length(external_category_path) <= 500),  -- Pazaryerindeki kategori yolu (gösterim için)
  PRIMARY KEY (connection_id, category_id)
) STRICT;

CREATE TABLE IF NOT EXISTS marketplace_brand_mappings (
  -- TABLO: Bizim marka → pazaryeri marka id eşlemesi.
  connection_id       TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,  -- Pazaryeri bağlantısı
  brand_id            TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,  -- Bizim marka
  external_brand_id   INTEGER NOT NULL CHECK (external_brand_id > 0),  -- Pazaryeri marka id
  external_brand_name TEXT NOT NULL CHECK (length(external_brand_name) <= 200),  -- Pazaryerindeki marka adı
  PRIMARY KEY (connection_id, brand_id)
) STRICT;

-- Marketplace category attribute ← one of our attributes (its option values are mapped below) or a fixed value
-- (e.g. Menşei = TR for every product of the category).
CREATE TABLE IF NOT EXISTS marketplace_attribute_mappings (
  -- TABLO: Pazaryeri kategori özelliği ← bizim özelliğimiz veya sabit değer (ör. Menşei = TR). Her satırda tek kaynak
  --        dolu.
  connection_id           TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,  -- Pazaryeri bağlantısı
  external_category_id    INTEGER NOT NULL,  -- Pazaryeri kategorisi
  external_attribute_id   INTEGER NOT NULL,  -- Pazaryeri özellik id
  external_attribute_name TEXT NOT NULL CHECK (length(external_attribute_name) <= 200),  -- Pazaryeri özellik adı
  attribute_id            TEXT REFERENCES attribute_definitions(id) ON DELETE CASCADE,  -- Değeri sağlayan bizim özelliğimiz
  fixed_value_id          INTEGER,  -- Sabit pazaryeri değer id
  fixed_custom_value      TEXT CHECK (fixed_custom_value IS NULL OR length(fixed_custom_value) BETWEEN 1 AND 200),  -- Sabit serbest metin değer
  PRIMARY KEY (connection_id, external_category_id, external_attribute_id),
  CHECK ((attribute_id IS NOT NULL) + (fixed_value_id IS NOT NULL) + (fixed_custom_value IS NOT NULL) = 1)
) STRICT;

-- Our option (Kırmızı, 38, 160x230) → the marketplace's value id, or free text where the attribute allows custom values.
CREATE TABLE IF NOT EXISTS marketplace_value_mappings (
  -- TABLO: Bizim özellik değeri (Kırmızı, 38) → pazaryeri değer id veya serbest metin.
  connection_id         TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,  -- Pazaryeri bağlantısı
  external_attribute_id INTEGER NOT NULL,  -- Pazaryeri özellik id
  option_id             TEXT NOT NULL REFERENCES attribute_options(id) ON DELETE CASCADE,  -- Bizim değer (attribute_options)
  external_value_id     INTEGER,  -- Pazaryeri değer id
  custom_value          TEXT CHECK (custom_value IS NULL OR length(custom_value) BETWEEN 1 AND 200),  -- Serbest metin değer (özellik izin veriyorsa)
  PRIMARY KEY (connection_id, external_attribute_id, option_id),
  CHECK ((external_value_id IS NOT NULL) + (custom_value IS NOT NULL) = 1)
) STRICT;

-- One variant (barcode) on one marketplace. content_id comes from the marketplace once the product is approved.
-- *_hash = what was last sent, so an unchanged product / price / stock is not sent again (Trendyol refuses
-- identical price-stock requests within 15 minutes).
CREATE TABLE IF NOT EXISTS marketplace_listings (
  -- TABLO: Bir varyantın bir pazaryerindeki ilanı (barkod = anahtar). Son gönderilenin özeti tutulur, değişmeyen tekrar
  --        gönderilmez.
  connection_id    TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,  -- Pazaryeri bağlantısı
  variant_id       TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,  -- Varyant
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','approved','rejected','error','paused')),  -- pending bekliyor / submitted gönderildi / approved onaylı / rejected reddedildi / error hata / paused durduruldu
  content_id       INTEGER,  -- Pazaryerinin onay sonrası verdiği ürün id
  last_batch_id    TEXT,  -- Son gönderim batch id
  last_error       TEXT CHECK (last_error IS NULL OR length(last_error) <= 1000),  -- Son hata mesajı
  content_hash     TEXT,  -- Son gönderilen ürün bilgisinin özeti
  price_stock_hash TEXT,  -- Son gönderilen fiyat+stok özeti
  last_pushed_at   TEXT,  -- Son gönderim zamanı
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  PRIMARY KEY (connection_id, variant_id)
) STRICT;

-- Work waiting for the next push of a connection (filled by the bus consumer; one row per variant and kind, so ten
-- stock changes of a variant become one update). Stock and price are separate kinds: each has its own interval.
CREATE TABLE IF NOT EXISTS marketplace_pending (
  -- TABLO: Pazaryerine gönderilmeyi bekleyen iş kuyruğu (bağlantı × tür × varyant tek satır, aynı varyantın 10 stok
  --        değişimi tek gönderim olur).
  connection_id TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,  -- Pazaryeri bağlantısı
  kind          TEXT NOT NULL CHECK (kind IN ('content','stock','price')),  -- content / stock / price
  variant_id    TEXT NOT NULL,  -- Varyant
  queued_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Kuyruğa giriş zamanı
  PRIMARY KEY (connection_id, kind, variant_id)
) STRICT;

-- Asynchronous marketplace batches (Trendyol batchRequestId) until their result is read.
CREATE TABLE IF NOT EXISTS marketplace_batches (
  -- TABLO: Pazaryerine gönderilmiş asenkron toplu istekler (Trendyol batchRequestId), sonucu okunana kadar.
  id            TEXT PRIMARY KEY,  -- Pazaryerinin batch id si
  connection_id TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,  -- Pazaryeri bağlantısı
  kind          TEXT NOT NULL CHECK (kind IN ('content','stock','price')),  -- content / stock / price
  status        TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed')),  -- in_progress / completed / failed
  item_count    INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),  -- Gönderilen öğe
  failed_count  INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),  -- Hatalı öğe
  variant_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(variant_ids_json)),  -- Batch teki varyant id leri
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  checked_at    TEXT  -- Sonucun son kontrol zamanı
) STRICT;

-- Every marketplace package seen, keyed by the marketplace's package id: a package is written to orders exactly once
-- however often (and however overlapping) orders are pulled. 'failed' (e.g. unknown barcode) is retried on later pulls.
CREATE TABLE IF NOT EXISTS marketplace_orders (
  -- TABLO: Pazaryerinden görülen her paket. Paket id birincil anahtar olduğu için aynı paket asla iki kez siparişe
  --        dönüşmez. failed olanlar sonraki çekimde tekrar denenir.
  connection_id         TEXT NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,  -- Pazaryeri bağlantısı
  external_package_id   TEXT NOT NULL CHECK (length(external_package_id) BETWEEN 1 AND 60),  -- Pazaryeri paket id
  external_order_number TEXT NOT NULL CHECK (length(external_order_number) BETWEEN 1 AND 60),  -- Pazaryeri sipariş no
  order_id              TEXT REFERENCES orders(id) ON DELETE SET NULL,  -- Oluşturulan iç sipariş
  external_status       TEXT CHECK (external_status IS NULL OR length(external_status) <= 40),  -- Pazaryerindeki durum
  status                TEXT NOT NULL CHECK (status IN ('imported','failed','skipped')),  -- imported aktarıldı / failed hata (ör. bilinmeyen barkod) / skipped atlandı
  error                 TEXT CHECK (error IS NULL OR length(error) <= 1000),  -- Hata mesajı
  last_modified_ms      INTEGER,  -- Pazaryerindeki son değişiklik zamanı (epoch ms)
  attempts              INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),  -- Deneme sayısı
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  PRIMARY KEY (connection_id, external_package_id),
  CHECK (status <> 'imported' OR order_id IS NOT NULL)
) STRICT;

-- Marketplace reference data, cached (Trendyol asks to refresh the category tree weekly).
CREATE TABLE IF NOT EXISTS marketplace_category_cache (
  -- TABLO: Pazaryeri kategori ağacının önbelleği (Trendyol haftalık yenilemeyi önerir), eşleme ekranında arama için.
  provider    TEXT NOT NULL CHECK (provider IN ('trendyol','hepsiburada','n11','ciceksepeti')),  -- Pazaryeri
  external_id INTEGER NOT NULL,  -- Pazaryeri kategori id
  parent_id   INTEGER,  -- Üst kategori id
  name        TEXT NOT NULL,  -- Kategori adı
  path        TEXT NOT NULL,  -- Tam yol (Giyim > Erkek > Kazak)
  is_leaf     INTEGER NOT NULL CHECK (is_leaf IN (0,1)),  -- Yaprak (ürün açılabilir) kategori mi
  fetched_at  TEXT NOT NULL,  -- Çekildiği zaman
  PRIMARY KEY (provider, external_id)
) STRICT;

CREATE TABLE IF NOT EXISTS marketplace_attribute_cache (
  -- TABLO: Pazaryeri kategori özelliklerinin önbelleği (kategori başına ham JSON).
  provider             TEXT NOT NULL CHECK (provider IN ('trendyol','hepsiburada','n11','ciceksepeti')),  -- Pazaryeri
  external_category_id INTEGER NOT NULL,  -- Pazaryeri kategori id
  payload_json         TEXT NOT NULL CHECK (json_valid(payload_json)),  -- Özellik listesi (ham JSON)
  fetched_at           TEXT NOT NULL,  -- Çekildiği zaman
  PRIMARY KEY (provider, external_category_id)
) STRICT;

-- Barcodes the shop generates for variants without a GS1 barcode: EAN-13 = prefix + running number + check digit.
-- Prefix 2… is the GS1 "restricted circulation" range (in-store use); a shop with its own GS1 company prefix sets it.
CREATE TABLE IF NOT EXISTS barcode_sequences (
  -- TABLO: GS1 barkodu olmayan varyantlar için mağazanın ürettiği EAN-13 sayacı (tek satır). Barkod = önek + sıra no +
  --        kontrol hanesi.
  id         TEXT PRIMARY KEY CHECK (id = 'default'),  -- Hep default
  prefix     TEXT NOT NULL CHECK (length(prefix) BETWEEN 3 AND 10 AND prefix NOT GLOB '*[^0-9]*'),  -- Barkod öneki (2… = mağaza içi aralık, GS1 firma öneki varsa o)
  next_value INTEGER NOT NULL CHECK (next_value >= 0),  -- Sıradaki numara
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

-- -----------------------------------------------------------------------------
-- 5. CART & ORDERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carts (
  -- TABLO: Sepetler. Sahibi ya üye (user_id) ya misafir (guest_token_hash), ikisi birden değil. Üye giriş yapınca misafir
  --        sepeti birleştirilir (merged), siparişe dönünce converted.
  id               TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  user_id          TEXT REFERENCES users(id) ON DELETE CASCADE,  -- Üye sahibi (kullanıcı başına tek aktif sepet)
  guest_token_hash TEXT UNIQUE,  -- Misafir sepet çerezinin özeti
  currency         TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),  -- Para birimi (ISO 4217, varsayılan TRY)
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','converted','abandoned')),  -- active / merged birleştirildi / converted siparişe döndü / abandoned terk edildi
  version          INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),  -- Sepet her değiştiğinde artar, checkout teklifinin bayat olup olmadığı buna bakılır
  expires_at       TEXT,  -- Misafir sepetin sona ereceği zaman
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  CHECK ((user_id IS NULL) <> (guest_token_hash IS NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS cart_items (
  -- TABLO: Sepetteki ürünler (varyant + adet). Fiyat burada tutulmaz, her gösterimde fiyat motoru yeniden hesaplar.
  id         TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  cart_id    TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,  -- Sepet
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,  -- Varyant
  quantity   INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),  -- Adet (1-999)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (cart_id, variant_id)
) STRICT;

CREATE TABLE IF NOT EXISTS cart_coupons (
  -- TABLO: Sepete girilmiş kupon kodları.
  cart_id    TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,  -- Sepet
  coupon_id  TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,  -- Kupon
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Girildiği zaman
  PRIMARY KEY (cart_id, coupon_id)
) STRICT;

CREATE TABLE IF NOT EXISTS checkout_sessions (
  -- TABLO: Ödeme adımı oturumu: sepetin o anki fiyatlanmış teklifi (quote) dondurulur, stok/kupon/kampanya ayırmaları bu
  --        oturuma bağlanır. Onaylanınca sipariş oluşur.
  id                  TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  cart_id             TEXT NOT NULL REFERENCES carts(id) ON DELETE RESTRICT,  -- Sepet
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Üye (misafirde NULL)
  guest_identity_hash TEXT,  -- Misafir kimlik özeti
  quote_hash          TEXT NOT NULL,  -- Teklifin özeti (değişmediğini doğrulamak için)
  quote_json          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(quote_json)),  -- Dondurulmuş fiyat teklifi: satırlar, indirimler, kargo (JSON)
  cart_version        INTEGER NOT NULL,  -- Teklifin alındığı sepet sürümü
  currency            TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),  -- Para birimi (ISO 4217, varsayılan TRY)
  total_minor         INTEGER NOT NULL CHECK (total_minor >= 0),  -- Ödenecek toplam (kuruş)
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','expired','cancelled')),  -- open / confirmed siparişe döndü / expired / cancelled (yeni teklif alındı)
  expires_at          TEXT NOT NULL,  -- Teklifin geçerlilik sonu
  idempotency_key     TEXT NOT NULL UNIQUE,  -- Çift tıklamada iki sipariş oluşmasını engeller
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS orders (
  -- TABLO: Siparişler (web + pazaryeri). Tutarlar sipariş anında dondurulur ve değiştirilemez (trigger). Durum makinesi:
  --        pending_payment/awaiting_transfer → paid → preparing → shipped → delivered → completed, ya da
  --        cancelled/refunded.
  id             TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  order_number   TEXT NOT NULL UNIQUE,  -- Müşteriye gösterilen sipariş no (NOVA-2026-0001)
  checkout_id    TEXT NOT NULL UNIQUE REFERENCES checkout_sessions(id) ON DELETE RESTRICT,  -- Siparişi oluşturan checkout (tekil)
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Üye (misafir siparişte NULL)
  customer_email TEXT NOT NULL,  -- Müşteri e-postası (misafirde de dolu)
  customer_phone TEXT,  -- Müşteri telefonu
  currency       TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),  -- Para birimi (ISO 4217, varsayılan TRY)
  status         TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','awaiting_transfer','paid','preparing','shipped','delivered','completed','cancelled','refunded','partially_refunded')),  -- Sipariş durumu: pending_payment, awaiting_transfer havale bekliyor, paid, preparing, shipped, delivered, completed, cancelled, refunded, partially_refunded
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded','partially_refunded')),  -- Ödeme durumu: unpaid, pending, paid, failed, refunded, partially_refunded
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),  -- Ara toplam (indirim öncesi, kuruş)
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0 AND discount_minor <= subtotal_minor),  -- Toplam indirim
  shipping_minor INTEGER NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),  -- Kargo ücreti
  tax_minor      INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),  -- Toplamın içindeki KDV (toplama ayrıca eklenmez)
  total_minor    INTEGER NOT NULL CHECK (total_minor >= 0),  -- Ödenecek toplam = ara toplam − indirim + kargo
  customer_note  TEXT CHECK (customer_note IS NULL OR length(customer_note) <= 1000),  -- Müşterinin sipariş notu
  placed_at      TEXT NOT NULL,  -- Siparişin verildiği zaman
  -- Added 2026-11-07: where the order was placed (web shop or a marketplace) and the marketplace's own order number.
  sales_channel  TEXT NOT NULL DEFAULT 'web' CHECK (sales_channel IN ('web','trendyol','hepsiburada','n11','ciceksepeti')),  -- Satış kanalı: web / trendyol / hepsiburada / n11 / ciceksepeti
  external_order_number TEXT CHECK (external_order_number IS NULL OR length(external_order_number) <= 60),  -- Pazaryerinin kendi sipariş no su
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  CHECK (total_minor = subtotal_minor - discount_minor + shipping_minor),
  CHECK (tax_minor <= total_minor)
) STRICT;

CREATE TABLE IF NOT EXISTS order_addresses (
  -- TABLO: Siparişin teslimat ve fatura adresinin kopyası (sipariş anındaki hali, adres defteri değişse de sabit).
  id                       TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  order_id                 TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,  -- Sipariş
  kind                     TEXT NOT NULL CHECK (kind IN ('shipping','billing')),  -- shipping teslimat / billing fatura
  recipient_name           TEXT NOT NULL,  -- Alıcı
  phone_e164               TEXT NOT NULL,  -- Telefon
  country_code             TEXT NOT NULL CHECK (length(country_code) = 2),  -- Ülke
  province                 TEXT NOT NULL,  -- İl
  district                 TEXT NOT NULL,  -- İlçe
  line1                    TEXT NOT NULL,  -- Adres satırı 1
  line2                    TEXT,  -- Adres satırı 2
  postal_code              TEXT,  -- Posta kodu
  company_name             TEXT,  -- Firma adı (kurumsal fatura)
  tax_identifier_encrypted TEXT,  -- VKN/TCKN, şifreli
  tax_office               TEXT,  -- Vergi dairesi
  UNIQUE (order_id, kind)
) STRICT;

CREATE TABLE IF NOT EXISTS order_items (
  -- TABLO: Sipariş satırları. Ürün adı, SKU, fiyat ve KDV sipariş anındaki haliyle kopyalanır (snapshot), sonradan
  --        değiştirilemez.
  id                    TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  order_id              TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,  -- Sipariş
  variant_id            TEXT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,  -- Satılan varyant
  sku_snapshot          TEXT NOT NULL,  -- Sipariş anındaki SKU
  product_name_snapshot TEXT NOT NULL,  -- Sipariş anındaki ürün adı
  variant_snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(variant_snapshot_json)),  -- Sipariş anındaki varyant seçenekleri (renk, beden …)
  quantity              INTEGER NOT NULL CHECK (quantity > 0),  -- Adet
  unit_price_minor      INTEGER NOT NULL CHECK (unit_price_minor >= 0),  -- Birim fiyat (kuruş, KDV dahil)
  subtotal_minor        INTEGER NOT NULL,  -- Adet × birim fiyat
  discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),  -- Bu satıra düşen indirim
  tax_rate_bps          INTEGER NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),  -- KDV oranı (baz puan)
  tax_minor             INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),  -- Satır toplamının içindeki KDV
  total_minor           INTEGER NOT NULL,  -- Satır toplamı = ara toplam − indirim
  UNIQUE (id, order_id),
  CHECK (subtotal_minor = quantity * unit_price_minor),
  CHECK (discount_minor <= subtotal_minor),
  CHECK (total_minor = subtotal_minor - discount_minor),
  CHECK (tax_minor <= total_minor)
) STRICT;

CREATE TABLE IF NOT EXISTS order_adjustments (
  -- TABLO: Siparişe uygulanan her indirimin dökümü: hangi kampanya/kupon, hangi satıra/kargoya, ne kadar. Kural o anki
  --        haliyle saklanır.
  id                 TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  order_id           TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,  -- Sipariş
  order_item_id      TEXT,  -- İndirim belirli bir satıra ise o satır
  campaign_id        TEXT REFERENCES campaigns(id) ON DELETE RESTRICT,  -- İndirimi veren kampanya
  coupon_id          TEXT REFERENCES coupons(id) ON DELETE RESTRICT,  -- Kullanılan kupon
  label_snapshot     TEXT NOT NULL,  -- Müşteriye gösterilen indirim adı
  rule_snapshot_json TEXT NOT NULL CHECK (json_valid(rule_snapshot_json)),  -- Uygulanan kural (JSON kopyası)
  amount_minor       INTEGER NOT NULL CHECK (amount_minor >= 0),  -- İndirim tutarı (kuruş)
  target             TEXT NOT NULL CHECK (target IN ('item','order','shipping')),  -- item satır / order sipariş / shipping kargo
  FOREIGN KEY (order_item_id, order_id) REFERENCES order_items(id, order_id) ON DELETE CASCADE,
  CHECK (target <> 'item' OR order_item_id IS NOT NULL),
  CHECK (campaign_id IS NOT NULL OR coupon_id IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS order_events (
  -- TABLO: Sipariş zaman çizelgesi (append-only): verildi, ödendi, kargolandı, iptal, iade, not … Panel sipariş
  --        detayındaki geçmiş buradan gelir.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,  -- Sipariş
  event_type      TEXT NOT NULL,  -- Olay: placed, payment_captured, status_changed, shipment_created, cancelled, refunded, note …
  from_status     TEXT,  -- Önceki durum (yalnız durum değişiminde)
  to_status       TEXT,  -- Yeni durum
  note            TEXT,  -- Açıklama / personel notu
  actor_id        TEXT REFERENCES users(id) ON DELETE SET NULL,  -- İşlemi yapan personel (sistem ise NULL)
  idempotency_key TEXT NOT NULL UNIQUE,  -- Aynı olayın iki kez yazılmasını engeller
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

-- -----------------------------------------------------------------------------
-- 6. PAYMENTS & LOGISTICS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_configs (
  -- TABLO: Ödeme yöntemi ayarları: iyzico (kredi kartı) ve havale/EFT, ortam başına (sandbox/production). Gizli
  --        anahtarlar integration_secrets ta.
  id                 TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  provider           TEXT NOT NULL CHECK (provider IN ('iyzico','bank_transfer')),  -- iyzico / bank_transfer
  name               TEXT NOT NULL,  -- Görünen ad
  environment        TEXT NOT NULL CHECK (environment IN ('sandbox','production')),  -- sandbox test / production canlı
  public_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(public_config_json)),  -- Gizli olmayan ayarlar (JSON)
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),  -- Aktif mi (sağlayıcı başına tek aktif)
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (provider, environment)
) STRICT;

CREATE TABLE IF NOT EXISTS bank_accounts (
  -- TABLO: Havale/EFT için mağazanın banka hesapları (checkout ta müşteriye gösterilir).
  id                TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  payment_config_id TEXT NOT NULL REFERENCES payment_configs(id) ON DELETE RESTRICT,  -- Havale ödeme ayarı
  bank_name         TEXT NOT NULL,  -- Banka adı
  account_holder    TEXT NOT NULL,  -- Hesap sahibi
  iban_normalized   TEXT NOT NULL UNIQUE CHECK (length(iban_normalized) BETWEEN 15 AND 34 AND iban_normalized = upper(iban_normalized) AND iban_normalized NOT GLOB '* *'),  -- IBAN (büyük harf, boşluksuz)
  currency          TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),  -- Para birimi (ISO 4217, varsayılan TRY)
  instructions      TEXT,  -- Müşteriye gösterilecek açıklama
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
) STRICT;

CREATE TABLE IF NOT EXISTS payments (
  -- TABLO: Ödeme denemeleri / tahsilatlar (sipariş başına bir veya daha fazla). created/pending → paid →
  --        partially_refunded/refunded, ya da failed/cancelled. paid olan ödeme yalnız iade durumuna geçebilir (trigger).
  id                  TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  order_id            TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,  -- Sipariş
  payment_config_id   TEXT NOT NULL REFERENCES payment_configs(id) ON DELETE RESTRICT,  -- Kullanılan ödeme ayarı
  provider            TEXT NOT NULL CHECK (provider IN ('iyzico','bank_transfer')),  -- iyzico / bank_transfer
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

CREATE TABLE IF NOT EXISTS payment_events (
  -- TABLO: Ödeme sağlayıcısından gelen webhook/callback kayıtları. Aynı olay iki kez gelirse tekrar işlenmez, imza
  --        doğruluğu saklanır.
  id                TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  payment_id        TEXT REFERENCES payments(id) ON DELETE RESTRICT,  -- İlgili ödeme
  provider          TEXT NOT NULL,  -- Sağlayıcı
  provider_event_id TEXT NOT NULL,  -- Sağlayıcının olay id si
  event_type        TEXT NOT NULL,  -- Olay türü
  payload_sha256    TEXT NOT NULL,  -- Gelen içeriğin özeti (içerik saklanmaz)
  signature_valid   INTEGER NOT NULL CHECK (signature_valid IN (0,1)),  -- İmza doğru muydu
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','ignored','failed')),  -- received / processed / ignored / failed
  processed_at      TEXT,  -- İşlenme zamanı
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  UNIQUE (provider, provider_event_id)
) STRICT;

CREATE TABLE IF NOT EXISTS bank_transfers (
  -- TABLO: Havale ile ödenen siparişin banka transferi kaydı. Personel parayı görünce panelden onaylar (matched), tutar
  --        farklıysa mismatch olur ve sipariş ödendi yapılmaz.
  id               TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  payment_id       TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,  -- Ödeme kaydı (tekil)
  bank_account_id  TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,  -- Paranın yatırılacağı hesap
  reference_code   TEXT NOT NULL UNIQUE,  -- Açıklamaya yazılacak referans kodu
  expected_minor   INTEGER NOT NULL CHECK (expected_minor > 0),  -- Beklenen tutar
  received_minor   INTEGER CHECK (received_minor IS NULL OR received_minor >= 0),  -- Gelen tutar (onayda girilir)
  receipt_media_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Müşterinin yüklediği dekont
  status           TEXT NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting','notified','matched','mismatch','expired','cancelled')),  -- awaiting bekliyor / notified bildirildi / matched eşleşti / mismatch tutar farkı / expired / cancelled
  matched_by       TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Onaylayan personel
  matched_at       TEXT,  -- Onay zamanı
  expires_at       TEXT NOT NULL,  -- Havale için son süre (sonra sipariş iptal)
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  CHECK (status <> 'matched' OR (matched_by IS NOT NULL AND matched_at IS NOT NULL AND received_minor = expected_minor))
) STRICT;

CREATE TABLE IF NOT EXISTS refunds (
  -- TABLO: İadeler. Toplam iade tahsil edilenden fazla olamaz. iyzico iadesi worker ile işlenir (processing →
  --        succeeded/failed), havale iadesi hemen succeeded.
  id                 TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  payment_id         TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,  -- İade edilen ödeme
  amount_minor       INTEGER NOT NULL CHECK (amount_minor > 0),  -- İade tutarı (kuruş)
  reason             TEXT NOT NULL,  -- İade nedeni
  provider_refund_id TEXT,  -- Sağlayıcının iade id si
  idempotency_key    TEXT NOT NULL UNIQUE,  -- Çift iadeyi engeller
  status             TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','processing','succeeded','failed','cancelled')),  -- requested, processing, succeeded, failed, cancelled
  requested_by       TEXT REFERENCES users(id) ON DELETE SET NULL,  -- İadeyi başlatan personel
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS integrations (
  -- TABLO: Seçilmiş üçüncü taraf firmalar (SMS, kargo, e-posta …), tür başına tek aktif. Gizli alanlar
  --        integration_secrets ta, diğerleri public_config_json da.
  id                 TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  kind               TEXT NOT NULL CHECK (kind IN ('shipping','sms','email','external_search','accounting')),  -- Tür: shipping kargo / sms / email / external_search / accounting
  provider_code      TEXT NOT NULL,  -- Firma kodu (integration_providers.code)
  name               TEXT NOT NULL,  -- Görünen ad
  public_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(public_config_json)),  -- Gizli olmayan ayarlar + SMS olay şablonları (JSON)
  is_active          INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),  -- Aktif mi (tür başına tek)
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (kind, provider_code)
) STRICT;

CREATE TABLE IF NOT EXISTS integration_secrets (
  -- TABLO: Şifrelenmiş sırlar (iyzico anahtarları, SMS/kargo şifreleri, webhook secret). AES-256-GCM, ana anahtar
  --        SECRETS_MASTER_KEY. Ya bir entegrasyona ya bir ödeme ayarına bağlıdır.
  id                TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  integration_id    TEXT REFERENCES integrations(id) ON DELETE CASCADE,  -- Sahip entegrasyon
  payment_config_id TEXT REFERENCES payment_configs(id) ON DELETE CASCADE,  -- Sahip ödeme ayarı
  secret_name       TEXT NOT NULL,  -- Sır adı (api_key, secret_key, password, webhook_secret …)
  ciphertext        TEXT NOT NULL,  -- Şifreli değer
  nonce             TEXT NOT NULL,  -- Şifreleme nonce değeri
  auth_tag          TEXT NOT NULL,  -- GCM doğrulama etiketi
  key_version       TEXT NOT NULL,  -- Ana anahtar sürümü (v1)
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  CHECK ((integration_id IS NULL) <> (payment_config_id IS NULL)),
  UNIQUE (integration_id, payment_config_id, secret_name)
) STRICT;

-- The shop's single AI provider (admin: Entegrasyonlar › AI entegrasyonları). One row at most (id = 'default'):
-- choosing another provider replaces it. The API key uses the same AES-256-GCM envelope as integration_secrets
-- (master key = SECRETS_MASTER_KEY); only its last characters are kept in clear for the panel.
-- Separate table because adding 'ai' to integrations.kind would mean rebuilding a table other rows point at.
CREATE TABLE IF NOT EXISTS ai_integration (
  -- TABLO: Mağazanın tek AI sağlayıcısı (OpenAI / Gemini / Claude), ürün açıklaması üretimi için. Tek satır, API anahtarı
  --        şifreli.
  id                 TEXT PRIMARY KEY CHECK (id = 'default'),  -- Hep default (tek satır)
  provider           TEXT NOT NULL CHECK (provider IN ('openai','gemini','anthropic')),  -- openai / gemini / anthropic
  model              TEXT NOT NULL CHECK (length(model) BETWEEN 2 AND 100),  -- Seçilen model (ai_models kataloğundan)
  api_key_ciphertext TEXT NOT NULL,  -- Şifreli API anahtarı
  api_key_nonce      TEXT NOT NULL,  -- Şifreleme nonce değeri
  api_key_auth_tag   TEXT NOT NULL,  -- GCM doğrulama etiketi
  key_version        TEXT NOT NULL,  -- Ana anahtar sürümü
  api_key_hint       TEXT NOT NULL CHECK (length(api_key_hint) <= 8),  -- Anahtarın son karakterleri (panelde …abcd gösterimi)
  updated_by         TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

-- Models offered in the AI panel's model select (reference data, upserted at the end of this file). The panel
-- only accepts listed, non-retired models. Default model of a provider = its first 'active' row by sort_order.
-- Models are never deleted (ai_integration.model may still name one): set status 'deprecated' when the provider
-- announces a shutdown (shown with a warning), 'retired' once it is gone (hidden from the select).
CREATE TABLE IF NOT EXISTS ai_models (
  -- TABLO: AI model kataloğu (referans veri, şema çalıştırılınca güncellenir). Panelde seçilebilecek modeller, kapanan
  --        modeller silinmez retired olur.
  provider   TEXT NOT NULL CHECK (provider IN ('openai','gemini','anthropic')),  -- Sağlayıcı
  model_id   TEXT NOT NULL CHECK (length(model_id) BETWEEN 2 AND 100 AND model_id NOT GLOB '*[^A-Za-z0-9._:-]*'),  -- Sağlayıcının model kimliği
  label      TEXT NOT NULL CHECK (length(label) BETWEEN 2 AND 60),  -- Görünen ad
  note       TEXT CHECK (note IS NULL OR length(note) <= 160),  -- Kısa not
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','retired')),  -- active / deprecated kapanacak / retired kapandı (gizli)
  retires_at TEXT CHECK (retires_at IS NULL OR retires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- Kapanış tarihi (YYYY-MM-DD)
  sort_order INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  PRIMARY KEY (provider, model_id)
) STRICT;

-- Outgoing e-mail over SMTP (password reset, later order mails). One row; the SMTP password is sealed with
-- AES-256-GCM (master key = SECRETS_MASTER_KEY) — it cannot be hashed because the server must present it to the
-- mail server. The panel never reads it back.
CREATE TABLE IF NOT EXISTS mail_integration (
  -- TABLO: Mağazanın SMTP e-posta hesabı (tek satır). Şifre hash lenemez (sunucuya düz verilmesi gerekir), bu yüzden
  --        AES-256-GCM ile şifreli.
  id                  TEXT PRIMARY KEY CHECK (id = 'default'),  -- Hep default
  host                TEXT NOT NULL CHECK (length(host) BETWEEN 3 AND 253),  -- SMTP sunucusu
  port                INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),  -- Port (465, 587 …)
  security            TEXT NOT NULL CHECK (security IN ('ssl','starttls')),  -- ssl / starttls
  username            TEXT NOT NULL CHECK (length(username) BETWEEN 1 AND 254),  -- Kullanıcı adı
  password_ciphertext TEXT NOT NULL,  -- Şifreli parola
  password_nonce      TEXT NOT NULL,  -- Şifreleme nonce değeri
  password_auth_tag   TEXT NOT NULL,  -- GCM doğrulama etiketi
  key_version         TEXT NOT NULL,  -- Ana anahtar sürümü
  from_email          TEXT NOT NULL CHECK (instr(from_email, '@') > 1 AND length(from_email) <= 254),  -- Gönderen adresi
  from_name           TEXT NOT NULL CHECK (length(from_name) BETWEEN 1 AND 100),  -- Gönderen adı
  updated_by          TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

-- One row per outgoing e-mail attempt (MailSender) — the panel's "Son gönderimler" list, so a failed password-reset
-- mail (sent in the background, invisible to the requester) shows why it failed. `error_*` / `stage` come from the
-- SMTP failure classifier; `server_reply` = the SMTP server's own answer (accept line with queue id, or rejection).
-- Never holds message bodies, links or passwords. Rows older than 30 days are pruned on write.
CREATE TABLE IF NOT EXISTS mail_deliveries (
  -- TABLO: Giden her e-posta denemesinin sonucu (panel Son gönderimler). İçerik/link/parola tutulmaz, 30 günden eskiler
  --        silinir.
  id            TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  purpose       TEXT NOT NULL CHECK (purpose IN ('password_reset','test','other')),  -- Amaç: password_reset / test / other
  recipient     TEXT NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254),  -- Alıcı adresi
  status        TEXT NOT NULL CHECK (status IN ('sent','failed','not_configured','throttled')),  -- sent / failed / not_configured SMTP yok / throttled sınır
  smtp_host     TEXT CHECK (smtp_host IS NULL OR length(smtp_host) <= 253),  -- Kullanılan SMTP sunucusu
  stage         TEXT CHECK (stage IS NULL OR length(stage) <= 20),  -- Hatanın olduğu aşama (connect, auth …)
  error_code    TEXT CHECK (error_code IS NULL OR length(error_code) <= 60),  -- Hata kodu (failed ise zorunlu)
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 500),  -- Hata açıklaması
  server_reply  TEXT CHECK (server_reply IS NULL OR length(server_reply) <= 500),  -- SMTP sunucusunun cevabı
  latency_ms    INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),  -- Gönderim süresi (ms)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  CHECK ((status = 'failed') = (error_code IS NOT NULL))
) STRICT;

-- Catalog of third-party providers offered in the panel (Entegrasyonlar › SMS / Kargo). Reference data: the upsert
-- below keeps it in sync on every schema run. support_status 'ready' = an adapter ships with the app
-- (src/modules/integrations/infrastructure/connectors); 'planned' = listed, but choosing it is refused with
-- provider_not_integrated ("firmaya bilgi verin"). credential_fields_json drives the panel form:
-- [{key, label, type: text|password|select, required, secret, placeholder?, hint?, options?, pattern?, maxLength?, default?}]
-- secret fields go to integration_secrets (secret_name = key), the others to integrations.public_config_json.
CREATE TABLE IF NOT EXISTS integration_providers (
  -- TABLO: Panelde seçilebilen SMS/kargo firmaları kataloğu (referans veri, şema çalıştırınca güncellenir). ready =
  --        adaptör var, planned = listelenir ama henüz entegre değil.
  code                   TEXT PRIMARY KEY CHECK (length(code) BETWEEN 2 AND 40 AND code NOT GLOB '*[^a-z0-9_]*'),  -- Firma kodu (netgsm, yurtici …)
  kind                   TEXT NOT NULL CHECK (kind IN ('shipping','sms','email','external_search','accounting')),  -- Tür: shipping / sms / email / external_search / accounting
  name                   TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),  -- Firma adı
  description            TEXT CHECK (description IS NULL OR length(description) <= 300),  -- Açıklama
  website                TEXT CHECK (website IS NULL OR website GLOB 'https://*'),  -- Web sitesi
  support_status         TEXT NOT NULL DEFAULT 'planned' CHECK (support_status IN ('ready','planned')),  -- ready kullanılabilir / planned planlandı
  credential_fields_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(credential_fields_json) AND json_type(credential_fields_json) = 'array'),  -- Panel formundaki alanlar (anahtar, etiket, tip, zorunlu, gizli …)
  capabilities_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(capabilities_json) AND json_type(capabilities_json) = 'array'),  -- Firmanın yetenekleri (booking, tracking, webhook …)
  sort_order             INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  is_listed              INTEGER NOT NULL DEFAULT 1 CHECK (is_listed IN (0,1)),  -- Panelde listelensin mi
  CHECK (support_status = 'planned' OR json_array_length(credential_fields_json) > 0)
) STRICT;

-- One booking per shipment at the carrier. cargo_key is OUR reference sent to the carrier (stable per shipment, so an
-- outbox retry never books twice); the carrier's tracking number lands on shipments when it is assigned.
-- status: booked → closed (terminal tracking state reached, sync stops) | cancelled; failed = carrier refused (last_error).
CREATE TABLE IF NOT EXISTS carrier_shipments (
  -- TABLO: Gönderinin kargo firmasındaki kaydı (gönderi başına bir). cargo_key bizim sabit referansımızdır, tekrar
  --        denemede çift kayıt açılmaz.
  shipment_id    TEXT PRIMARY KEY REFERENCES shipments(id) ON DELETE CASCADE,  -- Gönderi
  integration_id TEXT REFERENCES integrations(id) ON DELETE SET NULL,  -- Kullanılan kargo entegrasyonu
  provider_code  TEXT NOT NULL,  -- Kargo firması kodu
  cargo_key      TEXT NOT NULL CHECK (length(cargo_key) BETWEEN 4 AND 40),  -- Firmaya gönderdiğimiz anahtar (NV + gönderi id)
  status         TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','failed','cancelled','closed')),  -- booked kayıtlı / failed reddedildi / cancelled / closed takip bitti
  carrier_status TEXT CHECK (carrier_status IS NULL OR length(carrier_status) <= 200),  -- Firmanın son bildirdiği durum metni
  provider_ref   TEXT,  -- Firmanın kendi kayıt numarası
  last_error     TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),  -- Son hata (failed ise zorunlu)
  last_synced_at TEXT,  -- Son durum sorgulama zamanı
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (provider_code, cargo_key),
  CHECK (status <> 'failed' OR last_error IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS shipping_methods (
  -- TABLO: Kargo seçenekleri (checkout ta müşteri seçer): ücret ve ücretsiz kargo eşiği.
  id               TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  code             TEXT NOT NULL UNIQUE,  -- Yöntem kodu
  name             TEXT NOT NULL,  -- Görünen ad
  integration_id   TEXT REFERENCES integrations(id) ON DELETE SET NULL,  -- Bağlı kargo entegrasyonu
  fee_minor        INTEGER NOT NULL CHECK (fee_minor >= 0),  -- Kargo ücreti (kuruş)
  free_above_minor INTEGER CHECK (free_above_minor IS NULL OR free_above_minor > 0),  -- Bu tutarın üstünde kargo bedava
  currency         TEXT NOT NULL DEFAULT 'TRY' CHECK (length(currency) = 3),  -- Para birimi (ISO 4217, varsayılan TRY)
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
) STRICT;

CREATE TABLE IF NOT EXISTS shipments (
  -- TABLO: Gönderiler (koliler). Bir sipariş birden fazla parça halinde gönderilebilir. shipped → in_transit → delivered
  --        / returned / lost.
  id                 TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  order_id           TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,  -- Sipariş
  shipping_method_id TEXT NOT NULL REFERENCES shipping_methods(id) ON DELETE RESTRICT,  -- Kargo yöntemi
  tracking_number    TEXT,  -- Takip numarası
  tracking_url       TEXT CHECK (tracking_url IS NULL OR tracking_url GLOB 'https://*'),  -- Takip linki
  status             TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','shipped','in_transit','delivered','returned','lost','cancelled')),  -- preparing, shipped, in_transit, delivered, returned, lost, cancelled
  shipped_at         TEXT,  -- Kargoya verilme zamanı
  delivered_at       TEXT,  -- Teslim zamanı
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (id, order_id)
) STRICT;

CREATE TABLE IF NOT EXISTS shipment_items (
  -- TABLO: Gönderide hangi sipariş satırından kaç adet olduğu (kısmi gönderim).
  shipment_id   TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,  -- Gönderi
  order_id      TEXT NOT NULL,  -- Sipariş
  order_item_id TEXT NOT NULL,  -- Sipariş satırı
  quantity      INTEGER NOT NULL CHECK (quantity > 0),  -- Gönderilen adet
  PRIMARY KEY (shipment_id, order_item_id),
  FOREIGN KEY (shipment_id, order_id) REFERENCES shipments(id, order_id) ON DELETE CASCADE,
  FOREIGN KEY (order_item_id, order_id) REFERENCES order_items(id, order_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS shipment_events (
  -- TABLO: Kargo firmasından gelen hareketler (webhook veya sorgu). Aynı olay tekrar yazılmaz.
  id                TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  shipment_id       TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,  -- Gönderi
  provider_event_id TEXT NOT NULL,  -- Firmanın olay id si
  status            TEXT NOT NULL,  -- Bildirilen durum
  description       TEXT,  -- Açıklama (şube, teslim alan …)
  occurred_at       TEXT NOT NULL,  -- Olayın gerçekleştiği zaman
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  UNIQUE (shipment_id, provider_event_id)
) STRICT;

-- -----------------------------------------------------------------------------
-- 7. ENGAGEMENT & OPERATIONS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wishlists (
  -- TABLO: Müşterinin favori listesi.
  id         TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Liste sahibi
  name       TEXT NOT NULL DEFAULT 'Favorilerim',  -- Liste adı (Favorilerim)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

CREATE TABLE IF NOT EXISTS wishlist_items (
  -- TABLO: Favori listesindeki ürünler.
  wishlist_id TEXT NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,  -- Liste
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Eklenme zamanı
  PRIMARY KEY (wishlist_id, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS recent_views (
  -- TABLO: Son bakılan ürünler (ana sayfa Son baktıkların bölümü). Ziyaretçi anonim özetle tanınır.
  visitor_key_hash TEXT NOT NULL,  -- Ziyaretçi anahtarı özeti
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Bakılan ürün
  viewed_at        TEXT NOT NULL,  -- Bakılma zamanı
  PRIMARY KEY (visitor_key_hash, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS reviews (
  -- TABLO: Ürün yorumları ve puanları. Müşteri başına ürün başına tek yorum. pending → approved (vitrine çıkar) /
  --        rejected / hidden. Yalnız approved olanlar puan ortalamasına girer. Panel Yorumlar.
  id            TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Yorumu yazan müşteri
  order_item_id TEXT REFERENCES order_items(id) ON DELETE SET NULL,  -- Satın alınan sipariş satırı (doğrulanmış alım)
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),  -- Puan (1-5)
  title         TEXT CHECK (title IS NULL OR length(title) <= 120),  -- Başlık
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),  -- Yorum metni
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','hidden')),  -- pending bekliyor / approved yayında / rejected reddedildi / hidden kaldırıldı
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  -- Added 2026-11-08 (db/migrations/2026-11-08-reviews-notifications.sql): moderation, store reply, customer contact.
  variant_id        TEXT REFERENCES product_variants(id) ON DELETE SET NULL,  -- Satın alınan varyant (renk/beden gösterimi)
  is_anonymous      INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0,1)),  -- 1 = adı gizli gösterilir
  verified_purchase INTEGER NOT NULL DEFAULT 0 CHECK (verified_purchase IN (0,1)),  -- 1 = Satın aldı rozeti
  helpful_count     INTEGER NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),  -- Faydalı oy sayısı (review_votes toplamı)
  reject_reason     TEXT CHECK (reject_reason IS NULL OR reject_reason IN ('spam','offensive','personal_data','irrelevant','advertising','other')),  -- Red nedeni: spam, offensive, personal_data, irrelevant, advertising, other
  moderation_note   TEXT CHECK (moderation_note IS NULL OR length(moderation_note) <= 1000),  -- Moderatörün iç notu
  moderated_by      TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Onaylayan/reddeden personel
  moderated_at      TEXT,  -- Moderasyon zamanı
  published_at      TEXT,  -- Yayına alınma zamanı
  reply_body        TEXT CHECK (reply_body IS NULL OR length(reply_body) BETWEEN 1 AND 2000),  -- Mağazanın herkese açık cevabı
  reply_by          TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Cevaplayan personel
  replied_at        TEXT,  -- Cevap zamanı
  contact_status    TEXT NOT NULL DEFAULT 'none' CHECK (contact_status IN ('none','contacted','resolved')),  -- Müşteriyle iletişim: none / contacted / resolved
  version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),  -- Müşteri her düzenlediğinde artar (eşzamanlılık kontrolü)
  UNIQUE (product_id, user_id)
) STRICT;

-- "Faydalı buldum": one vote per signed-in customer; reviews.helpful_count is the cached total.
CREATE TABLE IF NOT EXISTS review_votes (
  -- TABLO: Yorumlara verilen Faydalı oyları (müşteri başına yorum başına bir).
  review_id  TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,  -- Yorum
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Oy veren müşteri
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oy zamanı
  PRIMARY KEY (review_id, user_id)
) STRICT;

-- Staff ↔ reviewer contact log: e-mails sent from the panel (shown to the customer under Hesabım), phone calls and
-- internal notes (staff only).
CREATE TABLE IF NOT EXISTS review_contacts (
  -- TABLO: Personel ↔ yorum sahibi iletişim kaydı: e-posta (müşteri Hesabım da görür), telefon, iç not.
  id                  TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  review_id           TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,  -- Yorum
  channel             TEXT NOT NULL CHECK (channel IN ('email','phone','note')),  -- email / phone / note
  subject             TEXT CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 200),  -- Konu (e-postada zorunlu)
  body                TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),  -- İçerik
  delivery            TEXT NOT NULL DEFAULT 'logged' CHECK (delivery IN ('logged','sent','failed','not_configured')),  -- logged kaydedildi / sent gönderildi / failed / not_configured SMTP yok
  visible_to_customer INTEGER NOT NULL DEFAULT 0 CHECK (visible_to_customer IN (0,1)),  -- Müşteri Hesabım da görsün mü
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Kaydı oluşturan personel
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  CHECK (channel <> 'email' OR subject IS NOT NULL)
) STRICT;

-- Single row (id = 1). 'manual' = every review waits for approval; 'auto_trusted' publishes verified buyers' 4–5 star
-- reviews without links / blocked words at once, everything else still waits.
CREATE TABLE IF NOT EXISTS review_settings (
  -- TABLO: Yorum kuralları (tek satır): manuel onay mı otomatik mi, satın alma şartı, anonimlik, en kısa uzunluk, yasaklı
  --        kelimeler.
  id               INTEGER PRIMARY KEY CHECK (id = 1),  -- Hep 1
  moderation_mode  TEXT NOT NULL DEFAULT 'manual' CHECK (moderation_mode IN ('manual','auto_trusted')),  -- manual her yorum onay bekler / auto_trusted doğrulanmış alıcının temiz 4-5 yıldızı direkt yayında
  require_purchase INTEGER NOT NULL DEFAULT 1 CHECK (require_purchase IN (0,1)),  -- Yorum için satın alma şartı
  allow_anonymous  INTEGER NOT NULL DEFAULT 1 CHECK (allow_anonymous IN (0,1)),  -- Anonim yorum izni
  min_body_length  INTEGER NOT NULL DEFAULT 10 CHECK (min_body_length BETWEEN 1 AND 500),  -- En kısa yorum uzunluğu
  blocked_words    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blocked_words) AND json_type(blocked_words) = 'array'),  -- Yasaklı kelimeler (JSON dizi)
  updated_by       TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

-- Panel notifications (bell + Bildirimler): one row per event, visible to staff holding `permission` (NULL = all
-- staff). Read / archived state is per staff member. `dedupe_key` makes producers (outbox handlers) idempotent.
CREATE TABLE IF NOT EXISTS admin_notifications (
  -- TABLO: Panel bildirimleri (zil ikonu + Bildirimler sayfası): yeni sipariş, bekleyen yorum vb. permission sahibi
  --        personel görür.
  id          TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  type        TEXT NOT NULL CHECK (length(type) BETWEEN 3 AND 60 AND type NOT GLOB '*[^a-z0-9_.]*'),  -- Bildirim türü (order.placed, review.pending …)
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','danger')),  -- info / success / warning / danger
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),  -- Başlık
  body        TEXT CHECK (body IS NULL OR length(body) <= 1000),  -- Açıklama
  href        TEXT CHECK (href IS NULL OR (href GLOB '/admin*' AND length(href) <= 300)),  -- Tıklanınca gidilecek panel sayfası
  permission  TEXT CHECK (permission IS NULL OR length(permission) <= 60),  -- Görmek için gereken izin (NULL = tüm personel)
  entity_type TEXT,  -- İlgili kayıt türü
  entity_id   TEXT,  -- İlgili kayıt id
  dedupe_key  TEXT UNIQUE,  -- Aynı bildirimin iki kez oluşmasını engeller
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

CREATE TABLE IF NOT EXISTS admin_notification_states (
  -- TABLO: Bildirimin personel başına okundu/arşiv durumu.
  notification_id TEXT NOT NULL REFERENCES admin_notifications(id) ON DELETE CASCADE,  -- Bildirim
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Personel
  read_at         TEXT,  -- Okunma zamanı
  archived_at     TEXT,  -- Arşivlenme zamanı
  PRIMARY KEY (notification_id, user_id)
) STRICT;

-- Per notification type (shop-wide, Bildirimler › Ayarlar): show in the panel, and e-mail to a fixed list.
-- A type without a row uses the defaults of NOTIFICATION_TYPES (code).
CREATE TABLE IF NOT EXISTS admin_notification_rules (
  -- TABLO: Bildirim türü başına mağaza geneli kural: panelde göster, e-posta ile gönder. Satırı olmayan tür koddaki
  --        varsayılanı kullanır.
  type       TEXT PRIMARY KEY CHECK (length(type) BETWEEN 3 AND 60),  -- Bildirim türü
  in_app     INTEGER NOT NULL DEFAULT 1 CHECK (in_app IN (0,1)),  -- Panelde gösterilsin mi
  email      INTEGER NOT NULL DEFAULT 0 CHECK (email IN (0,1)),  -- E-posta gönderilsin mi
  email_to   TEXT CHECK (email_to IS NULL OR length(email_to) <= 500),  -- E-posta alıcıları (virgülle)
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

-- Personal preference: a staff member hides one notification type for themselves.
CREATE TABLE IF NOT EXISTS admin_notification_mutes (
  -- TABLO: Kişisel tercih: personelin kendisi için kapattığı bildirim türleri.
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Personel
  type       TEXT NOT NULL CHECK (length(type) BETWEEN 3 AND 60),  -- Kapatılan bildirim türü
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Kapatılma zamanı
  PRIMARY KEY (user_id, type)
) STRICT;

CREATE TABLE IF NOT EXISTS comparison_sessions (
  -- TABLO: Sunucu tarafı karşılaştırma oturumu. KULLANILMIYOR: karşılaştırma listesi tarayıcıda (localStorage) tutuluyor.
  id               TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  visitor_key_hash TEXT NOT NULL UNIQUE,  -- Ziyaretçi anahtarı özeti
  expires_at       TEXT NOT NULL,  -- Sona erme zamanı
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

CREATE TABLE IF NOT EXISTS comparison_items (
  -- TABLO: Karşılaştırma oturumundaki ürünler. KULLANILMIYOR (bkz. comparison_sessions).
  comparison_id TEXT NOT NULL REFERENCES comparison_sessions(id) ON DELETE CASCADE,  -- Karşılaştırma oturumu
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  sort_order    INTEGER NOT NULL DEFAULT 0,  -- Sıralama (küçük olan önce)
  PRIMARY KEY (comparison_id, product_id)
) STRICT;

CREATE TABLE IF NOT EXISTS external_search_jobs (
  -- TABLO: Ürünün başka sitelerdeki fiyatlarını arama işleri (Diğer sitelerle karşılaştır, henüz yakında aşamasında).
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Aranan ürün
  media_id        TEXT REFERENCES media_assets(id) ON DELETE SET NULL,  -- Görselle arama için görsel
  integration_id  TEXT REFERENCES integrations(id) ON DELETE SET NULL,  -- Kullanılan arama entegrasyonu
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','not_configured')),  -- queued, running, succeeded, failed, not_configured
  error_code      TEXT,  -- Hata kodu
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),  -- Deneme sayısı
  next_attempt_at TEXT,  -- Sıradaki deneme
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS external_offers (
  -- TABLO: Dış sitelerde bulunan teklifler (satıcı, fiyat, stok, eşleşme güveni).
  id               TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  search_job_id    TEXT NOT NULL REFERENCES external_search_jobs(id) ON DELETE CASCADE,  -- Arama işi
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,  -- Ürün
  variant_id       TEXT REFERENCES product_variants(id) ON DELETE SET NULL,  -- Eşleşen varyant
  merchant_name    TEXT NOT NULL,  -- Satıcı / site adı
  offer_url        TEXT NOT NULL CHECK (offer_url GLOB 'http://*' OR offer_url GLOB 'https://*'),  -- Teklif linki
  price_minor      INTEGER CHECK (price_minor IS NULL OR price_minor > 0),  -- Fiyat (kuruş)
  currency         TEXT CHECK (currency IS NULL OR length(currency) = 3),  -- Para birimi
  shipping_minor   INTEGER CHECK (shipping_minor IS NULL OR shipping_minor >= 0),  -- Kargo ücreti
  availability     TEXT CHECK (availability IS NULL OR availability IN ('in_stock','out_of_stock','unknown')),  -- in_stock / out_of_stock / unknown
  match_confidence REAL CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1),  -- Eşleşme güveni (0-1)
  match_basis      TEXT CHECK (match_basis IS NULL OR match_basis IN ('gtin','mpn','image','title')),  -- Eşleşme dayanağı: gtin, mpn, image, title
  observed_at      TEXT NOT NULL,  -- Görüldüğü zaman
  expires_at       TEXT NOT NULL,  -- Geçerlilik sonu
  CHECK (price_minor IS NULL OR currency IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  -- TABLO: Tekrarlanan isteklerin ikinci kez işlenmesini engeller (checkout onayı, sipariş aksiyonları). Aynı anahtarla
  --        gelen istek kaydedilmiş cevabı alır, 24 saat saklanır.
  scope           TEXT NOT NULL,  -- Kapsam (checkout.confirm, order.action:<id>, order.bulk)
  key             TEXT NOT NULL,  -- İstemcinin gönderdiği anahtar
  request_hash    TEXT NOT NULL,  -- İsteğin özeti (aynı anahtarla farklı istek reddedilir)
  response_status INTEGER,  -- Kaydedilmiş HTTP durum kodu
  response_json   TEXT CHECK (response_json IS NULL OR json_valid(response_json)),  -- Kaydedilmiş cevap
  status          TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','failed')),  -- processing / completed / failed
  expires_at      TEXT NOT NULL,  -- Silinme zamanı
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  PRIMARY KEY (scope, key)
) STRICT;

CREATE TABLE IF NOT EXISTS outbox_events (
  -- TABLO: Outbox: işlemle aynı batch te yazılan ve sonra worker ın işlediği arka plan işleri (sipariş SMS/e-postası,
  --        iyzico iadesi, kargo kaydı …). Hata olursa geri çekilerek tekrar denenir, 8 denemede dead.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  aggregate_type  TEXT NOT NULL,  -- İlgili kayıt türü (order, refund …)
  aggregate_id    TEXT NOT NULL,  -- İlgili kayıt id
  event_type      TEXT NOT NULL,  -- Olay: order.placed, order.paid, order.shipped, refund.process …
  payload_json    TEXT NOT NULL CHECK (json_valid(payload_json)),  -- Olay verisi (JSON)
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed','dead')),  -- pending, processing (5 dk kilit), done, failed, dead
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),  -- Deneme sayısı
  next_attempt_at TEXT,  -- Sıradaki deneme
  locked_until    TEXT,  -- İşleyen worker ın kilidi
  dedupe_key      TEXT NOT NULL UNIQUE,  -- Aynı olayın iki kez kuyruğa girmesini engeller (<tip>:<id>)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

CREATE TABLE IF NOT EXISTS audit_logs (
  -- TABLO: Denetim kaydı (append-only): panelde kim, ne zaman, neyi değiştirdi. Şifre/anahtar asla yazılmaz. Panel
  --        Denetim ekranı (salt okunur).
  id                 TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  actor_id           TEXT REFERENCES users(id) ON DELETE SET NULL,  -- İşlemi yapan kullanıcı
  action             TEXT NOT NULL,  -- Eylem (product.update, order.cancel, settings.update …)
  entity_type        TEXT NOT NULL,  -- Kayıt türü (product, order, user …)
  entity_id          TEXT,  -- Kayıt id
  diff_redacted_json TEXT CHECK (diff_redacted_json IS NULL OR json_valid(diff_redacted_json)),  -- Önce/sonra farkı, hassas alanlar maskeli (JSON)
  request_id         TEXT,  -- HTTP istek id (aynı istekteki kayıtları gruplamak için)
  ip_hash            TEXT,  -- IP adresinin özeti
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  -- TABLO: İstek sınırlama sayaçları (hatalı giriş, kupon deneme, webhook). Pencere başına deneme sayısı tutulur.
  bucket_key   TEXT NOT NULL,  -- Sayaç anahtarı (login-fail:<ip özeti>, coupon-fail:… )
  window_start TEXT NOT NULL,  -- Zaman penceresinin başlangıcı
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),  -- Penceredeki deneme sayısı
  expires_at   TEXT NOT NULL,  -- Sayacın silineceği zaman
  PRIMARY KEY (bucket_key, window_start)
) STRICT;

-- Optimistic-concurrency guard for multi-statement D1 batches (D1 has no BEGIN/COMMIT).
-- core/db/unit-of-work.ts inserts `changes()` of the previous statement right after it; the triggers
-- below either skip the row (count as expected) or abort the WHOLE batch with 'batch_guard_failed:<guard>'
-- so the caller knows which guard fired. The table always stays empty, so it is safely re-created here.
DROP TABLE IF EXISTS batch_guards;
CREATE TABLE batch_guards (
  -- TABLO: Teknik koruma tablosu, hep boştur. Çok adımlı D1 batch lerinde beklenen satır sayısı değişmezse trigger tüm
  --        batch i geri alır (yarış durumunda yarım yazma olmaz).
  guard    INTEGER NOT NULL,  -- Koruma sıra no (hangi guard tetiklendi)
  actual   INTEGER NOT NULL,  -- Önceki komutun gerçekten değiştirdiği satır sayısı
  expected INTEGER NOT NULL  -- Beklenen satır sayısı
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

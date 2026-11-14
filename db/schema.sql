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

CREATE TABLE IF NOT EXISTS geo_countries (
  -- TABLO: Ülkeler ve telefon kuralları (üyelik, adres, ödeme formlarındaki ülke ve telefon seçimi). Referans veri,
  --        schema.sql sonunda upsert edilir. has_regions = 1 olan ülkede il ve ilçe geo_provinces / geo_districts ten seçilir.
  code             TEXT PRIMARY KEY CHECK (length(code) = 2 AND code = upper(code)),  -- ISO 3166-1 alfa-2 kodu (bayrak dosyası /flags/<kod>.svg)
  name             TEXT NOT NULL,  -- Türkçe ülke adı
  dial_code        TEXT NOT NULL CHECK (dial_code GLOB '[1-9]*' AND length(dial_code) BETWEEN 1 AND 4),  -- Uluslararası alan kodu (+ olmadan)
  phone_min_length INTEGER NOT NULL CHECK (phone_min_length BETWEEN 2 AND 17),  -- Alan kodu hariç en kısa cep numarası
  phone_max_length INTEGER NOT NULL CHECK (phone_max_length BETWEEN phone_min_length AND 17),  -- Alan kodu hariç en uzun cep numarası
  phone_pattern    TEXT NOT NULL,  -- Alan kodu hariç cep numarası düzenli ifadesi (libphonenumber)
  phone_example    TEXT NOT NULL DEFAULT '',  -- Örnek numara (form ipucu)
  national_prefix  TEXT NOT NULL DEFAULT '',  -- Yurt içi arama ön eki (TR 0), girilirse atılır
  has_regions      INTEGER NOT NULL DEFAULT 0 CHECK (has_regions IN (0,1)),  -- İl ve ilçe listeden mi seçilir (0 serbest metin)
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Formlarda seçilebilir mi
  sort_order       INTEGER NOT NULL DEFAULT 0  -- Liste sırası (Türkiye en üstte, sonra alfabetik)
) STRICT;

CREATE TABLE IF NOT EXISTS geo_provinces (
  -- TABLO: Ülkenin birinci düzey bölgeleri (Türkiye için 81 il). Adreste il adı metin olarak saklanır, bu tablo seçim
  --        listesi ve doğrulama içindir.
  id           TEXT PRIMARY KEY,  -- Ülke kodu ve plaka (TR-34)
  country_code TEXT NOT NULL REFERENCES geo_countries(code) ON DELETE CASCADE,  -- Ülke
  code         TEXT NOT NULL,  -- Ülke içi kod (plaka kodu)
  name         TEXT NOT NULL,  -- İl adı
  UNIQUE (country_code, name)
) STRICT;

CREATE TABLE IF NOT EXISTS geo_districts (
  -- TABLO: İlçeler (Türkiye için 973 ilçe, PTT posta kodu listesi).
  id          INTEGER PRIMARY KEY,  -- Birincil anahtar
  province_id TEXT NOT NULL REFERENCES geo_provinces(id) ON DELETE CASCADE,  -- İl
  name        TEXT NOT NULL,  -- İlçe adı
  UNIQUE (province_id, name)
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

CREATE TABLE IF NOT EXISTS variant_price_history (
  -- TABLO: Varyant satış fiyatı geçmişi (Ticaret Bakanlığı indirim kuralı). Fiyat her değiştiğinde trigger açık satırı
  --        kapatır ve yenisini açar, uygulama yazmaz. Üstü çizili eski fiyat vitrinde en fazla açık satırın
  --        lowest_prior_minor değeri kadar gösterilir.
  id                 INTEGER PRIMARY KEY,  -- Sıra no
  variant_id         TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,  -- Varyant
  price_list_id      TEXT NOT NULL REFERENCES price_lists(id) ON DELETE RESTRICT,  -- Fiyat listesi
  unit_price_minor   INTEGER NOT NULL CHECK (unit_price_minor >= 0),  -- Bu aralıkta uygulanan satış fiyatı (kuruş, KDV dahil)
  valid_from         TEXT NOT NULL,  -- Fiyatın geçerli olmaya başladığı an (UTC)
  valid_to           TEXT CHECK (valid_to IS NULL OR valid_to >= valid_from),  -- Fiyatın bittiği an, NULL = şu anki fiyat
  lowest_prior_minor INTEGER CHECK (lowest_prior_minor IS NULL OR lowest_prior_minor >= 0)  -- Bu fiyattan önceki son 30 günün en düşük fiyatı, NULL = önceki fiyat bilinmiyor (indirim gösterilmez)
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
  -- Added 2026-11-14: which contract versions the customer accepted (order e-mail sends exactly these texts).
  terms_version  TEXT CHECK (terms_version IS NULL OR length(terms_version) <= 40),  -- Onaylanan sözleşme sürümleri (ms<v>-ob<v>), sipariş e-postası bu metinleri gönderir
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

-- e-Arşiv / e-Fatura records (2026-11-14). One active invoice per order. Today the PDF comes from the accounting
-- provider's portal (uploaded in the panel); an integrator adapter (integration_providers kind 'accounting') will
-- fill the same row. PDFs live in private storage ("invoices/…"), never under the public /assets route.
CREATE TABLE IF NOT EXISTS invoices (
  -- TABLO: Siparişlerin e-Arşiv / e-Fatura kayıtları. Sipariş başına tek geçerli fatura; PDF gizli depoda durur ve
  --        yalnız sipariş sahibine (üye girişi veya sipariş no + e-posta) ve personele indirilir.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,  -- Faturanın siparişi
  kind            TEXT NOT NULL DEFAULT 'e_arsiv' CHECK (kind IN ('e_arsiv','e_fatura')),  -- e_arsiv bireysel / e_fatura mükellef alıcı
  invoice_number  TEXT NOT NULL UNIQUE CHECK (length(invoice_number) = 16 AND invoice_number GLOB '[A-Z0-9][A-Z0-9][A-Z0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),  -- GİB fatura no (seri 3 karakter + yıl + 9 hane sıra)
  ettn            TEXT CHECK (ettn IS NULL OR length(ettn) = 36),  -- Faturanın evrensel tekil numarası (UUID)
  invoice_date    TEXT NOT NULL CHECK (invoice_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- Fatura tarihi (YYYY-AA-GG)
  total_minor     INTEGER NOT NULL CHECK (total_minor >= 0),  -- Fatura tutarı (KDV dahil, kuruş)
  provider        TEXT NOT NULL DEFAULT 'manual' CHECK (length(provider) BETWEEN 2 AND 40),  -- Kesen sistem: manual elle yüklendi / entegratör kodu
  provider_ref    TEXT CHECK (provider_ref IS NULL OR length(provider_ref) <= 120),  -- Entegratördeki kayıt no
  pdf_storage_key TEXT CHECK (pdf_storage_key IS NULL OR pdf_storage_key GLOB 'invoices/*'),  -- PDF in gizli depodaki anahtarı
  status          TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','cancelled')),  -- issued geçerli / cancelled iptal edildi
  cancel_reason   TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 3 AND 500),  -- İptal nedeni
  issued_by       TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Faturayı kaydeden personel
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
) STRICT;

-- Return / cancellation-right requests (2026-11-14): the customer asks, staff approve / reject, receive the goods
-- and refund through the order refund action. A request's lines may never exceed what was ordered.
CREATE TABLE IF NOT EXISTS return_requests (
  -- TABLO: Müşterinin iade (cayma hakkı) talepleri. Müşteri açar, personel onaylar/reddeder, ürün gelince sipariş iadesi
  --        ile parası ödenir. Sipariş başına aynı anda tek açık talep.
  id             TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  request_number TEXT NOT NULL UNIQUE CHECK (length(request_number) BETWEEN 4 AND 50),  -- Müşteriye gösterilen talep no (sipariş no + -I1)
  order_id       TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,  -- Talebin siparişi
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Talebi açan üye (misafirde NULL)
  status         TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','received','refunded','cancelled')),  -- requested bekliyor / approved onaylandı / rejected reddedildi / received ürün geldi / refunded parası ödendi / cancelled müşteri vazgeçti
  reason         TEXT NOT NULL CHECK (reason IN ('changed_mind','defective','wrong_item','not_as_described','damaged','other')),  -- Neden: changed_mind vazgeçtim / defective kusurlu / wrong_item yanlış ürün / not_as_described açıklamadan farklı / damaged hasarlı / other diğer
  customer_note  TEXT CHECK (customer_note IS NULL OR length(customer_note) <= 1000),  -- Müşterinin açıklaması
  reject_reason  TEXT CHECK (reject_reason IS NULL OR length(reject_reason) BETWEEN 3 AND 500),  -- Red nedeni (müşteriye gönderilir)
  staff_note     TEXT CHECK (staff_note IS NULL OR length(staff_note) <= 1000),  -- Personel notu (onayda müşteriye gönderilir)
  refund_id      TEXT REFERENCES refunds(id) ON DELETE SET NULL,  -- Ödenen iade kaydı
  decided_by     TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son kararı veren personel
  decided_at     TEXT,  -- Son karar zamanı
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  CHECK ((status = 'rejected') = (reject_reason IS NOT NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS return_request_items (
  -- TABLO: İade talebindeki ürünler ve adetleri. Bir kalemin açık + tamamlanmış taleplerdeki toplamı sipariş adedini
  --        geçemez (uygulama batch içinde kontrol eder).
  id                TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  return_request_id TEXT NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,  -- Talep
  order_id          TEXT NOT NULL,  -- Sipariş (kalemle birlikte doğrulanır)
  order_item_id     TEXT NOT NULL,  -- İade edilen sipariş kalemi
  quantity          INTEGER NOT NULL CHECK (quantity > 0),  -- İade adedi
  UNIQUE (return_request_id, order_item_id),
  FOREIGN KEY (order_item_id, order_id) REFERENCES order_items(id, order_id) ON DELETE RESTRICT
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

-- Bot protection (CAPTCHA) for storefront forms: one row. The provider decides (Turnstile / reCAPTCHA v3); the secret
-- key is sealed like the SMTP password. `verified_at` = last successful widget check in the panel; protection can only
-- be switched on with a fresh check, so a wrong site key never locks customers out.
CREATE TABLE IF NOT EXISTS captcha_settings (
  -- TABLO: Bot koruması (CAPTCHA) ayarı, tek satır. Hangi formların korunacağı ve sağlayıcı anahtarları. Gizli anahtar
  --        AES-256-GCM ile şifreli, tarayıcıya hiç gönderilmez.
  id                TEXT PRIMARY KEY CHECK (id = 'default'),  -- Hep default
  enabled           INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),  -- Koruma açık mı
  provider          TEXT NOT NULL CHECK (provider IN ('turnstile','recaptcha_v3')),  -- Sağlayıcı (turnstile veya recaptcha_v3)
  site_key          TEXT NOT NULL CHECK (length(site_key) BETWEEN 10 AND 100),  -- Herkese açık site anahtarı
  secret_ciphertext TEXT NOT NULL,  -- Şifreli gizli anahtar
  secret_nonce      TEXT NOT NULL,  -- Şifreleme nonce değeri
  secret_auth_tag   TEXT NOT NULL,  -- GCM doğrulama etiketi
  key_version       TEXT NOT NULL,  -- Ana anahtar sürümü (v1)
  secret_hint       TEXT NOT NULL CHECK (length(secret_hint) <= 8),  -- Gizli anahtarın son karakterleri (panelde gösterim)
  forms             TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(forms) AND json_type(forms) = 'array'),  -- Korunan formlar JSON dizisi (signup login forgot review)
  min_score         REAL NOT NULL DEFAULT 0.5 CHECK (min_score BETWEEN 0.1 AND 0.9),  -- reCAPTCHA v3 en düşük insan skoru
  verified_at       TEXT,  -- Anahtarların panelde son başarılı doğrulama zamanı
  updated_by        TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
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
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- Aktif mi (0/1), pasif kayıt kullanılmaz / vitrinde görünmez
  -- Added 2026-11-14: panel Kargo ücretleri edits are guarded on it (409 shipping_method_changed).
  updated_at       TEXT  -- Son güncelleme zamanı (panel eşzamanlı düzenleme kontrolü)
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

-- Cookie consent + tracking tags (Entegrasyonlar › Çerez onayı & izleme; module src/modules/consent). The tag catalog
-- (GA4, GTM, Meta Pixel …) lives in code (consent/domain/tags.ts): a tag needs a browser adapter anyway, so a vendor
-- is added in code, not by a catalog row. The browser stores the visitor's choice in the nova_consent cookie; every
-- choice is also written here as proof (KVKK: who agreed to which revision, when).
CREATE TABLE IF NOT EXISTS consent_settings (
  -- TABLO: Çerez onayı ayarları (tek satır): banner açık mı, hangi onay aracı (yerleşik banner veya harici CMP), görünüm,
  --        metinler, Google Consent Mode tipi ve onay revizyonu (artınca ziyaretçilere yeniden sorulur).
  id                   INTEGER PRIMARY KEY CHECK (id = 1),  -- Hep 1
  banner_enabled       INTEGER NOT NULL DEFAULT 1 CHECK (banner_enabled IN (0,1)),  -- 1 = onay sorulur. 0 = banner yok ve yalnız zorunlu çerezler çalışır (izleme etiketleri yüklenmez)
  consent_provider     TEXT NOT NULL DEFAULT 'builtin' CHECK (consent_provider IN ('builtin','cookiebot','onetrust','usercentrics')),  -- Onayı toplayan araç: builtin (bizim banner) veya harici CMP
  provider_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(provider_config_json) AND json_type(provider_config_json) = 'object'),  -- Harici CMP ayarları (hesap id gibi açık değerler)
  layout               TEXT NOT NULL DEFAULT 'bar' CHECK (layout IN ('bar','box','modal')),  -- Banner görünümü: bar alt şerit / box köşe kutusu / modal ortada pencere
  texts_json           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(texts_json) AND json_type(texts_json) = 'object'),  -- Banner metinleri (boş alan = varsayılan metin)
  google_consent_mode  TEXT NOT NULL DEFAULT 'basic' CHECK (google_consent_mode IN ('basic','advanced')),  -- basic Google etiketi onaydan önce hiç yüklenmez / advanced reddedilmiş sinyalle yüklenir (çerezsiz ölçüm)
  consent_max_age_days INTEGER NOT NULL DEFAULT 365 CHECK (consent_max_age_days BETWEEN 30 AND 395),  -- Verilen onayın geçerlilik süresi (gün), sonra yeniden sorulur
  revision             INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),  -- Onay revizyonu. Yeni izleme firması eklenince veya panelden istenince artar
  updated_by           TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS tracking_tags (
  -- TABLO: Mağazaya bağlanan analitik / reklam etiketleri (GA4, Google Tag Manager, Google Ads, Meta Pixel, TikTok,
  --        Clarity, Yandex Metrica). Firma başına bir satır. Etiket yalnız ziyaretçi ilgili çerez kategorisine onay verince yüklenir.
  provider_code TEXT PRIMARY KEY CHECK (provider_code GLOB '[a-z]*' AND length(provider_code) <= 40),  -- Etiket firması kodu (kod içindeki katalogdan: ga4, gtm, meta_pixel …)
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- 1 = vitrine yüklenir
  config_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json) AND json_type(config_json) = 'object'),  -- Açık kimlikler (ölçüm id, piksel id …). Gizli anahtar burada tutulmaz
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_by    TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS cookie_consents (
  -- TABLO: Ziyaretçilerin çerez tercihleri (ispat kaydı, değiştirilemez): hangi ziyaretçi hangi revizyonda hangi
  --        kategorilere izin verdi. Ziyaretçi kimliği tarayıcıdaki nova_consent çerezindeki rastgele id dir.
  id          TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  visitor_id  TEXT NOT NULL CHECK (length(visitor_id) BETWEEN 8 AND 64),  -- Tarayıcıdaki rastgele ziyaretçi id si (kişisel veri içermez)
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Giriş yapmış müşteri (varsa)
  revision    TEXT NOT NULL,  -- Onaylanan revizyon: r<ayar revizyonu>-cp<çerez politikası sürümü>
  functional  INTEGER NOT NULL CHECK (functional IN (0,1)),  -- İşlevsel çerezlere izin
  analytics   INTEGER NOT NULL CHECK (analytics IN (0,1)),  -- Analitik çerezlere izin
  marketing   INTEGER NOT NULL CHECK (marketing IN (0,1)),  -- Pazarlama / reklam çerezlerine izin
  action      TEXT NOT NULL CHECK (action IN ('accept_all','reject_all','custom')),  -- Ziyaretçinin seçimi: accept_all, reject_all, custom
  source      TEXT NOT NULL CHECK (source IN ('banner','preferences','external')),  -- Nereden: banner, preferences (Çerez tercihleri penceresi), external (harici CMP)
  ip_hash     TEXT,  -- IP adresinin HMAC özeti (ham IP saklanmaz)
  user_agent  TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300),  -- Tarayıcı bilgisi (kısaltılmış)
  recorded_at TEXT NOT NULL  -- Tercihin kaydedildiği zaman
) STRICT;

CREATE TABLE IF NOT EXISTS tracking_tag_secrets (
  -- TABLO: Etiketlerin sunucu tarafı gizli anahtarları (GA4 Measurement Protocol API secret, Meta Conversions API
  --        erişim jetonu). AES-256-GCM ile şifreli, ana anahtar SECRETS_MASTER_KEY. Tarayıcıya hiç gönderilmez.
  provider_code TEXT NOT NULL REFERENCES tracking_tags(provider_code) ON DELETE CASCADE,  -- Etiket firması kodu (ga4, meta_pixel)
  secret_name   TEXT NOT NULL CHECK (secret_name GLOB '[a-z]*' AND length(secret_name) <= 40),  -- Sır adı (apiSecret, accessToken)
  ciphertext    TEXT NOT NULL,  -- Şifreli değer
  nonce         TEXT NOT NULL,  -- Şifreleme nonce değeri
  auth_tag      TEXT NOT NULL,  -- GCM doğrulama etiketi
  key_version   TEXT NOT NULL,  -- Ana anahtar sürümü (v1)
  hint          TEXT NOT NULL CHECK (length(hint) <= 8),  -- Değerin son karakterleri (panelde …abcd gösterimi)
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  PRIMARY KEY (provider_code, secret_name)
) STRICT;

CREATE TABLE IF NOT EXISTS order_tracking_contexts (
  -- TABLO: Sipariş anında ziyaretçinin çerez onayı ve reklam/analitik tanımlayıcıları. Satın alma olayı ödeme onaylanınca
  --        sunucudan (GA4 Measurement Protocol, Meta Conversions API) bu bilgilerle gönderilir. Yalnız ziyaretçi analitik
  --        veya pazarlama çerezine izin verdiyse satır yazılır ve yalnız izin verilen firmaya gönderilir.
  order_id        TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,  -- Sipariş
  visitor_id      TEXT NOT NULL CHECK (length(visitor_id) BETWEEN 8 AND 64),  -- nova_consent çerezindeki ziyaretçi id si
  analytics       INTEGER NOT NULL CHECK (analytics IN (0,1)),  -- Sipariş anında analitik çerez izni
  marketing       INTEGER NOT NULL CHECK (marketing IN (0,1)),  -- Sipariş anında pazarlama çerez izni
  ga_client_id    TEXT CHECK (ga_client_id IS NULL OR length(ga_client_id) <= 64),  -- _ga çerezinden GA4 istemci kimliği
  ga_session_id   TEXT CHECK (ga_session_id IS NULL OR length(ga_session_id) <= 32),  -- _ga_<akış> çerezinden GA4 oturum kimliği
  fbp             TEXT CHECK (fbp IS NULL OR length(fbp) <= 128),  -- Meta _fbp çerezi
  fbc             TEXT CHECK (fbc IS NULL OR length(fbc) <= 512),  -- Meta _fbc çerezi (reklam tıklaması)
  client_ip       TEXT CHECK (client_ip IS NULL OR length(client_ip) <= 45),  -- İstemci IP adresi (yalnız pazarlama izninde, Meta eşleştirmesi için)
  user_agent      TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300),  -- Tarayıcı bilgisi (yalnız pazarlama izninde)
  page_url        TEXT CHECK (page_url IS NULL OR length(page_url) <= 500),  -- Siparişin verildiği sayfa adresi
  ga4_sent_at     TEXT,  -- GA4 e satın almanın gönderildiği zaman (tekrar gönderimi engeller)
  meta_sent_at    TEXT,  -- Meta ya satın almanın gönderildiği zaman (tekrar gönderimi engeller)
  created_at      TEXT NOT NULL  -- Kayıt zamanı (sipariş anı)
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

-- Live support (Canlı destek; module src/modules/support). Members chat with staff; messages are pushed through a
-- GraphQL subscription over SSE. Unread counters and last_seq are kept on the conversation (written in the same batch
-- as the message), so badges and inbox rows never count messages. One open conversation per customer.
CREATE TABLE IF NOT EXISTS support_settings (
  -- TABLO: Canlı destek ayarları (tek satır): modül açık mı, mağazadaki pencerenin başlığı, karşılama ve çevrimdışı
  --        mesajı. Kapalıyken mağazada buton görünmez ve yeni mesaj kabul edilmez.
  id              INTEGER PRIMARY KEY CHECK (id = 1),  -- Hep 1
  enabled         INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),  -- 1 = canlı destek mağazada açık
  team_name       TEXT NOT NULL DEFAULT 'Müşteri hizmetleri' CHECK (length(team_name) BETWEEN 1 AND 60),  -- Pencere başlığı
  welcome_message TEXT NOT NULL DEFAULT 'Merhaba, size nasıl yardımcı olabiliriz?' CHECK (length(welcome_message) BETWEEN 1 AND 300),  -- Temsilci çevrimiçiyken gösterilen karşılama
  offline_message TEXT NOT NULL DEFAULT 'Şu an çevrimiçi temsilcimiz yok. Mesajınızı bırakın, en kısa sürede yanıtlayalım.' CHECK (length(offline_message) BETWEEN 1 AND 300),  -- Temsilci yokken gösterilen metin
  updated_by      TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS support_conversations (
  -- TABLO: Canlı destek konuşmaları (müşteri başına en fazla bir açık). Okunmamış sayaçları ve son mesaj özeti burada
  --        tutulur, panel listesi ve rozetler mesaj saymaz.
  id                TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  customer_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- Konuşmayı başlatan üye
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),  -- open (açık) / closed (kapatıldı)
  assigned_to       TEXT REFERENCES users(id) ON DELETE SET NULL,  -- İlk yanıtlayan personel
  page_path         TEXT CHECK (page_path IS NULL OR (page_path GLOB '/*' AND length(page_path) <= 300)),  -- Konuşmanın başladığı mağaza sayfası
  last_seq          INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),  -- Son mesajın sıra no
  last_message_at   TEXT,  -- Son mesaj zamanı (liste sırası)
  last_preview      TEXT CHECK (last_preview IS NULL OR length(last_preview) <= 160),  -- Son mesajın kısaltılmış metni
  last_sender       TEXT CHECK (last_sender IS NULL OR last_sender IN ('customer','staff')),  -- Son yazan taraf
  staff_unread      INTEGER NOT NULL DEFAULT 0 CHECK (staff_unread >= 0),  -- Personelin okumadığı müşteri mesajı sayısı
  customer_unread   INTEGER NOT NULL DEFAULT 0 CHECK (customer_unread >= 0),  -- Müşterinin okumadığı personel mesajı sayısı
  staff_read_seq    INTEGER NOT NULL DEFAULT 0 CHECK (staff_read_seq >= 0),  -- Personelin okuduğu son sıra no
  customer_read_seq INTEGER NOT NULL DEFAULT 0 CHECK (customer_read_seq >= 0),  -- Müşterinin okuduğu son sıra no (görüldü bilgisi)
  closed_by         TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Kapatan personel
  closed_at         TEXT,  -- Kapatılma zamanı
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;

CREATE TABLE IF NOT EXISTS support_messages (
  -- TABLO: Canlı destek mesajları. seq konuşma içinde artan sıra no, kopan bağlantı bu numaradan sonrasını ister.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  conversation_id TEXT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,  -- Konuşma
  seq             INTEGER NOT NULL CHECK (seq >= 1),  -- Konuşma içindeki sıra no
  sender          TEXT NOT NULL CHECK (sender IN ('customer','staff')),  -- Yazan taraf
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Yazan kişi (müşteri veya personel)
  body            TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),  -- Mesaj metni (düz metin)
  client_id       TEXT NOT NULL CHECK (length(client_id) BETWEEN 8 AND 64),  -- Tarayıcının ürettiği anahtar, tekrar gönderimde çift kayıt olmaz
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Gönderim zamanı (UTC ISO-8601)
  UNIQUE (conversation_id, seq),
  UNIQUE (conversation_id, client_id)
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
CREATE INDEX IF NOT EXISTS ix_cookie_consents_visitor ON cookie_consents (visitor_id, recorded_at);
CREATE INDEX IF NOT EXISTS ix_cookie_consents_recorded ON cookie_consents (recorded_at);
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_order_active  ON invoices(order_id) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS ix_return_requests_order             ON return_requests(order_id, status);
CREATE INDEX IF NOT EXISTS ix_return_requests_status            ON return_requests(status, created_at);
CREATE INDEX IF NOT EXISTS ix_return_request_items_item         ON return_request_items(order_item_id);
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
CREATE INDEX IF NOT EXISTS ix_price_history_variant      ON variant_price_history(variant_id, price_list_id, valid_to);
CREATE UNIQUE INDEX IF NOT EXISTS ux_price_history_open  ON variant_price_history(variant_id, price_list_id) WHERE valid_to IS NULL;
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_support_open_customer ON support_conversations(customer_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS ix_support_conv_customer    ON support_conversations(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_support_conv_inbox       ON support_conversations(status, last_message_at DESC);

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
-- consent proof: rows are never changed (old rows may be pruned by retention)
CREATE TRIGGER IF NOT EXISTS trg_cookie_consents_no_update BEFORE UPDATE ON cookie_consents
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
 ('twilio','sms','Twilio','Uluslararası SMS.','https://www.twilio.com','planned','[]','[]',80),
 ('parasut','accounting','Paraşüt','e-Arşiv / e-Fatura kesimi ve muhasebe kaydı.','https://www.parasut.com','planned','[]','[]',10),
 ('birfatura','accounting','BirFatura','Pazaryeri ve e-ticaret siparişlerinden otomatik e-Arşiv / e-Fatura.','https://www.birfatura.com','planned','[]','[]',20),
 ('uyumsoft','accounting','Uyumsoft','Özel entegratör: e-Arşiv / e-Fatura.','https://www.uyumsoft.com','planned','[]','[]',30),
 ('qnb_efinans','accounting','QNB eSolutions (eFinans)','Özel entegratör: e-Arşiv / e-Fatura.','https://www.qnbesolutions.com.tr','planned','[]','[]',40),
 ('logo_efatura','accounting','Logo e-Fatura / e-Arşiv','Logo İşbaşı ve Logo özel entegratör.','https://www.logo.com.tr','planned','[]','[]',50),
 ('nilvera','accounting','Nilvera','Özel entegratör: e-Arşiv / e-Fatura API.','https://www.nilvera.com','planned','[]','[]',60),
 ('sovos','accounting','Sovos (Foriba)','Özel entegratör: e-Arşiv / e-Fatura.','https://www.sovos.com','planned','[]','[]',70)
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
-- Price history for the 30-day lowest price rule (variant_price_history). Every write path (editor, Excel, feeds,
-- SQL) goes through variant_prices, so the history is kept here, not in application code. A new price closes the
-- open row and opens one carrying the lowest price of the 30 days before it (rows that ended inside the window).
-- -----------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_price_history_ins
AFTER INSERT ON variant_prices
BEGIN
  UPDATE variant_price_history SET valid_to = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE variant_id = NEW.variant_id AND price_list_id = NEW.price_list_id AND valid_to IS NULL;
  INSERT INTO variant_price_history (variant_id, price_list_id, unit_price_minor, valid_from, lowest_prior_minor)
  SELECT NEW.variant_id, NEW.price_list_id, NEW.unit_price_minor, strftime('%Y-%m-%dT%H:%M:%fZ','now'), MIN(h.unit_price_minor)
    FROM variant_price_history h
   WHERE h.variant_id = NEW.variant_id AND h.price_list_id = NEW.price_list_id
     AND h.valid_to > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days');
END;
CREATE TRIGGER IF NOT EXISTS trg_price_history_upd
AFTER UPDATE OF unit_price_minor ON variant_prices
WHEN NEW.unit_price_minor <> OLD.unit_price_minor
BEGIN
  UPDATE variant_price_history SET valid_to = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE variant_id = NEW.variant_id AND price_list_id = NEW.price_list_id AND valid_to IS NULL;
  INSERT INTO variant_price_history (variant_id, price_list_id, unit_price_minor, valid_from, lowest_prior_minor)
  SELECT NEW.variant_id, NEW.price_list_id, NEW.unit_price_minor, strftime('%Y-%m-%dT%H:%M:%fZ','now'), MIN(h.unit_price_minor)
    FROM variant_price_history h
   WHERE h.variant_id = NEW.variant_id AND h.price_list_id = NEW.price_list_id
     AND h.valid_to > strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days');
END;
CREATE TRIGGER IF NOT EXISTS trg_price_history_del
AFTER DELETE ON variant_prices
BEGIN
  UPDATE variant_price_history SET valid_to = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE variant_id = OLD.variant_id AND price_list_id = OLD.price_list_id AND valid_to IS NULL;
END;

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
INSERT OR IGNORE INTO consent_settings (id) VALUES (1);

-- Live support reference rows (insert only). The permission is also added here so existing databases get it from
-- `db:schema`, on a fresh database the seed gives it to the admin role (roles exist only after the seed).
INSERT OR IGNORE INTO support_settings (id) VALUES (1);
INSERT OR IGNORE INTO permissions (id, code, description) VALUES ('perm_18','support.chat','Canlı destek konuşmalarını yanıtlama');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'admin' AND p.code = 'support.chat';

-- Price history: prices that existed before variant_price_history get an open row from their last change. Their
-- earlier prices are unknown, so lowest_prior_minor stays NULL (no struck-through price until the next real drop).
INSERT INTO variant_price_history (variant_id, price_list_id, unit_price_minor, valid_from)
SELECT vp.variant_id, vp.price_list_id, vp.unit_price_minor, vp.updated_at FROM variant_prices vp
 WHERE NOT EXISTS (SELECT 1 FROM variant_price_history h WHERE h.variant_id = vp.variant_id AND h.price_list_id = vp.price_list_id AND h.valid_to IS NULL);

-- Ülke, il ve ilçe referans verisi (scripts ile üretildi, elle düzenlenmez). Telefon kuralları libphonenumber mobil
-- verisinden, il ve ilçeler PTT posta kodu listesinden (turkey-neighbourhoods). Tekrar çalıştırılabilir (upsert).
INSERT INTO geo_countries (code, name, dial_code, phone_min_length, phone_max_length, phone_pattern, phone_example, national_prefix, has_regions, sort_order) VALUES
  ('TR', 'Türkiye', '90', 10, 10, '5(?:61(?:011|61\d)|82[2-5]\d\d)\d{4}|5(?:[03-5]\d|1[06]|24|6[24]|7[245]|9[46])\d{7}', '501 234 56 78', '0', 1, 0),
  ('VI', 'ABD Virjin Adaları', '1', 10, 10, '[58]\d{9}|(?:34|90)0\d{7}', '(340) 642-1234', '1', 0, 1),
  ('AF', 'Afganistan', '93', 9, 9, '7\d{8}', '70 123 4567', '0', 0, 2),
  ('AX', 'Åland Adaları', '358', 6, 10, '(?:4[0-8]|50)\d{4,8}', '41 2345678', '0', 0, 3),
  ('DE', 'Almanya', '49', 10, 11, '1(?:6[023]|7\d)\d{7,8}|15(?:[0-25-9]\d\d|3(?:10|33)|410)\d{6}', '1512 3456789', '0', 0, 4),
  ('US', 'Amerika Birleşik Devletleri', '1', 10, 10, '[2-9]\d{9}|3\d{6}', '(201) 555-0123', '1', 0, 5),
  ('AS', 'Amerikan Samoası', '1', 10, 10, '684(?:2(?:48|5[2468]|7[246])|7(?:3[13]|70|82))\d{4}', '(684) 733-1234', '1', 0, 6),
  ('AD', 'Andorra', '376', 6, 9, '690\d{6}|[356]\d{5}', '312 345', '', 0, 7),
  ('AO', 'Angola', '244', 9, 9, '9[1-79]\d{7}', '923 123 456', '', 0, 8),
  ('AI', 'Anguilla', '1', 10, 10, '264(?:235|4(?:69|7[67])|5(?:3[6-9]|8[1-4])|7(?:29|72))\d{4}', '(264) 235-1234', '1', 0, 9),
  ('AG', 'Antigua ve Barbuda', '1', 10, 10, '268(?:464|7(?:1[3-9]|[28]\d|3[0246]|64|7[0-689]))\d{4}', '(268) 464-1234', '1', 0, 10),
  ('AR', 'Arjantin', '54', 10, 11, '93(?:7(?:1[15]|81)|8(?:21|4[16]|69|9[12]))[46]\d{5}|9(?:2(?:2(?:2[59]|44|52)|3(?:26|44)|47[35]|9(?:[07]2|2[26]|34|46))|3327)[45]\d{5}|9(?:2(?:657|9(?:54|66))|3(?:48[27]|7(?:55|77)|8(?:65|78)))[2-8]\d{5}|9(?:2(?:284|3(?:02|23)|477|622|920)|3(?:4(?:46|89|92)|541))[2-7]\d{5}|(?:675\d|9(?:11[0-8]\d|2(?:2(?:0[45]|1[2-6]|3[3-6])|3(?:[06]4|7[45])|494|6(?:04|1[2-8]|[36][45]|4[3-6])|80[45]|9(?:[17][4-6]|[48][45]|9[3-6]))|3(?:364|4(?:1[2-8]|[25][4-6]|3[3-6]|84)|5(?:1[2-9]|[38][4-6])|6(?:2[45]|44)|7[069][45]|8(?:0[45]|1[2-7]|3[4-6]|5[3-6]|7[2-6]|8[3-68]))))\d{6}|9(?:2(?:2(?:62|81)|320|9(?:42|83))|3(?:329|4(?:62|7[16])|5(?:43|64)|7(?:18|5[17])))[2-6]\d{5}|92(?:2(?:21|4[23]|6[145]|7[1-4]|8[356]|9[267])|3(?:16|3[13-8]|43|5[346-8]|9[3-5])|6(?:2[46]|4[78]|5[1568])|9(?:03|2[1457-9]|3[1356]|4[08]|[56][23]|82))4\d{5}|9(?:2(?:257|3(?:24|46|92)|9(?:01|23|64))|3(?:4(?:42|64)|5(?:25|37|4[47]|71)|7(?:35|72)|825))[3-6]\d{5}|9(?:2(?:2(?:02|2[3467]|4[156]|5[45]|6[6-8]|91)|3(?:1[47]|25|[45][25]|96)|47[48]|625|932)|3(?:38[2578]|4(?:0[0-24-9]|3[78]|4[457]|58|6[035-9]|72|83|9[136-8])|5(?:2[124]|[368][23]|4[2689]|7[2-6])|7(?:16|2[15]|3[14]|4[13]|5[468]|7[3-5]|8[26])|8(?:2[67]|3[278]|4[3-5]|5[78]|6[1-378]|[78]7|94)))[4-6]\d{5}', '11 15-2345-6789', '0', 0, 11),
  ('AL', 'Arnavutluk', '355', 9, 9, '6(?:[78][2-9]|9\d)\d{6}', '67 212 3456', '0', 0, 12),
  ('AW', 'Aruba', '297', 7, 7, '(?:290|5[69]\d|6(?:[03]0|22|4[0-2]|[69]\d)|7(?:[34]\d|7[07])|9(?:6[45]|9[4-8]))\d{4}', '560 1234', '', 0, 13),
  ('AC', 'Ascension Adası', '247', 5, 5, '[2-47]\d{4}', '40123', '', 0, 14),
  ('AU', 'Avustralya', '61', 9, 9, '4(?:79[01]|83[0-36-9]|9(?:5[0-3]|6[0-4]))\d{5}|4(?:[0-36]\d|4[047-9]|[58][0-24-9]|7[02-8]|9[0-47-9])\d{6}', '412 345 678', '0', 0, 15),
  ('AT', 'Avusturya', '43', 7, 13, '6(?:485|(?:5[0-3579]|6[013-9]|[7-9]\d)\d)\d{3,9}', '664 123456', '0', 0, 16),
  ('AZ', 'Azerbaycan', '994', 9, 9, '36554\d{4}|(?:[16]0|4[04]|5[015]|7[07]|99)\d{7}', '40 123 45 67', '0', 0, 17),
  ('BS', 'Bahamalar', '1', 10, 10, '242(?:3(?:5[79]|7[56]|95)|4(?:[23][1-9]|4[1-35-9]|5[1-8]|6[2-8]|7\d|81)|5(?:2[45]|3[35]|44|5[1-46-9]|65|77)|6[34]6|7(?:27|38)|8(?:0[1-9]|1[02-9]|2\d|3[0-4]|[89]9))\d{4}', '(242) 359-1234', '1', 0, 18),
  ('BH', 'Bahreyn', '973', 8, 8, '(?:3(?:[0-79]\d|8[0-57-9])\d|6(?:3(?:00|33|6[16])|441|6(?:3[03-9]|[69]\d|7[0-689])))\d{4}', '3600 1234', '', 0, 19),
  ('BD', 'Bangladeş', '880', 10, 10, '(?:1[13-9]|64)\d{8}|(?:3[78]|44|66)[02-9]\d{7}', '1812-345678', '0', 0, 20),
  ('BB', 'Barbados', '1', 10, 10, '246(?:(?:2(?:[3568]\d|4[0-57-9])|3(?:5[2-9]|6[0-6])|4(?:46|5\d)|69[5-7]|8(?:[2-5]\d|83))\d|52(?:1[147]|20))\d{3}', '(246) 250-1234', '1', 0, 21),
  ('EH', 'Batı Sahra', '212', 9, 9, '(?:6(?:[0-79]\d|8[0-247-9])|7(?:[016-8]\d|2[0-8]|3[01]|5[0-5]))\d{6}', '6 50 12 34 56', '0', 0, 22),
  ('BY', 'Belarus', '375', 9, 9, '(?:2(?:5[5-79]|9[1-9])|(?:33|44)\d)\d{6}', '8 029 491-19-11', '8', 0, 23),
  ('BE', 'Belçika', '32', 9, 9, '4[5-9]\d{7}', '450 00 12 34', '0', 0, 24),
  ('BZ', 'Belize', '501', 7, 7, '6[0-35-7]\d{5}', '622-1234', '', 0, 25),
  ('BJ', 'Benin', '229', 10, 10, '01(?:2[5-9]|[4-69]\d)\d{6}', '1 95 12 34 56', '', 0, 26),
  ('BM', 'Bermuda', '1', 10, 10, '441(?:[2378]\d|5[0-39]|9[02])\d{5}', '(441) 370-1234', '1', 0, 27),
  ('AE', 'Birleşik Arap Emirlikleri', '971', 9, 9, '5[02-68]\d{7}', '50 123 4567', '0', 0, 28),
  ('GB', 'Birleşik Krallık', '44', 10, 10, '7(?:457[0-57-9]|700[01]|911[028])\d{5}|7(?:[1-3]\d\d|4(?:[0-46-9]\d|5[0-689])|5(?:0[0-8]|[13-9]\d|2[0-35-9])|7(?:0[1-9]|[1-7]\d|8[02-9]|9[0-689])|8(?:[014-9]\d|[23][0-8])|9(?:[024-9]\d|1[02-9]|3[0-689]))\d{6}', '7400 123456', '0', 0, 29),
  ('BO', 'Bolivya', '591', 8, 8, '(?:57|[67]\d)\d{6}', '71234567', '0', 0, 30),
  ('BA', 'Bosna-Hersek', '387', 8, 9, '6040\d{5}|6(?:03|[1-356]|44|7\d)\d{6}', '61 123 456', '0', 0, 31),
  ('BW', 'Botsvana', '267', 8, 8, '7(?:[1-8]\d{3}|9(?:(?:[03]\d|2[0-7])\d|1(?:0[13-9]|1[0-35-9]|2\d|3[0-8])))\d{3}', '71 123 456', '', 0, 32),
  ('BR', 'Brezilya', '55', 10, 11, '(?:[14689][1-9]|2[12478]|3[1-578]|5[13-5]|7[13-579])(?:7|9\d)\d{7}', '(11) 96123-4567', '0', 0, 33),
  ('IO', 'Britanya Hint Okyanusu Toprakları', '246', 7, 7, '38\d{5}', '380 1234', '', 0, 34),
  ('VG', 'Britanya Virjin Adaları', '1', 10, 10, '284(?:245|3(?:0[0-3]|4[0-7]|68|9[34])|4(?:4[0-6]|68|9[69])|5(?:4[0-7]|68|9[69]))\d{4}', '(284) 300-1234', '1', 0, 35),
  ('BN', 'Brunei', '673', 7, 7, '(?:22[89]|[78]\d\d)\d{4}', '712 3456', '', 0, 36),
  ('BG', 'Bulgaristan', '359', 8, 9, '(?:43[07-9]|99[69]\d)\d{5}|(?:8[7-9]|98)\d{7}', '43 012 345', '0', 0, 37),
  ('BF', 'Burkina Faso', '226', 8, 8, '(?:0[1-7]|4[4-6]|5[0-8]|[67]\d)\d{6}', '70 12 34 56', '', 0, 38),
  ('BI', 'Burundi', '257', 8, 8, '(?:29|6[1-9]|7[125-9])\d{6}', '79 56 12 34', '', 0, 39),
  ('BT', 'Butan', '975', 8, 8, '(?:1[67]|[78]7)\d{6}', '17 12 34 56', '', 0, 40),
  ('CV', 'Cabo Verde', '238', 7, 7, '(?:36|5[1-37-9]|9\d)\d{5}', '991 12 34', '', 0, 41),
  ('KY', 'Cayman Adaları', '1', 10, 10, '345(?:32[1-9]|4(?:1[2-6]|2[0-4])|5(?:1[67]|2[5-79]|4[6-9]|50|76)|649|82[56]|9(?:1[679]|2[2-9]|3[06-9]|90))\d{4}', '(345) 323-1234', '1', 0, 42),
  ('GI', 'Cebelitarık', '350', 8, 8, '5251[0-4]\d{3}|(?:5(?:[146-8]\d\d|250)|60(?:1[01]|6\d))\d{4}', '57123456', '', 0, 43),
  ('DZ', 'Cezayir', '213', 9, 9, '5(?:4[0-29]|6[0-4])\d{6}|(?:55|6\d|7[7-9])\d{7}', '551 23 45 67', '0', 0, 44),
  ('CX', 'Christmas Adası', '61', 9, 9, '4(?:79[01]|83[0-36-9]|9(?:5[0-3]|6[0-4]))\d{5}|4(?:[0-36]\d|4[047-9]|[58][0-24-9]|7[02-8]|9[0-47-9])\d{6}', '412 345 678', '0', 0, 45),
  ('DJ', 'Cibuti', '253', 8, 8, '77\d{6}', '77 83 10 01', '', 0, 46),
  ('CC', 'Cocos (Keeling) Adaları', '61', 9, 9, '4(?:79[01]|83[0-36-9]|9(?:5[0-3]|6[0-4]))\d{5}|4(?:[0-36]\d|4[047-9]|[58][0-24-9]|7[02-8]|9[0-47-9])\d{6}', '412 345 678', '0', 0, 47),
  ('CK', 'Cook Adaları', '682', 5, 5, '[578]\d{4}', '71 234', '', 0, 48),
  ('CI', 'Côte d’Ivoire', '225', 10, 10, '0[157]\d{8}', '1 23 45 6789', '', 0, 49),
  ('CW', 'Curaçao', '599', 7, 8, '953[01]\d{4}|9(?:5[12467]|6[5-9])\d{5}', '9 518 1234', '', 0, 50),
  ('TD', 'Çad', '235', 8, 8, '(?:3[01]|[69]\d|77|8[5-7])\d{6}', '63 01 23 45', '', 0, 51),
  ('CZ', 'Çekya', '420', 9, 9, '7060\d{5}|(?:60[1-8]|7(?:0[2-5]|19|[2379]\d))\d{6}', '601 123 456', '', 0, 52),
  ('CN', 'Çin', '86', 11, 11, '1(?:610\d|740[0-5])\d{6}|1(?:[38]\d|4[57]|[59][0-35-9]|6[25-7]|7[0-35-8])\d{8}', '131 2345 6789', '0', 0, 53),
  ('HK', 'Çin Hong Kong ÖİB', '852', 8, 8, '(?:4(?:0(?:6[0-3]|9[3-6])|24[3-6]|44[0-35-9]|6(?:4[0-57-9]|6[0-6])|7(?:4[0-48]|6[0-5]))|5(?:25[3-7]|35[4-8]|73[0-6]|95[0-8])|6(?:26[013-8]|(?:66|78)[0-5])|7(?:0(?:7[1-8]|8[0-8])|10[1-4])|84(?:4[0-2]|8[0-35-9])|9(?:29[013-9]|39[014-9]|59[0-467]|899))\d{4}|(?:4(?:4[0-35-9]|6[0-357-9]|7[0-35])|5(?:[1-59][0-46-9]|6[0-4689]|7[0-246-9])|6(?:0[1-9]|[13-59]\d|[268][0-57-9]|7[0-79])|70[1-59]|84[0-39]|9(?:0[1-9]|1[02-9]|[2358][0-8]|[467]\d))\d{5}', '5123 4567', '', 0, 54),
  ('MO', 'Çin Makao ÖİB', '853', 8, 8, '6800[0-79]\d{3}|6(?:[235]\d\d|6(?:0[0-5]|[1-9]\d)|8(?:0[1-9]|[14-8]\d|2[5-9]|[39][0-4]))\d{4}', '6612 3456', '', 0, 55),
  ('DK', 'Danimarka', '45', 8, 8, '(?:2[6-8]|6[78]|96)\d{6}|(?:2[0-59]|3[0-689]|[457]\d|6[0-69]|8[126-9]|9[1-47-9])[1-9]\d{5}', '34 41 23 45', '', 0, 56),
  ('DO', 'Dominik Cumhuriyeti', '1', 10, 10, '8[024]9[2-9]\d{6}', '(809) 234-5678', '1', 0, 57),
  ('DM', 'Dominika', '1', 10, 10, '767(?:2(?:[2-4689]5|7[5-7])|31[5-7]|61[1-8]|70[1-6])\d{4}', '(767) 225-1234', '1', 0, 58),
  ('EC', 'Ekvador', '593', 9, 9, '964[0-2]\d{5}|9(?:3[0-29]|[57][89]|6[0-36-9]|[89]\d)\d{6}', '99 123 4567', '0', 0, 59),
  ('GQ', 'Ekvator Ginesi', '240', 9, 9, '(?:222|55\d)\d{6}', '222 123 456', '', 0, 60),
  ('SV', 'El Salvador', '503', 8, 8, '[5-7]\d{7}', '7012 3456', '', 0, 61),
  ('ID', 'Endonezya', '62', 9, 12, '8[1-35-9]\d{7,10}', '812-345-678', '0', 0, 62),
  ('ER', 'Eritre', '291', 7, 7, '(?:17[1-3]|7\d\d)\d{4}', '7 123 456', '0', 0, 63),
  ('AM', 'Ermenistan', '374', 8, 8, '(?:33|4[1349]|55|77|88|9[13-9])\d{6}', '77 123456', '0', 0, 64),
  ('EE', 'Estonya', '372', 7, 8, '(?:5\d{5}|8(?:1(?:0(?:0(?:00|[178]\d)|[3-9]\d\d)|(?:1(?:0[2-6]|1\d)|[2-79]\d\d)\d)|2(?:0(?:0(?:00|4\d)|[1-7]\d\d)|(?:(?:[124-69]\d|3[5-9])\d|7(?:[0-79]\d|8[013-9])|8(?:[2-6]\d|7[01]))\d)|[349]\d{4}))\d\d|5(?:(?:[02]\d|5[0-478])\d|1(?:[0-8]\d|95)|6(?:4[0-4]|5[1-589]))\d{3}', '5123 4567', '', 0, 65),
  ('SZ', 'Esvatini', '268', 8, 8, '7[5-9]\d{6}', '7612 3456', '', 0, 66),
  ('ET', 'Etiyopya', '251', 9, 9, '(?:7(?:[03]\d|1[0-8]|2[1-35-79]|77|86|99)|(?:8[01]|9\d)\d)\d{6}', '91 123 4567', '0', 0, 67),
  ('FK', 'Falkland Adaları', '500', 5, 5, '[56]\d{4}', '51234', '', 0, 68),
  ('FO', 'Faroe Adaları', '298', 6, 6, '(?:[27][1-9]|5\d|9[16])\d{4}', '21 12 34', '', 0, 69),
  ('MA', 'Fas', '212', 9, 9, '(?:6(?:[0-79]\d|8[0-247-9])|7(?:[016-8]\d|2[0-8]|3[01]|5[0-5]))\d{6}', '6 50 12 34 56', '0', 0, 70),
  ('FJ', 'Fiji', '679', 7, 7, '(?:[279]\d|45|5[01568]|8[034679])\d{5}', '701 2345', '', 0, 71),
  ('PH', 'Filipinler', '63', 10, 10, '(?:8(?:1[37]|9[5-8])|9(?:0[5-9]|1[0-24-9]|[235-7]\d|4[2-9]|8[135-9]|9[1-9]))\d{7}', '905 123 4567', '0', 0, 72),
  ('PS', 'Filistin Bölgeleri', '970', 9, 9, '5[69]\d{7}', '599 123 456', '0', 0, 73),
  ('FI', 'Finlandiya', '358', 6, 10, '(?:4[0-8]|50)\d{4,8}', '41 2345678', '0', 0, 74),
  ('FR', 'Fransa', '33', 9, 9, '(?:6(?:[0-24-8]\d|3[0-8]|9[589])|7[3-9]\d)\d{6}', '6 12 34 56 78', '0', 0, 75),
  ('GF', 'Fransız Guyanası', '594', 9, 9, '(?:694(?:[0-249]\d|3[0-8])|7093[0-3])\d{4}', '694 20 12 34', '0', 0, 76),
  ('PF', 'Fransız Polinezyası', '689', 8, 8, '8[7-9]\d{6}', '87 12 34 56', '', 0, 77),
  ('GA', 'Gabon', '241', 7, 8, '(?:(?:0[2-7]|7[467])\d|6(?:0[0-4]|10|[256]\d))\d{5}|[2-7]\d{6}', '6 03 12 34', '', 0, 78),
  ('GM', 'Gambiya', '220', 7, 9, '(?:(?:[23679]\d|4[015]|8(?:(?:3[35]|6[68]|99)\d|7(?:[27]\d|4[015])))\d|5(?:[0-489]\d|56))\d{4}|8[4-7]\d{5}', '301 2345', '', 0, 79),
  ('GH', 'Gana', '233', 9, 9, '(?:2(?:[0346-9]\d|5[67])|5(?:[03-7]\d|9[1-9]))\d{6}', '23 123 4567', '0', 0, 80),
  ('GN', 'Gine', '224', 9, 9, '6[0-356]\d{7}', '601 12 34 56', '', 0, 81),
  ('GW', 'Gine-Bissau', '245', 9, 9, '9(?:5\d|6[569]|77)\d{6}', '955 012 345', '', 0, 82),
  ('GD', 'Grenada', '1', 10, 10, '473(?:4(?:0[2-79]|1[04-9]|2[0-5]|49|5[6-8])|5(?:2[01]|3[3-8])|901)\d{4}', '(473) 403-1234', '1', 0, 83),
  ('GL', 'Grönland', '299', 6, 6, '[245]\d{5}', '22 12 34', '', 0, 84),
  ('GP', 'Guadeloupe', '590', 9, 9, '(?:69(?:0\d\d|1(?:2[2-9]|3[0-5]))|7090[0-4])\d{4}', '690 00 12 34', '0', 0, 85),
  ('GU', 'Guam', '1', 10, 10, '(?:[58]\d\d|671|900)\d{7}', '(671) 300-1234', '1', 0, 86),
  ('GT', 'Guatemala', '502', 8, 8, '(?:[3-5]\d\d|80[0-4])\d{5}', '5123 4567', '', 0, 87),
  ('GG', 'Guernsey', '44', 10, 10, '7(?:(?:781|839)\d|911[17])\d{5}', '7781 123456', '0', 0, 88),
  ('GY', 'Guyana', '592', 7, 7, '(?:51[01]|6\d\d|7(?:[0-6]\d|70|8[0167]))\d{4}', '609 1234', '', 0, 89),
  ('ZA', 'Güney Afrika', '27', 5, 9, '(?:1(?:3492[0-25]|4495[0235]|549(?:20|5[01]))|4[34]492[01])\d{3}|8[1-4]\d{3,7}|(?:2[27]|47|54)4950\d{3}|(?:1(?:049[2-4]|9[12]\d\d)|(?:50[0-2]|[67]\d\d)\d\d|8(?:5\d{3}|7(?:08[67]|158|28[5-9]|310)))\d{4}|(?:1[6-8]|28|3[2-69]|4[025689]|5[36-8])4920\d{3}|(?:12|[2-5]1)492\d{4}', '71 123 4567', '0', 0, 90),
  ('KR', 'Güney Kore', '82', 9, 10, '1(?:05(?:[0-8]\d|9[0-6])|22[13]\d)\d{4,5}|1(?:0[0-46-9]|[16-9]\d|2[013-9])\d{6,7}', '10-2000-0000', '0', 0, 91),
  ('SS', 'Güney Sudan', '211', 9, 9, '(?:12|9[1257-9])\d{7}', '977 123 456', '0', 0, 92),
  ('GE', 'Gürcistan', '995', 9, 9, '5(?:(?:(?:0555|1(?:[17]77|555))[5-9]|757(?:7[7-9]|8[01]))\d|22252[0-4])\d\d|5(?:0(?:0(?:1[09]|70)|505)|1(?:0[01]0|1(?:07|33|51))|2(?:0[02]0|2[25]2)|3(?:0[03]0|3[35]3)|4(?:0[04]0|411)|5222|9000)[0-4]\d{3}|(?:5(?:0(?:0(?:0\d|1[12]|2[02]|3[0-6]|4[04]|5[05]|77|88|9[09])|(?:[14]\d|77)\d|22[02]|888)|1(?:1(?:[03][01]|[124]\d|5[02-6]|7[0-6])|4\d\d)|2(?:228|555)|3555|4(?:4(?:[02-9]\d|14)|555)|5(?:[0157-9]\d\d|200|333|4(?:44|55))|6[89]\d\d|7(?:(?:[0147-9]\d|22)\d|5(?:00|[57]5))|8(?:0(?:[018]\d|2[0-4])|5(?:55|8[89])|8(?:55|88))|9(?:090|[1-35-9]\d\d))|790\d\d)\d{4}', '555 12 34 56', '0', 0, 93),
  ('HT', 'Haiti', '509', 8, 8, '(?:[34]\d|5[568])\d{6}', '34 10 1234', '', 0, 94),
  ('HR', 'Hırvatistan', '385', 8, 9, '9(?:(?:0[1-9]|[12589]\d)\d\d|7(?:[0679]\d\d|5(?:[01]\d|44|55|77|9[5-79])))\d{4}|98\d{6}', '92 123 4567', '0', 0, 95),
  ('IN', 'Hindistan', '91', 10, 10, '(?:6(?:1279|828[01489])|7(?:887[02-9]|9313)|8(?:079[04-9]|(?:84|91)7[02-8]))\d{5}|(?:160[01]|6(?:(?:12|[2-4]1|5[17]|6[13]|80)[0189]|7(?:1[0189]|86))|7(?:1(?:2[0189]|9[0-5])|3(?:2[5-8]|[34][017-9]|9[016-9])|5(?:[15][017-9]|2[04-9]|9[7-9])|6(?:0[0-47]|1[0-257-9]|2[0-4]|3[19]|5[4589])|70[0289]|88[089])|8(?:0(?:6[67]|7[02-8])|70[017-9]|84[01489]|91[0-289]))\d{6}|(?:731|8(?:16|2[014]|3[126]|6[136]|7[78]|83))(?:[0189]\d|7[02-8])\d{5}|(?:6(?:(?:1[1358]|2[2457]|3[2-4]|4[235-7]|5[2-689]|6[24578])\d|7(?:[23569]\d|4[0189]|8[0-57-9])|8(?:[14-6]\d|2[0-79]))|7(?:1(?:[013-8]\d|9[6-9])|3(?:2[0-49]|9[2-5])|5(?:2[1-3]|9[0-6])|6(?:0[5689]|2[5-9]|3[02-8]|4\d|5[0-367])|70[13-7]|881))[0189]\d{5}|(?:6(?:[09]\d|1[04679]|2[03689]|3[05-9]|4[0489]|50|6[069]|7[07]|8[7-9])|7(?:[024]\d|3[05-8]|5[0346-8]|6[6-9]|7[1-9]|8[0-79]|9[06-9])|8(?:0[01589]|1[0-57-9]|2[235-9]|3[03-57-9]|[45]\d|6[02457-9]|7[1-69]|8[0-25-9]|9[02-9])|9\d\d)\d{7}', '81234 56789', '0', 0, 96),
  ('NL', 'Hollanda', '31', 9, 11, '(?:6[1-58]|970\d)\d{7}', '6 12345678', '0', 0, 97),
  ('HN', 'Honduras', '504', 8, 8, '[37-9]\d{7}', '9123-4567', '', 0, 98),
  ('IQ', 'Irak', '964', 10, 10, '7[3-9]\d{8}', '791 234 5678', '0', 0, 99),
  ('IR', 'İran', '98', 10, 10, '9(?:(?:0[0-5]|[13]\d|2[0-3])\d\d|9(?:[0-46]\d\d|5(?:10|5\d)|8(?:[12]\d|3[0-2]|88)|9(?:[0-359]\d|69|77|8[7-9])))\d{5}', '912 345 6789', '0', 0, 100),
  ('IE', 'İrlanda', '353', 9, 9, '8(?:22|[35-9]\d)\d{6}', '85 012 3456', '0', 0, 101),
  ('ES', 'İspanya', '34', 9, 9, '9(?:6906(?:09|10)|7390\d\d)\d\d|(?:6\d|7[1-48])\d{7}', '612 34 56 78', '', 0, 102),
  ('IL', 'İsrail', '972', 9, 9, '55(?:4(?:0[0-4]|10|6[015-9])|57[0-289]|8[06][0-2])\d{4}|5(?:(?:[0-2][02-9]|[36]\d|[49][2-9]|8[3-7])\d|5(?:01|2\d|3[0-3]|4[3-5]|5[0-25689]|6[6-8]|7[0-267]|8[7-9]|9[1-9]))\d{5}', '50-234-5678', '0', 0, 103),
  ('SE', 'İsveç', '46', 9, 9, '7[023689]\d{7}', '70-123 45 67', '0', 0, 104),
  ('CH', 'İsviçre', '41', 9, 9, '(?:6[89]|7[235-9])\d{7}', '78 123 45 67', '0', 0, 105),
  ('IT', 'İtalya', '39', 9, 10, '3[2-9]\d{7,8}|(?:31|43)\d{8}', '312 345 6789', '', 0, 106),
  ('IS', 'İzlanda', '354', 7, 9, '(?:38[589]\d\d|6(?:1[1-8]|2[0-6]|3[026-9]|4[014679]|5[0159]|6[0-69]|70|8[06-8]|9\d)|7(?:5[057]|[6-9]\d)|8(?:2[0-59]|[3-69]\d|8[238]))\d{4}', '611 1234', '', 0, 107),
  ('JM', 'Jamaika', '1', 10, 10, '(?:6582(?:[0-4]\d|95)|876(?:2(?:0[1-9]|[13-9]\d|2[013-9])|[348]\d\d|5(?:0[1-9]|[1-9]\d)|6(?:4[89]|6[67])|7(?:0[07]|7\d|8[1-47-9]|9[0-36-9])|9(?:[01]9|9[0579])))\d{4}', '(876) 210-1234', '1', 0, 108),
  ('JP', 'Japonya', '81', 10, 10, '[6-9]0[1-9]\d{7}', '90-1234-5678', '0', 0, 109),
  ('JE', 'Jersey', '44', 10, 10, '7(?:(?:(?:50|82)9|937)\d|7(?:00[378]|97\d))\d{5}', '7797 712345', '0', 0, 110),
  ('KH', 'Kamboçya', '855', 8, 9, '(?:(?:1[28]|3[18]|9[67])\d|6[016-9]|7(?:[07-9]|[16]\d)|8(?:[013-79]|8\d))\d{6}|(?:1\d|9[0-57-9])\d{6}|(?:2[3-6]|3[2-6]|4[2-4]|[5-7][2-5])48\d{5}', '91 234 567', '0', 0, 111),
  ('CM', 'Kamerun', '237', 9, 9, '(?:24[23]|6(?:[25-9]\d|4[0-2]))\d{6}', '6 71 23 45 67', '', 0, 112),
  ('CA', 'Kanada', '1', 10, 10, '[2-9]\d{9}|3\d{6}', '(506) 234-5678', '1', 0, 113),
  ('ME', 'Karadağ', '382', 8, 8, '6(?:[07-9]\d|3[024]|6[0-25])\d{5}', '60 123 456', '0', 0, 114),
  ('BQ', 'Karayip Hollandası', '599', 7, 7, '(?:31(?:8[14-8]|9[14578])|416[14-9]|7(?:0[01]|7[07]|8\d|9[056])\d)\d{3}', '318 1234', '', 0, 115),
  ('QA', 'Katar', '974', 8, 8, '[35-7]\d{7}', '3312 3456', '', 0, 116),
  ('KZ', 'Kazakistan', '7', 10, 10, '7(?:0[0-25-8]|47|6[0-4]|7[15-8]|85)\d{7}', '8 (771) 000 9998', '8', 0, 117),
  ('KE', 'Kenya', '254', 9, 9, '(?:1(?:0[0-8]|[18]\d|2[014]|3[05-9]|4[0-6])|7\d\d)\d{6}', '712 123456', '0', 0, 118),
  ('CY', 'Kıbrıs', '357', 8, 8, '9(?:10|[4-79]\d)\d{5}', '96 123456', '', 0, 119),
  ('KG', 'Kırgızistan', '996', 9, 9, '312(?:58\d|973)\d{3}|(?:2(?:0[0-35]|2\d)|5[0-24-7]\d|600|7(?:[07]\d|55)|88[08]|9(?:12|9[05-9]))\d{6}', '700 123 456', '0', 0, 120),
  ('KI', 'Kiribati', '686', 8, 8, '(?:6200[01]|7(?:310[1-9]|5(?:02[03-9]|12[0-47-9]|22[0-7]|[34](?:0[1-9]|8[02-9])|50[1-9])))\d{3}|(?:63\d\d|7(?:(?:[0146-9]\d|2[0-689])\d|3(?:[02-9]\d|1[1-9])|5(?:[0-2][013-9]|[34][1-79]|5[1-9]|[6-9]\d)))\d{4}', '72001234', '0', 0, 121),
  ('CO', 'Kolombiya', '57', 10, 10, '333301[0-5]\d{3}|3333(?:00|2[5-9]|[3-9]\d)\d{4}|(?:3(?:24[1-9]|3(?:00|3[0-24-9]))|9408)\d{6}|3(?:0[0-5]|1\d|2[0-3]|5[01]|70)\d{7}', '321 1234567', '0', 0, 122),
  ('KM', 'Komorlar', '269', 7, 7, '[34]\d{6}', '321 23 45', '', 0, 123),
  ('CG', 'Kongo - Brazavil', '242', 9, 9, '026(?:1[0-5]|6[6-9])\d{4}|0(?:[14-6]\d\d|2(?:40|5[5-8]|6[07-9]))\d{5}', '6 123 4567', '', 0, 124),
  ('CD', 'Kongo - Kinşasa', '243', 7, 9, '88\d{5}|(?:8[0-79]|9[016-9])\d{7}', '991 234 567', '0', 0, 125),
  ('XK', 'Kosova', '383', 8, 8, '4[3-9]\d{6}', '43 201 234', '0', 0, 126),
  ('CR', 'Kosta Rika', '506', 8, 8, '(?:3005\d|6500[01])\d{3}|(?:5[07]|6[0-4]|7[0-3]|8[3-9])\d{6}', '8312 3456', '', 0, 127),
  ('KW', 'Kuveyt', '965', 8, 8, '(?:41\d\d|5(?:(?:[05]\d|1[0-7]|6[56])\d|2(?:22|5[25])|7(?:55|77)|88[58]|999)|6(?:(?:0[034679]|5[015-9]|6\d)\d|1(?:00|11|6[16])|2[26]2|3[36]3|4[46]4|7(?:0[013-9]|[67]\d)|8[68]8|9(?:[069]\d|3[039]))|9(?:(?:[04679]\d|8[057-9])\d|1(?:00|1[01]|99)|2(?:00|2\d)|3(?:00|3[03])|5(?:00|5\d)))\d{4}', '500 12345', '', 0, 128),
  ('KP', 'Kuzey Kore', '850', 10, 10, '19[1-3]\d{7}', '192 123 4567', '0', 0, 129),
  ('MK', 'Kuzey Makedonya', '389', 8, 8, '7(?:3555|(?:474|9[019]7)7)\d{3}|7(?:[0-25-8]\d\d|3(?:[1-478]\d|6[01])|4(?:2\d|60|7[01578])|9(?:[2-4]\d|5[01]|7[015]))\d{4}', '72 345 678', '0', 0, 130),
  ('MP', 'Kuzey Mariana Adaları', '1', 10, 10, '[58]\d{9}|(?:67|90)0\d{7}', '(670) 234-5678', '1', 0, 131),
  ('CU', 'Küba', '53', 8, 8, '(?:5\d|6[2-4])\d{6}', '5 1234567', '0', 0, 132),
  ('LA', 'Laos', '856', 9, 10, '208[78]\d{6}|(?:20[23579]|30)\d{7}', '20 23 123 456', '0', 0, 133),
  ('LS', 'Lesotho', '266', 8, 8, '[56]\d{7}', '5012 3456', '', 0, 134),
  ('LV', 'Letonya', '371', 8, 8, '2333[0-8]\d{3}|2(?:[0-24-9]\d\d|3(?:0[07]|[14-9]\d|2[02-9]|3[0-24-9]))\d{4}', '21 234 567', '', 0, 135),
  ('LR', 'Liberya', '231', 7, 9, '(?:(?:(?:22|33)0|555|7(?:6[01]|7\d)|88\d)\d|4(?:240|[67]))\d{5}|[56]\d{6}', '77 012 3456', '0', 0, 136),
  ('LY', 'Libya', '218', 9, 9, '9[1-6]\d{7}', '91-2345678', '0', 0, 137),
  ('LI', 'Liechtenstein', '423', 7, 9, '(?:6(?:(?:4[5-9]|5\d)\d|6(?:[024-68]\d|1[01]|3[7-9]|7[02]))\d|7(?:[37-9]\d|42|56))\d{4}', '660 234 567', '0', 0, 138),
  ('LT', 'Litvanya', '370', 8, 8, '6\d{7}', '(0-612) 34567', '0', 0, 139),
  ('LB', 'Lübnan', '961', 7, 8, '(?:(?:3|81)\d|7(?:[01]\d|6[013-9]|8[7-9]|9[0-4]))\d{5}', '71 123 456', '0', 0, 140),
  ('LU', 'Lüksemburg', '352', 9, 9, '6(?:[26][18]|5[1568]|7[189]|81|9[128])\d{6}', '628 123 456', '', 0, 141),
  ('HU', 'Macaristan', '36', 9, 9, '(?:[257]0|3[01])\d{7}', '6 20 123 4567', '06', 0, 142),
  ('MG', 'Madagaskar', '261', 9, 9, '3[2-9]\d{7}', '32 12 345 67', '0', 0, 143),
  ('MW', 'Malavi', '265', 9, 9, '111\d{6}|(?:2[12]|31|77|[89][89])\d{7}', '991 23 45 67', '0', 0, 144),
  ('MV', 'Maldivler', '960', 7, 7, '(?:46[46]|[79]\d\d)\d{4}', '771-2345', '', 0, 145),
  ('MY', 'Malezya', '60', 9, 10, '1(?:(?:1888[689]|4400|8(?:47|8[27])[0-4])\d{4}|9\d{7,8})|1(?:0(?:[23568]\d|4[0-6]|7[016-9]|9[0-8])|1(?:[1-5]\d\d|6(?:0[5-9]|[1-9]\d)|7(?:[0-4]\d|5[0-79]|6[02-4]|8[02-5]))|(?:[26]\d|[37][1-9]|4[235-9])\d|5(?:31|9\d\d)|8(?:1[23]|[236]\d|4[06]|5(?:46|[7-9])|7[016-9]|8[01]|9[0-8]))\d{5}', '12-345 6789', '0', 0, 146),
  ('ML', 'Mali', '223', 8, 8, '2(?:0(?:01|79)|17\d)\d{4}|(?:5[0-3]|[679]\d|8[2-59])\d{6}', '65 01 23 45', '', 0, 147),
  ('MT', 'Malta', '356', 8, 8, '(?:7(?:210|[79]\d\d)|9(?:[29]\d\d|69[67]|8(?:1[1-3]|89|97)))\d{4}', '9696 1234', '', 0, 148),
  ('IM', 'Man Adası', '44', 10, 10, '76245[06]\d{4}|7(?:4576|[59]24\d|624[0-4689])\d{5}', '7924 123456', '0', 0, 149),
  ('MH', 'Marshall Adaları', '692', 7, 7, '(?:(?:23|54)5|329|45[35-8])\d{4}', '235-1234', '1', 0, 150),
  ('MQ', 'Martinik', '596', 9, 9, '(?:69[67]\d\d|7091[0-3])\d{4}', '696 20 12 34', '0', 0, 151),
  ('MU', 'Mauritius', '230', 8, 8, '5(?:4(?:2[1-389]|7[1-9])|87[15-8])\d{4}|(?:5(?:2[5-9]|4[3-689]|[57]\d|8[0-689]|9[0-8])|7(?:0[0-7]|3[013]))\d{5}', '5251 2345', '', 0, 152),
  ('YT', 'Mayotte', '262', 9, 9, '(?:639(?:0[0-79]|1[019]|[267]\d|3[09]|40|5[05-9]|9[04-79])|7093[5-7])\d{4}', '639 01 23 45', '0', 0, 153),
  ('MX', 'Meksika', '52', 10, 10, '(?:2(?:2\d|3[1-35-8]|4[13-9]|7[1-689]|8[1-578]|9[467])|3(?:1[1-79]|[2458][1-9]|3\d|7[1-8]|9[1-5])|4(?:1[1-57-9]|[267][1-9]|3[1-8]|[45]\d|8[1-35-9]|9[2-689])|5(?:[56]\d|88|9[1-79])|6(?:1[2-68]|[2-4][1-9]|5[1-36-9]|6[0-57-9]|7[1-7]|8[67]|9[4-8])|7(?:[1346][1-9]|[27]\d|5[13-9]|8[1-69]|9[17])|8(?:1\d|2[13-689]|3[1-6]|4[124-6]|6[1246-9]|7[0-378]|9[12479])|9(?:1[346-9]|2[1-4]|3[2-46-8]|5[1348]|[69]\d|7[12]|8[1-8]))\d{7}', '222 123 4567', '', 0, 154),
  ('EG', 'Mısır', '20', 10, 10, '1[0-25]\d{8}', '10 01234567', '0', 0, 155),
  ('FM', 'Mikronezya', '691', 7, 7, '31(?:00[67]|208|309)\d\d|(?:3(?:[2357]0[1-9]|602|804|905)|(?:820|9[2-7]\d)\d)\d{3}', '350 1234', '', 0, 156),
  ('MN', 'Moğolistan', '976', 8, 8, '(?:87[01]|92[0139])\d{5}|(?:5[05]|6[069]|7[28]|8[0135689]|9[013-9])\d{6}', '8812 3456', '0', 0, 157),
  ('MD', 'Moldova', '373', 8, 8, '562\d{5}|(?:6\d|7[16-9])\d{6}', '621 12 345', '0', 0, 158),
  ('MC', 'Monako', '377', 8, 9, '4(?:[46]\d|5[1-9])\d{5}|(?:3|[67]\d)\d{7}', '6 12 34 56 78', '0', 0, 159),
  ('MS', 'Montserrat', '1', 10, 10, '664(?:3(?:49|9[1-6])|49[2-6])\d{4}', '(664) 492-3456', '1', 0, 160),
  ('MR', 'Moritanya', '222', 8, 8, '[2-4][0-46-9]\d{6}', '22 12 34 56', '', 0, 161),
  ('MZ', 'Mozambik', '258', 9, 9, '8[2-9]\d{7}', '82 123 4567', '', 0, 162),
  ('MM', 'Myanmar (Burma)', '95', 7, 10, '(?:17[01]|9(?:2(?:[0-4]|[56]\d\d)|(?:3(?:[0-36]|4\d)|(?:6\d|8[89]|9[4-8])\d|7(?:3|40|[5-9]\d))\d|4(?:(?:[0245]\d|[1379])\d|88)|5[0-6])\d)\d{4}|9[69]1\d{6}|9(?:[68]\d|9[089])\d{5}', '9 212 3456', '0', 0, 163),
  ('NA', 'Namibya', '264', 9, 9, '(?:60|8[1245])\d{7}', '81 123 4567', '0', 0, 164),
  ('NR', 'Nauru', '674', 7, 7, '(?:222|55[3-9]|666|777|8\d\d|999)\d{4}', '555 1234', '', 0, 165),
  ('NP', 'Nepal', '977', 10, 10, '9(?:00|6[0-3]|7[0-24-6]|8[0-24-68])\d{7}', '984-1234567', '0', 0, 166),
  ('NE', 'Nijer', '227', 8, 8, '(?:23|7[0467]|[89]\d)\d{6}', '93 12 34 56', '', 0, 167),
  ('NG', 'Nijerya', '234', 10, 10, '(?:702[0-24-9]|819[01])\d{6}|(?:7(?:0[13-9]|[12]\d)|8(?:0[1-9]|1[0-8])|9(?:0[1-9]|1[0-6]))\d{7}', '802 123 4567', '0', 0, 168),
  ('NI', 'Nikaragua', '505', 8, 8, '(?:5(?:5[0-7]|[78]\d)|6(?:20|3[035]|4[045]|5[05]|77|8[1-9]|9[059])|(?:7[5-8]|8\d)\d)\d{5}', '8123 4567', '', 0, 169),
  ('NU', 'Niue', '683', 4, 7, '(?:[56]|888[1-9])\d{3}', '888 4012', '', 0, 170),
  ('NF', 'Norfolk Adası', '672', 6, 6, '(?:14|3[58])\d{4}', '3 81234', '', 0, 171),
  ('NO', 'Norveç', '47', 8, 8, '45(?:[0-24-9]\d|3[0-57-9])\d{4}|(?:4[016-8]|9\d)\d{6}', '40 61 23 45', '', 0, 172),
  ('CF', 'Orta Afrika Cumhuriyeti', '236', 8, 8, '7[02-7]\d{6}', '70 01 23 45', '', 0, 173),
  ('UZ', 'Özbekistan', '998', 9, 9, '(?:(?:[25]0|33|8[078]|9[0-57-9])\d{3}|6(?:1(?:2(?:2[01]|98)|35[0-4]|50\d|61[23]|7(?:[01][017]|4\d|55|9[5-9]))|2(?:(?:11|7\d)\d|2(?:[12]1|9[01379])|5(?:[126]\d|3[0-4]))|5(?:19[01]|2(?:27|9[26])|(?:30|59|7\d)\d)|6(?:2(?:1[5-9]|2[0367]|38|41|52|60)|(?:3[79]|9[0-3])\d|4(?:56|83)|7(?:[07]\d|1[017]|3[07]|4[047]|5[057]|67|8[0178]|9[79]))|7(?:2(?:24|3[237]|4[5-9]|7[15-8])|5(?:7[12]|8[0589])|7(?:0\d|[39][07])|9(?:0\d|7[079])))|7(?:[07]\d{3}|2(?:2(?:2[79]|95)|3(?:2[5-9]|6[0-6])|57\d|7(?:0\d|1[17]|2[27]|3[37]|44|5[057]|66|88))|3(?:2(?:1[0-6]|21|3[469]|7[159])|(?:33|9[4-6])\d|5(?:0[0-4]|5[579]|9\d)|7(?:[0-3579]\d|4[0467]|6[67]|8[078]))|4(?:2(?:29|5[0257]|6[0-7]|7[1-57])|5(?:1[0-4]|8\d|9[5-9])|7(?:0\d|1[024589]|2[0-27]|3[0137]|[46][07]|5[01]|7[5-9]|9[079])|9(?:7[015-9]|[89]\d))|5(?:112|2(?:0\d|2[29]|[49]4)|3[1568]\d|52[6-9]|7(?:0[01578]|1[017]|[23]7|4[047]|[5-7]\d|8[78]|9[079]))|9(?:22[128]|3(?:2[0-4]|7\d)|57[02569]|7(?:2[05-9]|3[37]|4\d|60|7[2579]|87|9[07]))))\d{4}', '91 234 56 78', '', 0, 174),
  ('PK', 'Pakistan', '92', 10, 10, '3(?:[0-247]\d|3[0-79]|55|64)\d{7}', '301 2345678', '0', 0, 175),
  ('PW', 'Palau', '680', 7, 7, '(?:(?:46|83)[0-5]|(?:6[2-4689]|78)0)\d{4}|(?:45|77|88)\d{5}', '620 1234', '', 0, 176),
  ('PA', 'Panama', '507', 7, 8, '(?:1[16]1|21[89]|6\d{3}|8(?:1[01]|7[23]))\d{4}', '6123-4567', '', 0, 177),
  ('PG', 'Papua Yeni Gine', '675', 8, 8, '(?:7\d|8[1-58])\d{6}', '7012 3456', '', 0, 178),
  ('PY', 'Paraguay', '595', 9, 9, '9881\d{5}|9(?:51|6[129]|7[1-6]|8[1-7]|9[1-5])\d{6}', '961 456789', '0', 0, 179),
  ('PE', 'Peru', '51', 9, 9, '9\d{8}', '912 345 678', '0', 0, 180),
  ('PL', 'Polonya', '48', 9, 9, '21(?:1[013-5]|2\d|3[1-9])\d{5}|(?:45|5[0137]|6[069]|7[2389]|88)\d{7}', '512 345 678', '', 0, 181),
  ('PT', 'Portekiz', '351', 9, 9, '6(?:[06]92(?:30|9\d)|[35]92(?:[049]\d|3[034]))\d{3}|(?:(?:16|6[0356])93|9(?:[1-36]\d\d|480))\d{5}', '912 345 678', '', 0, 182),
  ('PR', 'Porto Riko', '1', 10, 10, '(?:[589]\d\d|787)\d{7}', '(787) 234-5678', '1', 0, 183),
  ('RE', 'Reunion', '262', 9, 9, '(?:69(?:2\d\d|3(?:[06][0-6]|1[0-3]|2[0-2]|3[0-39]|4\d|5[0-5]|7[0-37]|8[0-8]|9[0-479]))|7092[0-3])\d{4}', '692 12 34 56', '0', 0, 184),
  ('RO', 'Romanya', '40', 9, 9, '7020\d{5}|7(?:0[013-9]|1[0-3]|[2-7]\d|8[03-8]|9[0-39])\d{6}', '712 034 567', '0', 0, 185),
  ('RW', 'Ruanda', '250', 9, 9, '7[237-9]\d{7}', '720 123 456', '0', 0, 186),
  ('RU', 'Rusya', '7', 10, 10, '9(?:[0-24-9]\d{4}|3(?:0(?:0(?:05|[124579]\d|3[0-7]|6[0-49]|8[04-9])|[1-9]\d\d)|[1-9]\d{3}))\d{4}', '8 (912) 345-67-89', '8', 0, 187),
  ('BL', 'Saint Barthelemy', '590', 9, 9, '(?:69(?:0\d\d|1(?:2[2-9]|3[0-5]))|7090[0-4])\d{4}', '690 00 12 34', '0', 0, 188),
  ('SH', 'Saint Helena', '290', 5, 5, '[569]\d{4}', '51234', '', 0, 189),
  ('KN', 'Saint Kitts ve Nevis', '1', 10, 10, '869(?:48[89]|55[6-8]|66\d|76[02-7])\d{4}', '(869) 765-2917', '1', 0, 190),
  ('LC', 'Saint Lucia', '1', 10, 10, '758(?:28[4-7]|384|4(?:6[01]|8[4-9])|5(?:1[89]|20|84)|7(?:1[2-9]|2\d|3[0-3])|812)\d{4}', '(758) 284-5678', '1', 0, 191),
  ('MF', 'Saint Martin', '590', 9, 9, '(?:69(?:0\d\d|1(?:2[2-9]|3[0-5]))|7090[0-4])\d{4}', '690 00 12 34', '0', 0, 192),
  ('PM', 'Saint Pierre ve Miquelon', '508', 6, 9, '708(?:4[0-5]|5[0-6])\d{4}|(?:[236-9]\d|4[02-489]|5[02-9])\d{4}', '55 12 34', '0', 0, 193),
  ('VC', 'Saint Vincent ve Grenadinler', '1', 10, 10, '784(?:4(?:3[0-5]|5[45]|89|9[0-8])|5(?:2[6-9]|3[0-4])|720)\d{4}', '(784) 430-1234', '1', 0, 194),
  ('WS', 'Samoa', '685', 7, 10, '(?:7[1-35-8]|8(?:[3-7]|9\d{3}))\d{5}', '72 12345', '', 0, 195),
  ('SM', 'San Marino', '378', 8, 8, '6[16]\d{6}', '66 66 12 12', '', 0, 196),
  ('ST', 'Sao Tome ve Principe', '239', 7, 7, '900[5-9]\d{3}|9(?:0[1-9]|[89]\d)\d{4}', '981 2345', '', 0, 197),
  ('SN', 'Senegal', '221', 9, 9, '7(?:[015-8]\d|21|90)\d{6}', '70 123 45 67', '', 0, 198),
  ('SC', 'Seyşeller', '248', 7, 7, '2[125-8]\d{5}', '2 510 123', '', 0, 199),
  ('RS', 'Sırbistan', '381', 8, 10, '6(?:[0-689]|7\d)\d{6,7}', '60 1234567', '0', 0, 200),
  ('SL', 'Sierra Leone', '232', 8, 8, '(?:25|3[0-5]|66|7\d|8[08]|9[09])\d{6}', '(025) 123456', '0', 0, 201),
  ('SG', 'Singapur', '65', 8, 8, '80[1-9]\d{5}|(?:8[1-9]|9[0-8])\d{6}', '8123 4567', '', 0, 202),
  ('SX', 'Sint Maarten', '1', 10, 10, '7215(?:1[02]|2\d|5[034679]|8[0-24-8])\d{4}', '(721) 520-5678', '1', 0, 203),
  ('SK', 'Slovakya', '421', 9, 9, '909[1-9]\d{5}|9(?:0[1-8]|1[0-24-9]|4[03-57-9]|5\d)\d{6}', '912 123 456', '0', 0, 204),
  ('SI', 'Slovenya', '386', 8, 8, '65(?:[178]\d|5[56]|6[01])\d{4}|(?:[37][01]|4[013]|51|6[489])\d{6}', '31 234 567', '0', 0, 205),
  ('SB', 'Solomon Adaları', '677', 5, 7, '(?:48|99[0-8]\d)\d{3}|(?:6[89]|7[1-9]|8[4-9]|9[0-8])\d{5}', '74 21234', '', 0, 206),
  ('SO', 'Somali', '252', 7, 9, '(?:(?:15|(?:3[59]|4[89]|6\d|7[0-35-9]|8[08])\d|9(?:0\d|[2-9]))\d|2(?:4\d|8))\d{5}|(?:[67]\d\d|904)\d{5}', '7 1123456', '0', 0, 207),
  ('LK', 'Sri Lanka', '94', 9, 9, '7(?:[0-25-8]\d|4[0-4])\d{6}', '71 234 5678', '0', 0, 208),
  ('SD', 'Sudan', '249', 9, 9, '(?:1[0-2]|9[0-3569])\d{7}', '91 123 1234', '0', 0, 209),
  ('SR', 'Surinam', '597', 7, 7, '(?:6[08]|7[1-79]|8[1-9])\d{5}', '741-2345', '', 0, 210),
  ('SY', 'Suriye', '963', 9, 9, '(?:50|9[03-689])\d{7}', '944 567 890', '0', 0, 211),
  ('SA', 'Suudi Arabistan', '966', 9, 9, '579[0-8]\d{5}|5(?:[013-689]\d|7[0-8])\d{6}', '51 234 5678', '0', 0, 212),
  ('SJ', 'Svalbard ve Jan Mayen', '47', 8, 8, '45(?:[0-24-9]\d|3[0-57-9])\d{4}|(?:4[016-8]|9\d)\d{6}', '41 23 45 67', '', 0, 213),
  ('CL', 'Şili', '56', 9, 9, '2(?:1982[0-6]|3314[05-9])\d{3}|(?:2(?:1(?:160|962)|3(?:(?:[24]\d|50)\d|3(?:[0346-9]\d|1[0-35-9]|2[1-9]|5[0-24-9])|600)|646[59])|80[1-8]\d\d|9(?:(?:10[0-2]|7[1-9]\d)\d|3(?:[0-57-9]\d\d|6(?:0[02-9]|[1-9]\d))|6(?:[0-8]\d\d|9(?:[02-79]\d|1[05-9]))|9(?:[03-9]\d\d|1(?:[0235-9]\d|4[0-24-9])|2(?:[0-79]\d|8[0-46-9]))))\d{4}|(?:22|3[2-5]|[47][1-35]|5[1-3578]|6[13-57]|8[1-9]|9[2458])\d{7}', '(2) 2123 4567', '', 0, 214),
  ('TJ', 'Tacikistan', '992', 9, 9, '(?:33[03-9]|4(?:1[18]|4[02-479])|81[1-9])\d{6}|(?:[09]\d|1[0-27-9]|2[0-27]|3[08]|40|5[05]|66|7[0157-9]|8[07-9])\d{7}', '91 712 3456', '', 0, 215),
  ('TZ', 'Tanzanya', '255', 9, 9, '(?:6[0-35-9]|7\d)\d{7}', '621 234 567', '0', 0, 216),
  ('TH', 'Tayland', '66', 9, 9, '(?:(?:14|[89]\d)\d\d|6(?:[1-6]\d\d|7(?:1[0-8]|2[4-7]|3[1-6])))\d{5}', '81 234 5678', '0', 0, 217),
  ('TW', 'Tayvan', '886', 9, 9, '(?:40001[0-2]|9[0-8]\d{4})\d{3}', '912 345 678', '0', 0, 218),
  ('TL', 'Timor-Leste', '670', 8, 8, '7[2-8]\d{6}', '7721 2345', '', 0, 219),
  ('TG', 'Togo', '228', 8, 8, '(?:7[0-389]|9[0-36-9])\d{6}', '90 11 23 45', '', 0, 220),
  ('TK', 'Tokelau', '690', 4, 7, '7[2-4]\d{2,5}', '7290', '', 0, 221),
  ('TO', 'Tonga', '676', 7, 7, '(?:5(?:4[0-5]|5[4-6])|6(?:[09]\d|3[02]|8[15-9])|(?:7\d|8[46-9])\d|999)\d{4}', '771 5123', '', 0, 222),
  ('TT', 'Trinidad ve Tobago', '1', 10, 10, '868(?:(?:2[5-9]|3\d)\d|4(?:3[0-6]|[6-9]\d)|6(?:20|78|8\d)|7(?:0[1-9]|1[02-9]|[2-9]\d))\d{4}', '(868) 291-1234', '1', 0, 223),
  ('TA', 'Tristan da Cunha', '290', 4, 4, '8\d{3}', '8999', '', 0, 224),
  ('TN', 'Tunus', '216', 8, 8, '3(?:001|[12]40)\d{4}|(?:(?:[259]\d|4[0-8])\d|3(?:1[1-35]|6[0-4]|91))\d{5}', '20 123 456', '', 0, 225),
  ('TC', 'Turks ve Caicos Adaları', '1', 10, 10, '649(?:2(?:3[129]|4[1-79])|3\d\d|4[34][1-3])\d{4}', '(649) 231-1234', '1', 0, 226),
  ('TV', 'Tuvalu', '688', 6, 7, '(?:7[01]\d|90)\d{4}', '90 1234', '', 0, 227),
  ('TM', 'Türkmenistan', '993', 8, 8, '(?:6\d|7[12])\d{6}', '8 66 123456', '8', 0, 228),
  ('UG', 'Uganda', '256', 9, 9, '7(?:28|34)0\d{5}|7(?:[014-8]\d|2[01467]|3[0-267]|9[0-589])\d{6}', '712 345678', '0', 0, 229),
  ('UA', 'Ukrayna', '380', 9, 9, '790\d{6}|(?:39|50|6[36-8]|7[1-357]|9[1-9])\d{7}', '50 123 4567', '0', 0, 230),
  ('OM', 'Umman', '968', 8, 8, '(?:1505|90[1-9]\d)\d{4}|(?:7[124-9]|9[1-9])\d{6}', '9212 3456', '', 0, 231),
  ('UY', 'Uruguay', '598', 8, 8, '9[1-9]\d{6}', '94 231 234', '0', 0, 232),
  ('JO', 'Ürdün', '962', 9, 9, '(?:427|7(?:11|[29]\d|[78][0-25-9]))\d{6}', '7 9012 3456', '0', 0, 233),
  ('VU', 'Vanuatu', '678', 7, 7, '(?:[58]\d|7[0-7])\d{5}', '591 2345', '', 0, 234),
  ('VA', 'Vatikan', '39', 9, 10, '3[1-9]\d{8}|3[2-9]\d{7}', '312 345 6789', '', 0, 235),
  ('VE', 'Venezuela', '58', 10, 10, '4(?:1[24-8]|2[246])\d{7}', '412-1234567', '0', 0, 236),
  ('VN', 'Vietnam', '84', 9, 9, '121[0-3]\d{5}|(?:1[46]0|(?:3\d|7[06-9])\d|5(?:[1689]\d|2[238]|59)|8(?:[1-8]\d|9[6-9])|9(?:[0-8]\d|9[013-9]))\d{6}', '912 345 678', '0', 0, 237),
  ('WF', 'Wallis ve Futuna', '681', 6, 6, '(?:72|8[23])\d{4}', '82 12 34', '', 0, 238),
  ('YE', 'Yemen', '967', 9, 9, '7[01378]\d{7}', '712 345 678', '0', 0, 239),
  ('NC', 'Yeni Kaledonya', '687', 6, 6, '(?:[579]\d|8[0-79])\d{4}', '75.12.34', '', 0, 240),
  ('NZ', 'Yeni Zelanda', '64', 8, 10, '2(?:[0-27-9]\d|6)\d{6,7}|2(?:1\d|75)\d{5}', '21 123 4567', '0', 0, 241),
  ('GR', 'Yunanistan', '30', 10, 10, '68[57-9]\d{7}|(?:69|94)\d{8}', '691 234 5678', '', 0, 242),
  ('ZM', 'Zambiya', '260', 9, 9, '(?:[59][5-8]|7[5-9])\d{7}', '95 5123456', '0', 0, 243),
  ('ZW', 'Zimbabve', '263', 9, 9, '7(?:[1278]\d|3[1-9]|51|9[01])\d{6}', '71 234 5678', '0', 0, 244)
ON CONFLICT (code) DO UPDATE SET name = excluded.name, dial_code = excluded.dial_code, phone_min_length = excluded.phone_min_length,
  phone_max_length = excluded.phone_max_length, phone_pattern = excluded.phone_pattern, phone_example = excluded.phone_example,
  national_prefix = excluded.national_prefix, has_regions = excluded.has_regions, sort_order = excluded.sort_order;

INSERT INTO geo_provinces (id, country_code, code, name) VALUES
  ('TR-01', 'TR', '01', 'Adana'),
  ('TR-02', 'TR', '02', 'Adıyaman'),
  ('TR-03', 'TR', '03', 'Afyonkarahisar'),
  ('TR-04', 'TR', '04', 'Ağrı'),
  ('TR-05', 'TR', '05', 'Amasya'),
  ('TR-06', 'TR', '06', 'Ankara'),
  ('TR-07', 'TR', '07', 'Antalya'),
  ('TR-08', 'TR', '08', 'Artvin'),
  ('TR-09', 'TR', '09', 'Aydın'),
  ('TR-10', 'TR', '10', 'Balıkesir'),
  ('TR-11', 'TR', '11', 'Bilecik'),
  ('TR-12', 'TR', '12', 'Bingöl'),
  ('TR-13', 'TR', '13', 'Bitlis'),
  ('TR-14', 'TR', '14', 'Bolu'),
  ('TR-15', 'TR', '15', 'Burdur'),
  ('TR-16', 'TR', '16', 'Bursa'),
  ('TR-17', 'TR', '17', 'Çanakkale'),
  ('TR-18', 'TR', '18', 'Çankırı'),
  ('TR-19', 'TR', '19', 'Çorum'),
  ('TR-20', 'TR', '20', 'Denizli'),
  ('TR-21', 'TR', '21', 'Diyarbakır'),
  ('TR-22', 'TR', '22', 'Edirne'),
  ('TR-23', 'TR', '23', 'Elazığ'),
  ('TR-24', 'TR', '24', 'Erzincan'),
  ('TR-25', 'TR', '25', 'Erzurum'),
  ('TR-26', 'TR', '26', 'Eskişehir'),
  ('TR-27', 'TR', '27', 'Gaziantep'),
  ('TR-28', 'TR', '28', 'Giresun'),
  ('TR-29', 'TR', '29', 'Gümüşhane'),
  ('TR-30', 'TR', '30', 'Hakkari'),
  ('TR-31', 'TR', '31', 'Hatay'),
  ('TR-32', 'TR', '32', 'Isparta'),
  ('TR-33', 'TR', '33', 'Mersin'),
  ('TR-34', 'TR', '34', 'İstanbul'),
  ('TR-35', 'TR', '35', 'İzmir'),
  ('TR-36', 'TR', '36', 'Kars'),
  ('TR-37', 'TR', '37', 'Kastamonu'),
  ('TR-38', 'TR', '38', 'Kayseri'),
  ('TR-39', 'TR', '39', 'Kırklareli'),
  ('TR-40', 'TR', '40', 'Kırşehir'),
  ('TR-41', 'TR', '41', 'Kocaeli'),
  ('TR-42', 'TR', '42', 'Konya'),
  ('TR-43', 'TR', '43', 'Kütahya'),
  ('TR-44', 'TR', '44', 'Malatya'),
  ('TR-45', 'TR', '45', 'Manisa'),
  ('TR-46', 'TR', '46', 'Kahramanmaraş'),
  ('TR-47', 'TR', '47', 'Mardin'),
  ('TR-48', 'TR', '48', 'Muğla'),
  ('TR-49', 'TR', '49', 'Muş'),
  ('TR-50', 'TR', '50', 'Nevşehir'),
  ('TR-51', 'TR', '51', 'Niğde'),
  ('TR-52', 'TR', '52', 'Ordu'),
  ('TR-53', 'TR', '53', 'Rize'),
  ('TR-54', 'TR', '54', 'Sakarya'),
  ('TR-55', 'TR', '55', 'Samsun'),
  ('TR-56', 'TR', '56', 'Siirt'),
  ('TR-57', 'TR', '57', 'Sinop'),
  ('TR-58', 'TR', '58', 'Sivas'),
  ('TR-59', 'TR', '59', 'Tekirdağ'),
  ('TR-60', 'TR', '60', 'Tokat'),
  ('TR-61', 'TR', '61', 'Trabzon'),
  ('TR-62', 'TR', '62', 'Tunceli'),
  ('TR-63', 'TR', '63', 'Şanlıurfa'),
  ('TR-64', 'TR', '64', 'Uşak'),
  ('TR-65', 'TR', '65', 'Van'),
  ('TR-66', 'TR', '66', 'Yozgat'),
  ('TR-67', 'TR', '67', 'Zonguldak'),
  ('TR-68', 'TR', '68', 'Aksaray'),
  ('TR-69', 'TR', '69', 'Bayburt'),
  ('TR-70', 'TR', '70', 'Karaman'),
  ('TR-71', 'TR', '71', 'Kırıkkale'),
  ('TR-72', 'TR', '72', 'Batman'),
  ('TR-73', 'TR', '73', 'Şırnak'),
  ('TR-74', 'TR', '74', 'Bartın'),
  ('TR-75', 'TR', '75', 'Ardahan'),
  ('TR-76', 'TR', '76', 'Iğdır'),
  ('TR-77', 'TR', '77', 'Yalova'),
  ('TR-78', 'TR', '78', 'Karabük'),
  ('TR-79', 'TR', '79', 'Kilis'),
  ('TR-80', 'TR', '80', 'Osmaniye'),
  ('TR-81', 'TR', '81', 'Düzce')
ON CONFLICT (id) DO UPDATE SET name = excluded.name;

INSERT OR IGNORE INTO geo_districts (province_id, name) VALUES
  ('TR-01', 'Aladağ'), ('TR-01', 'Ceyhan'), ('TR-01', 'Çukurova'), ('TR-01', 'Feke'), ('TR-01', 'İmamoğlu'), ('TR-01', 'Karaisalı'), ('TR-01', 'Karataş'), ('TR-01', 'Kozan'), ('TR-01', 'Pozantı'), ('TR-01', 'Saimbeyli'), ('TR-01', 'Sarıçam'), ('TR-01', 'Seyhan'), ('TR-01', 'Tufanbeyli'), ('TR-01', 'Yumurtalık'), ('TR-01', 'Yüreğir'),
  ('TR-02', 'Besni'), ('TR-02', 'Çelikhan'), ('TR-02', 'Gerger'), ('TR-02', 'Gölbaşı'), ('TR-02', 'Kahta'), ('TR-02', 'Merkez'), ('TR-02', 'Samsat'), ('TR-02', 'Sincik'), ('TR-02', 'Tut'),
  ('TR-03', 'Başmakçı'), ('TR-03', 'Bayat'), ('TR-03', 'Bolvadin'), ('TR-03', 'Çay'), ('TR-03', 'Çobanlar'), ('TR-03', 'Dazkırı'), ('TR-03', 'Dinar'), ('TR-03', 'Emirdağ'), ('TR-03', 'Evciler'), ('TR-03', 'Hocalar'), ('TR-03', 'İhsaniye'), ('TR-03', 'İscehisar'), ('TR-03', 'Kızılören'), ('TR-03', 'Merkez'), ('TR-03', 'Sandıklı'), ('TR-03', 'Sinanpaşa'), ('TR-03', 'Sultandağı'), ('TR-03', 'Şuhut'),
  ('TR-04', 'Diyadin'), ('TR-04', 'Doğubayazıt'), ('TR-04', 'Eleşkirt'), ('TR-04', 'Hamur'), ('TR-04', 'Merkez'), ('TR-04', 'Patnos'), ('TR-04', 'Taşlıçay'), ('TR-04', 'Tutak'),
  ('TR-05', 'Göynücek'), ('TR-05', 'Gümüşhacıköy'), ('TR-05', 'Hamamözü'), ('TR-05', 'Merkez'), ('TR-05', 'Merzifon'), ('TR-05', 'Suluova'), ('TR-05', 'Taşova'),
  ('TR-06', 'Akyurt'), ('TR-06', 'Altındağ'), ('TR-06', 'Ayaş'), ('TR-06', 'Bala'), ('TR-06', 'Beypazarı'), ('TR-06', 'Çamlıdere'), ('TR-06', 'Çankaya'), ('TR-06', 'Çubuk'), ('TR-06', 'Elmadağ'), ('TR-06', 'Etimesgut'), ('TR-06', 'Evren'), ('TR-06', 'Gölbaşı'), ('TR-06', 'Güdül'), ('TR-06', 'Haymana'), ('TR-06', 'Kahramankazan'), ('TR-06', 'Kalecik'), ('TR-06', 'Keçiören'), ('TR-06', 'Kızılcahamam'), ('TR-06', 'Mamak'), ('TR-06', 'Nallıhan'), ('TR-06', 'Polatlı'), ('TR-06', 'Pursaklar'), ('TR-06', 'Sincan'), ('TR-06', 'Şereflikoçhisar'), ('TR-06', 'Yenimahalle'),
  ('TR-07', 'Akseki'), ('TR-07', 'Aksu'), ('TR-07', 'Alanya'), ('TR-07', 'Demre'), ('TR-07', 'Döşemealtı'), ('TR-07', 'Elmalı'), ('TR-07', 'Finike'), ('TR-07', 'Gazipaşa'), ('TR-07', 'Gündoğmuş'), ('TR-07', 'İbradı'), ('TR-07', 'Kaş'), ('TR-07', 'Kemer'), ('TR-07', 'Kepez'), ('TR-07', 'Konyaaltı'), ('TR-07', 'Korkuteli'), ('TR-07', 'Kumluca'), ('TR-07', 'Manavgat'), ('TR-07', 'Muratpaşa'), ('TR-07', 'Serik'),
  ('TR-08', 'Ardanuç'), ('TR-08', 'Arhavi'), ('TR-08', 'Borçka'), ('TR-08', 'Hopa'), ('TR-08', 'Kemalpaşa'), ('TR-08', 'Merkez'), ('TR-08', 'Murgul'), ('TR-08', 'Şavşat'), ('TR-08', 'Yusufeli'),
  ('TR-09', 'Bozdoğan'), ('TR-09', 'Buharkent'), ('TR-09', 'Çine'), ('TR-09', 'Didim'), ('TR-09', 'Efeler'), ('TR-09', 'Germencik'), ('TR-09', 'İncirliova'), ('TR-09', 'Karacasu'), ('TR-09', 'Karpuzlu'), ('TR-09', 'Koçarlı'), ('TR-09', 'Köşk'), ('TR-09', 'Kuşadası'), ('TR-09', 'Kuyucak'), ('TR-09', 'Nazilli'), ('TR-09', 'Söke'), ('TR-09', 'Sultanhisar'), ('TR-09', 'Yenipazar'),
  ('TR-10', 'Altıeylül'), ('TR-10', 'Ayvalık'), ('TR-10', 'Balya'), ('TR-10', 'Bandırma'), ('TR-10', 'Bigadiç'), ('TR-10', 'Burhaniye'), ('TR-10', 'Dursunbey'), ('TR-10', 'Edremit'), ('TR-10', 'Erdek'), ('TR-10', 'Gömeç'), ('TR-10', 'Gönen'), ('TR-10', 'Havran'), ('TR-10', 'İvrindi'), ('TR-10', 'Karesi'), ('TR-10', 'Kepsut'), ('TR-10', 'Manyas'), ('TR-10', 'Marmara'), ('TR-10', 'Savaştepe'), ('TR-10', 'Sındırgı'), ('TR-10', 'Susurluk'),
  ('TR-11', 'Bozüyük'), ('TR-11', 'Gölpazarı'), ('TR-11', 'İnhisar'), ('TR-11', 'Merkez'), ('TR-11', 'Osmaneli'), ('TR-11', 'Pazaryeri'), ('TR-11', 'Söğüt'), ('TR-11', 'Yenipazar'),
  ('TR-12', 'Adaklı'), ('TR-12', 'Genç'), ('TR-12', 'Karlıova'), ('TR-12', 'Kiğı'), ('TR-12', 'Merkez'), ('TR-12', 'Solhan'), ('TR-12', 'Yayladere'), ('TR-12', 'Yedisu'),
  ('TR-13', 'Adilcevaz'), ('TR-13', 'Ahlat'), ('TR-13', 'Güroymak'), ('TR-13', 'Hizan'), ('TR-13', 'Merkez'), ('TR-13', 'Mutki'), ('TR-13', 'Tatvan'),
  ('TR-14', 'Dörtdivan'), ('TR-14', 'Gerede'), ('TR-14', 'Göynük'), ('TR-14', 'Kıbrıscık'), ('TR-14', 'Mengen'), ('TR-14', 'Merkez'), ('TR-14', 'Mudurnu'), ('TR-14', 'Seben'), ('TR-14', 'Yeniçağa'),
  ('TR-15', 'Ağlasun'), ('TR-15', 'Altınyayla'), ('TR-15', 'Bucak'), ('TR-15', 'Çavdır'), ('TR-15', 'Çeltikçi'), ('TR-15', 'Gölhisar'), ('TR-15', 'Karamanlı'), ('TR-15', 'Kemer'), ('TR-15', 'Merkez'), ('TR-15', 'Tefenni'), ('TR-15', 'Yeşilova'),
  ('TR-16', 'Büyükorhan'), ('TR-16', 'Gemlik'), ('TR-16', 'Gürsu'), ('TR-16', 'Harmancık'), ('TR-16', 'İnegöl'), ('TR-16', 'İznik'), ('TR-16', 'Karacabey'), ('TR-16', 'Keles'), ('TR-16', 'Kestel'), ('TR-16', 'Mudanya'), ('TR-16', 'Mustafakemalpaşa'), ('TR-16', 'Nilüfer'), ('TR-16', 'Orhaneli'), ('TR-16', 'Orhangazi'), ('TR-16', 'Osmangazi'), ('TR-16', 'Yenişehir'), ('TR-16', 'Yıldırım'),
  ('TR-17', 'Ayvacık'), ('TR-17', 'Bayramiç'), ('TR-17', 'Biga'), ('TR-17', 'Bozcaada'), ('TR-17', 'Çan'), ('TR-17', 'Eceabat'), ('TR-17', 'Ezine'), ('TR-17', 'Gelibolu'), ('TR-17', 'Gökçeada'), ('TR-17', 'Lapseki'), ('TR-17', 'Merkez'), ('TR-17', 'Yenice'),
  ('TR-18', 'Atkaracalar'), ('TR-18', 'Bayramören'), ('TR-18', 'Çerkeş'), ('TR-18', 'Eldivan'), ('TR-18', 'Ilgaz'), ('TR-18', 'Kızılırmak'), ('TR-18', 'Korgun'), ('TR-18', 'Kurşunlu'), ('TR-18', 'Merkez'), ('TR-18', 'Orta'), ('TR-18', 'Şabanözü'), ('TR-18', 'Yapraklı'),
  ('TR-19', 'Alaca'), ('TR-19', 'Bayat'), ('TR-19', 'Boğazkale'), ('TR-19', 'Dodurga'), ('TR-19', 'İskilip'), ('TR-19', 'Kargı'), ('TR-19', 'Laçin'), ('TR-19', 'Mecitözü'), ('TR-19', 'Merkez'), ('TR-19', 'Oğuzlar'), ('TR-19', 'Ortaköy'), ('TR-19', 'Osmancık'), ('TR-19', 'Sungurlu'), ('TR-19', 'Uğurludağ'),
  ('TR-20', 'Acıpayam'), ('TR-20', 'Babadağ'), ('TR-20', 'Baklan'), ('TR-20', 'Bekilli'), ('TR-20', 'Beyağaç'), ('TR-20', 'Bozkurt'), ('TR-20', 'Buldan'), ('TR-20', 'Çal'), ('TR-20', 'Çameli'), ('TR-20', 'Çardak'), ('TR-20', 'Çivril'), ('TR-20', 'Güney'), ('TR-20', 'Honaz'), ('TR-20', 'Kale'), ('TR-20', 'Merkezefendi'), ('TR-20', 'Pamukkale'), ('TR-20', 'Sarayköy'), ('TR-20', 'Serinhisar'), ('TR-20', 'Tavas'),
  ('TR-21', 'Bağlar'), ('TR-21', 'Bismil'), ('TR-21', 'Çermik'), ('TR-21', 'Çınar'), ('TR-21', 'Çüngüş'), ('TR-21', 'Dicle'), ('TR-21', 'Eğil'), ('TR-21', 'Ergani'), ('TR-21', 'Hani'), ('TR-21', 'Hazro'), ('TR-21', 'Kayapınar'), ('TR-21', 'Kocaköy'), ('TR-21', 'Kulp'), ('TR-21', 'Lice'), ('TR-21', 'Silvan'), ('TR-21', 'Sur'), ('TR-21', 'Yenişehir'),
  ('TR-22', 'Enez'), ('TR-22', 'Havsa'), ('TR-22', 'İpsala'), ('TR-22', 'Keşan'), ('TR-22', 'Lalapaşa'), ('TR-22', 'Meriç'), ('TR-22', 'Merkez'), ('TR-22', 'Süloğlu'), ('TR-22', 'Uzunköprü'),
  ('TR-23', 'Ağın'), ('TR-23', 'Alacakaya'), ('TR-23', 'Arıcak'), ('TR-23', 'Baskil'), ('TR-23', 'Karakoçan'), ('TR-23', 'Keban'), ('TR-23', 'Kovancılar'), ('TR-23', 'Maden'), ('TR-23', 'Merkez'), ('TR-23', 'Palu'), ('TR-23', 'Sivrice'),
  ('TR-24', 'Çayırlı'), ('TR-24', 'İliç'), ('TR-24', 'Kemah'), ('TR-24', 'Kemaliye'), ('TR-24', 'Merkez'), ('TR-24', 'Otlukbeli'), ('TR-24', 'Refahiye'), ('TR-24', 'Tercan'), ('TR-24', 'Üzümlü'),
  ('TR-25', 'Aşkale'), ('TR-25', 'Aziziye'), ('TR-25', 'Çat'), ('TR-25', 'Hınıs'), ('TR-25', 'Horasan'), ('TR-25', 'İspir'), ('TR-25', 'Karaçoban'), ('TR-25', 'Karayazı'), ('TR-25', 'Köprüköy'), ('TR-25', 'Narman'), ('TR-25', 'Oltu'), ('TR-25', 'Olur'), ('TR-25', 'Palandöken'), ('TR-25', 'Pasinler'), ('TR-25', 'Pazaryolu'), ('TR-25', 'Şenkaya'), ('TR-25', 'Tekman'), ('TR-25', 'Tortum'), ('TR-25', 'Uzundere'), ('TR-25', 'Yakutiye'),
  ('TR-26', 'Alpu'), ('TR-26', 'Beylikova'), ('TR-26', 'Çifteler'), ('TR-26', 'Günyüzü'), ('TR-26', 'Han'), ('TR-26', 'İnönü'), ('TR-26', 'Mahmudiye'), ('TR-26', 'Mihalgazi'), ('TR-26', 'Mihalıççık'), ('TR-26', 'Odunpazarı'), ('TR-26', 'Sarıcakaya'), ('TR-26', 'Seyitgazi'), ('TR-26', 'Sivrihisar'), ('TR-26', 'Tepebaşı'),
  ('TR-27', 'Araban'), ('TR-27', 'İslahiye'), ('TR-27', 'Karkamış'), ('TR-27', 'Nizip'), ('TR-27', 'Nurdağı'), ('TR-27', 'Oğuzeli'), ('TR-27', 'Şahinbey'), ('TR-27', 'Şehitkamil'), ('TR-27', 'Yavuzeli'),
  ('TR-28', 'Alucra'), ('TR-28', 'Bulancak'), ('TR-28', 'Çamoluk'), ('TR-28', 'Çanakçı'), ('TR-28', 'Dereli'), ('TR-28', 'Doğankent'), ('TR-28', 'Espiye'), ('TR-28', 'Eynesil'), ('TR-28', 'Görele'), ('TR-28', 'Güce'), ('TR-28', 'Keşap'), ('TR-28', 'Merkez'), ('TR-28', 'Piraziz'), ('TR-28', 'Şebinkarahisar'), ('TR-28', 'Tirebolu'), ('TR-28', 'Yağlıdere'),
  ('TR-29', 'Kelkit'), ('TR-29', 'Köse'), ('TR-29', 'Kürtün'), ('TR-29', 'Merkez'), ('TR-29', 'Şiran'), ('TR-29', 'Torul'),
  ('TR-30', 'Çukurca'), ('TR-30', 'Derecik'), ('TR-30', 'Merkez'), ('TR-30', 'Şemdinli'), ('TR-30', 'Yüksekova'),
  ('TR-31', 'Altınözü'), ('TR-31', 'Antakya'), ('TR-31', 'Arsuz'), ('TR-31', 'Belen'), ('TR-31', 'Defne'), ('TR-31', 'Dörtyol'), ('TR-31', 'Erzin'), ('TR-31', 'Hassa'), ('TR-31', 'İskenderun'), ('TR-31', 'Kırıkhan'), ('TR-31', 'Kumlu'), ('TR-31', 'Payas'), ('TR-31', 'Reyhanlı'), ('TR-31', 'Samandağ'), ('TR-31', 'Yayladağı'),
  ('TR-32', 'Aksu'), ('TR-32', 'Atabey'), ('TR-32', 'Eğirdir'), ('TR-32', 'Gelendost'), ('TR-32', 'Gönen'), ('TR-32', 'Keçiborlu'), ('TR-32', 'Merkez'), ('TR-32', 'Senirkent'), ('TR-32', 'Sütçüler'), ('TR-32', 'Şarkikaraağaç'), ('TR-32', 'Uluborlu'), ('TR-32', 'Yalvaç'), ('TR-32', 'Yenişarbademli'),
  ('TR-33', 'Akdeniz'), ('TR-33', 'Anamur'), ('TR-33', 'Aydıncık'), ('TR-33', 'Bozyazı'), ('TR-33', 'Çamlıyayla'), ('TR-33', 'Erdemli'), ('TR-33', 'Gülnar'), ('TR-33', 'Mezitli'), ('TR-33', 'Mut'), ('TR-33', 'Silifke'), ('TR-33', 'Tarsus'), ('TR-33', 'Toroslar'), ('TR-33', 'Yenişehir'),
  ('TR-34', 'Adalar'), ('TR-34', 'Arnavutköy'), ('TR-34', 'Ataşehir'), ('TR-34', 'Avcılar'), ('TR-34', 'Bağcılar'), ('TR-34', 'Bahçelievler'), ('TR-34', 'Bakırköy'), ('TR-34', 'Başakşehir'), ('TR-34', 'Bayrampaşa'), ('TR-34', 'Beşiktaş'), ('TR-34', 'Beykoz'), ('TR-34', 'Beylikdüzü'), ('TR-34', 'Beyoğlu'), ('TR-34', 'Büyükçekmece'), ('TR-34', 'Çatalca'), ('TR-34', 'Çekmeköy'), ('TR-34', 'Esenler'), ('TR-34', 'Esenyurt'), ('TR-34', 'Eyüpsultan'), ('TR-34', 'Fatih'), ('TR-34', 'Gaziosmanpaşa'), ('TR-34', 'Güngören'), ('TR-34', 'Kadıköy'), ('TR-34', 'Kağıthane'), ('TR-34', 'Kartal'), ('TR-34', 'Küçükçekmece'), ('TR-34', 'Maltepe'), ('TR-34', 'Pendik'), ('TR-34', 'Sancaktepe'), ('TR-34', 'Sarıyer'), ('TR-34', 'Silivri'), ('TR-34', 'Sultanbeyli'), ('TR-34', 'Sultangazi'), ('TR-34', 'Şile'), ('TR-34', 'Şişli'), ('TR-34', 'Tuzla'), ('TR-34', 'Ümraniye'), ('TR-34', 'Üsküdar'), ('TR-34', 'Zeytinburnu'),
  ('TR-35', 'Aliağa'), ('TR-35', 'Balçova'), ('TR-35', 'Bayındır'), ('TR-35', 'Bayraklı'), ('TR-35', 'Bergama'), ('TR-35', 'Beydağ'), ('TR-35', 'Bornova'), ('TR-35', 'Buca'), ('TR-35', 'Çeşme'), ('TR-35', 'Çiğli'), ('TR-35', 'Dikili'), ('TR-35', 'Foça'), ('TR-35', 'Gaziemir'), ('TR-35', 'Güzelbahçe'), ('TR-35', 'Karabağlar'), ('TR-35', 'Karaburun'), ('TR-35', 'Karşıyaka'), ('TR-35', 'Kemalpaşa'), ('TR-35', 'Kınık'), ('TR-35', 'Kiraz'), ('TR-35', 'Konak'), ('TR-35', 'Menderes'), ('TR-35', 'Menemen'), ('TR-35', 'Narlıdere'), ('TR-35', 'Ödemiş'), ('TR-35', 'Seferihisar'), ('TR-35', 'Selçuk'), ('TR-35', 'Tire'), ('TR-35', 'Torbalı'), ('TR-35', 'Urla'),
  ('TR-36', 'Akyaka'), ('TR-36', 'Arpaçay'), ('TR-36', 'Digor'), ('TR-36', 'Kağızman'), ('TR-36', 'Merkez'), ('TR-36', 'Sarıkamış'), ('TR-36', 'Selim'), ('TR-36', 'Susuz'),
  ('TR-37', 'Abana'), ('TR-37', 'Ağlı'), ('TR-37', 'Araç'), ('TR-37', 'Azdavay'), ('TR-37', 'Bozkurt'), ('TR-37', 'Cide'), ('TR-37', 'Çatalzeytin'), ('TR-37', 'Daday'), ('TR-37', 'Devrekani'), ('TR-37', 'Doğanyurt'), ('TR-37', 'Hanönü'), ('TR-37', 'İhsangazi'), ('TR-37', 'İnebolu'), ('TR-37', 'Küre'), ('TR-37', 'Merkez'), ('TR-37', 'Pınarbaşı'), ('TR-37', 'Seydiler'), ('TR-37', 'Şenpazar'), ('TR-37', 'Taşköprü'), ('TR-37', 'Tosya'),
  ('TR-38', 'Akkışla'), ('TR-38', 'Bünyan'), ('TR-38', 'Develi'), ('TR-38', 'Felahiye'), ('TR-38', 'Hacılar'), ('TR-38', 'İncesu'), ('TR-38', 'Kocasinan'), ('TR-38', 'Melikgazi'), ('TR-38', 'Özvatan'), ('TR-38', 'Pınarbaşı'), ('TR-38', 'Sarıoğlan'), ('TR-38', 'Sarız'), ('TR-38', 'Talas'), ('TR-38', 'Tomarza'), ('TR-38', 'Yahyalı'), ('TR-38', 'Yeşilhisar'),
  ('TR-39', 'Babaeski'), ('TR-39', 'Demirköy'), ('TR-39', 'Kofçaz'), ('TR-39', 'Lüleburgaz'), ('TR-39', 'Merkez'), ('TR-39', 'Pehlivanköy'), ('TR-39', 'Pınarhisar'), ('TR-39', 'Vize'),
  ('TR-40', 'Akçakent'), ('TR-40', 'Akpınar'), ('TR-40', 'Boztepe'), ('TR-40', 'Çiçekdağı'), ('TR-40', 'Kaman'), ('TR-40', 'Merkez'), ('TR-40', 'Mucur'),
  ('TR-41', 'Başiskele'), ('TR-41', 'Çayırova'), ('TR-41', 'Darıca'), ('TR-41', 'Derince'), ('TR-41', 'Dilovası'), ('TR-41', 'Gebze'), ('TR-41', 'Gölcük'), ('TR-41', 'İzmit'), ('TR-41', 'Kandıra'), ('TR-41', 'Karamürsel'), ('TR-41', 'Kartepe'), ('TR-41', 'Körfez'),
  ('TR-42', 'Ahırlı'), ('TR-42', 'Akören'), ('TR-42', 'Akşehir'), ('TR-42', 'Altınekin'), ('TR-42', 'Beyşehir'), ('TR-42', 'Bozkır'), ('TR-42', 'Cihanbeyli'), ('TR-42', 'Çeltik'), ('TR-42', 'Çumra'), ('TR-42', 'Derbent'), ('TR-42', 'Derebucak'), ('TR-42', 'Doğanhisar'), ('TR-42', 'Emirgazi'), ('TR-42', 'Ereğli'), ('TR-42', 'Güneysınır'), ('TR-42', 'Hadim'), ('TR-42', 'Halkapınar'), ('TR-42', 'Hüyük'), ('TR-42', 'Ilgın'), ('TR-42', 'Kadınhanı'), ('TR-42', 'Karapınar'), ('TR-42', 'Karatay'), ('TR-42', 'Kulu'), ('TR-42', 'Meram'), ('TR-42', 'Sarayönü'), ('TR-42', 'Selçuklu'), ('TR-42', 'Seydişehir'), ('TR-42', 'Taşkent'), ('TR-42', 'Tuzlukçu'), ('TR-42', 'Yalıhüyük'), ('TR-42', 'Yunak'),
  ('TR-43', 'Altıntaş'), ('TR-43', 'Aslanapa'), ('TR-43', 'Çavdarhisar'), ('TR-43', 'Domaniç'), ('TR-43', 'Dumlupınar'), ('TR-43', 'Emet'), ('TR-43', 'Gediz'), ('TR-43', 'Hisarcık'), ('TR-43', 'Merkez'), ('TR-43', 'Pazarlar'), ('TR-43', 'Simav'), ('TR-43', 'Şaphane'), ('TR-43', 'Tavşanlı'),
  ('TR-44', 'Akçadağ'), ('TR-44', 'Arapgir'), ('TR-44', 'Arguvan'), ('TR-44', 'Battalgazi'), ('TR-44', 'Darende'), ('TR-44', 'Doğanşehir'), ('TR-44', 'Doğanyol'), ('TR-44', 'Hekimhan'), ('TR-44', 'Kale'), ('TR-44', 'Kuluncak'), ('TR-44', 'Pütürge'), ('TR-44', 'Yazıhan'), ('TR-44', 'Yeşilyurt'),
  ('TR-45', 'Ahmetli'), ('TR-45', 'Akhisar'), ('TR-45', 'Alaşehir'), ('TR-45', 'Demirci'), ('TR-45', 'Gölmarmara'), ('TR-45', 'Gördes'), ('TR-45', 'Kırkağaç'), ('TR-45', 'Köprübaşı'), ('TR-45', 'Kula'), ('TR-45', 'Salihli'), ('TR-45', 'Sarıgöl'), ('TR-45', 'Saruhanlı'), ('TR-45', 'Selendi'), ('TR-45', 'Soma'), ('TR-45', 'Şehzadeler'), ('TR-45', 'Turgutlu'), ('TR-45', 'Yunusemre'),
  ('TR-46', 'Afşin'), ('TR-46', 'Andırın'), ('TR-46', 'Çağlayancerit'), ('TR-46', 'Dulkadiroğlu'), ('TR-46', 'Ekinözü'), ('TR-46', 'Elbistan'), ('TR-46', 'Göksun'), ('TR-46', 'Nurhak'), ('TR-46', 'Onikişubat'), ('TR-46', 'Pazarcık'), ('TR-46', 'Türkoğlu'),
  ('TR-47', 'Artuklu'), ('TR-47', 'Dargeçit'), ('TR-47', 'Derik'), ('TR-47', 'Kızıltepe'), ('TR-47', 'Mazıdağı'), ('TR-47', 'Midyat'), ('TR-47', 'Nusaybin'), ('TR-47', 'Ömerli'), ('TR-47', 'Savur'), ('TR-47', 'Yeşilli'),
  ('TR-48', 'Bodrum'), ('TR-48', 'Dalaman'), ('TR-48', 'Datça'), ('TR-48', 'Fethiye'), ('TR-48', 'Kavaklıdere'), ('TR-48', 'Köyceğiz'), ('TR-48', 'Marmaris'), ('TR-48', 'Menteşe'), ('TR-48', 'Milas'), ('TR-48', 'Ortaca'), ('TR-48', 'Seydikemer'), ('TR-48', 'Ula'), ('TR-48', 'Yatağan'),
  ('TR-49', 'Bulanık'), ('TR-49', 'Hasköy'), ('TR-49', 'Korkut'), ('TR-49', 'Malazgirt'), ('TR-49', 'Merkez'), ('TR-49', 'Varto'),
  ('TR-50', 'Acıgöl'), ('TR-50', 'Avanos'), ('TR-50', 'Derinkuyu'), ('TR-50', 'Gülşehir'), ('TR-50', 'Hacıbektaş'), ('TR-50', 'Kozaklı'), ('TR-50', 'Merkez'), ('TR-50', 'Ürgüp'),
  ('TR-51', 'Altunhisar'), ('TR-51', 'Bor'), ('TR-51', 'Çamardı'), ('TR-51', 'Çiftlik'), ('TR-51', 'Merkez'), ('TR-51', 'Ulukışla'),
  ('TR-52', 'Akkuş'), ('TR-52', 'Altınordu'), ('TR-52', 'Aybastı'), ('TR-52', 'Çamaş'), ('TR-52', 'Çatalpınar'), ('TR-52', 'Çaybaşı'), ('TR-52', 'Fatsa'), ('TR-52', 'Gölköy'), ('TR-52', 'Gülyalı'), ('TR-52', 'Gürgentepe'), ('TR-52', 'İkizce'), ('TR-52', 'Kabadüz'), ('TR-52', 'Kabataş'), ('TR-52', 'Korgan'), ('TR-52', 'Kumru'), ('TR-52', 'Mesudiye'), ('TR-52', 'Perşembe'), ('TR-52', 'Ulubey'), ('TR-52', 'Ünye'),
  ('TR-53', 'Ardeşen'), ('TR-53', 'Çamlıhemşin'), ('TR-53', 'Çayeli'), ('TR-53', 'Derepazarı'), ('TR-53', 'Fındıklı'), ('TR-53', 'Güneysu'), ('TR-53', 'Hemşin'), ('TR-53', 'İkizdere'), ('TR-53', 'İyidere'), ('TR-53', 'Kalkandere'), ('TR-53', 'Merkez'), ('TR-53', 'Pazar'),
  ('TR-54', 'Adapazarı'), ('TR-54', 'Akyazı'), ('TR-54', 'Arifiye'), ('TR-54', 'Erenler'), ('TR-54', 'Ferizli'), ('TR-54', 'Geyve'), ('TR-54', 'Hendek'), ('TR-54', 'Karapürçek'), ('TR-54', 'Karasu'), ('TR-54', 'Kaynarca'), ('TR-54', 'Kocaali'), ('TR-54', 'Pamukova'), ('TR-54', 'Sapanca'), ('TR-54', 'Serdivan'), ('TR-54', 'Söğütlü'), ('TR-54', 'Taraklı'),
  ('TR-55', '19 Mayıs'), ('TR-55', 'Alaçam'), ('TR-55', 'Asarcık'), ('TR-55', 'Atakum'), ('TR-55', 'Ayvacık'), ('TR-55', 'Bafra'), ('TR-55', 'Canik'), ('TR-55', 'Çarşamba'), ('TR-55', 'Havza'), ('TR-55', 'İlkadım'), ('TR-55', 'Kavak'), ('TR-55', 'Ladik'), ('TR-55', 'Salıpazarı'), ('TR-55', 'Tekkeköy'), ('TR-55', 'Terme'), ('TR-55', 'Vezirköprü'), ('TR-55', 'Yakakent'),
  ('TR-56', 'Baykan'), ('TR-56', 'Eruh'), ('TR-56', 'Kurtalan'), ('TR-56', 'Merkez'), ('TR-56', 'Pervari'), ('TR-56', 'Şirvan'), ('TR-56', 'Tillo'),
  ('TR-57', 'Ayancık'), ('TR-57', 'Boyabat'), ('TR-57', 'Dikmen'), ('TR-57', 'Durağan'), ('TR-57', 'Erfelek'), ('TR-57', 'Gerze'), ('TR-57', 'Merkez'), ('TR-57', 'Saraydüzü'), ('TR-57', 'Türkeli'),
  ('TR-58', 'Akıncılar'), ('TR-58', 'Altınyayla'), ('TR-58', 'Divriği'), ('TR-58', 'Doğanşar'), ('TR-58', 'Gemerek'), ('TR-58', 'Gölova'), ('TR-58', 'Gürün'), ('TR-58', 'Hafik'), ('TR-58', 'İmranlı'), ('TR-58', 'Kangal'), ('TR-58', 'Koyulhisar'), ('TR-58', 'Merkez'), ('TR-58', 'Suşehri'), ('TR-58', 'Şarkışla'), ('TR-58', 'Ulaş'), ('TR-58', 'Yıldızeli'), ('TR-58', 'Zara'),
  ('TR-59', 'Çerkezköy'), ('TR-59', 'Çorlu'), ('TR-59', 'Ergene'), ('TR-59', 'Hayrabolu'), ('TR-59', 'Kapaklı'), ('TR-59', 'Malkara'), ('TR-59', 'Marmaraereğlisi'), ('TR-59', 'Muratlı'), ('TR-59', 'Saray'), ('TR-59', 'Süleymanpaşa'), ('TR-59', 'Şarköy'),
  ('TR-60', 'Almus'), ('TR-60', 'Artova'), ('TR-60', 'Başçiftlik'), ('TR-60', 'Erbaa'), ('TR-60', 'Merkez'), ('TR-60', 'Niksar'), ('TR-60', 'Pazar'), ('TR-60', 'Reşadiye'), ('TR-60', 'Sulusaray'), ('TR-60', 'Turhal'), ('TR-60', 'Yeşilyurt'), ('TR-60', 'Zile'),
  ('TR-61', 'Akçaabat'), ('TR-61', 'Araklı'), ('TR-61', 'Arsin'), ('TR-61', 'Beşikdüzü'), ('TR-61', 'Çarşıbaşı'), ('TR-61', 'Çaykara'), ('TR-61', 'Dernekpazarı'), ('TR-61', 'Düzköy'), ('TR-61', 'Hayrat'), ('TR-61', 'Köprübaşı'), ('TR-61', 'Maçka'), ('TR-61', 'Of'), ('TR-61', 'Ortahisar'), ('TR-61', 'Sürmene'), ('TR-61', 'Şalpazarı'), ('TR-61', 'Tonya'), ('TR-61', 'Vakfıkebir'), ('TR-61', 'Yomra'),
  ('TR-62', 'Çemişgezek'), ('TR-62', 'Hozat'), ('TR-62', 'Mazgirt'), ('TR-62', 'Merkez'), ('TR-62', 'Nazımiye'), ('TR-62', 'Ovacık'), ('TR-62', 'Pertek'), ('TR-62', 'Pülümür'),
  ('TR-63', 'Akçakale'), ('TR-63', 'Birecik'), ('TR-63', 'Bozova'), ('TR-63', 'Ceylanpınar'), ('TR-63', 'Eyyübiye'), ('TR-63', 'Halfeti'), ('TR-63', 'Haliliye'), ('TR-63', 'Harran'), ('TR-63', 'Hilvan'), ('TR-63', 'Karaköprü'), ('TR-63', 'Siverek'), ('TR-63', 'Suruç'), ('TR-63', 'Viranşehir'),
  ('TR-64', 'Banaz'), ('TR-64', 'Eşme'), ('TR-64', 'Karahallı'), ('TR-64', 'Merkez'), ('TR-64', 'Sivaslı'), ('TR-64', 'Ulubey'),
  ('TR-65', 'Bahçesaray'), ('TR-65', 'Başkale'), ('TR-65', 'Çaldıran'), ('TR-65', 'Çatak'), ('TR-65', 'Edremit'), ('TR-65', 'Erciş'), ('TR-65', 'Gevaş'), ('TR-65', 'Gürpınar'), ('TR-65', 'İpekyolu'), ('TR-65', 'Muradiye'), ('TR-65', 'Özalp'), ('TR-65', 'Saray'), ('TR-65', 'Tuşba'),
  ('TR-66', 'Akdağmadeni'), ('TR-66', 'Aydıncık'), ('TR-66', 'Boğazlıyan'), ('TR-66', 'Çandır'), ('TR-66', 'Çayıralan'), ('TR-66', 'Çekerek'), ('TR-66', 'Kadışehri'), ('TR-66', 'Merkez'), ('TR-66', 'Saraykent'), ('TR-66', 'Sarıkaya'), ('TR-66', 'Sorgun'), ('TR-66', 'Şefaatli'), ('TR-66', 'Yenifakılı'), ('TR-66', 'Yerköy'),
  ('TR-67', 'Alaplı'), ('TR-67', 'Çaycuma'), ('TR-67', 'Devrek'), ('TR-67', 'Ereğli'), ('TR-67', 'Gökçebey'), ('TR-67', 'Kilimli'), ('TR-67', 'Kozlu'), ('TR-67', 'Merkez'),
  ('TR-68', 'Ağaçören'), ('TR-68', 'Eskil'), ('TR-68', 'Gülağaç'), ('TR-68', 'Güzelyurt'), ('TR-68', 'Merkez'), ('TR-68', 'Ortaköy'), ('TR-68', 'Sarıyahşi'), ('TR-68', 'Sultanhanı'),
  ('TR-69', 'Aydıntepe'), ('TR-69', 'Demirözü'), ('TR-69', 'Merkez'),
  ('TR-70', 'Ayrancı'), ('TR-70', 'Başyayla'), ('TR-70', 'Ermenek'), ('TR-70', 'Kazımkarabekir'), ('TR-70', 'Merkez'), ('TR-70', 'Sarıveliler'),
  ('TR-71', 'Bahşılı'), ('TR-71', 'Balışeyh'), ('TR-71', 'Çelebi'), ('TR-71', 'Delice'), ('TR-71', 'Karakeçili'), ('TR-71', 'Keskin'), ('TR-71', 'Merkez'), ('TR-71', 'Sulakyurt'), ('TR-71', 'Yahşihan'),
  ('TR-72', 'Beşiri'), ('TR-72', 'Gercüş'), ('TR-72', 'Hasankeyf'), ('TR-72', 'Kozluk'), ('TR-72', 'Merkez'), ('TR-72', 'Sason'),
  ('TR-73', 'Beytüşşebap'), ('TR-73', 'Cizre'), ('TR-73', 'Güçlükonak'), ('TR-73', 'İdil'), ('TR-73', 'Merkez'), ('TR-73', 'Silopi'), ('TR-73', 'Uludere'),
  ('TR-74', 'Amasra'), ('TR-74', 'Kurucaşile'), ('TR-74', 'Merkez'), ('TR-74', 'Ulus'),
  ('TR-75', 'Çıldır'), ('TR-75', 'Damal'), ('TR-75', 'Göle'), ('TR-75', 'Hanak'), ('TR-75', 'Merkez'), ('TR-75', 'Posof'),
  ('TR-76', 'Aralık'), ('TR-76', 'Karakoyunlu'), ('TR-76', 'Merkez'), ('TR-76', 'Tuzluca'),
  ('TR-77', 'Altınova'), ('TR-77', 'Armutlu'), ('TR-77', 'Çınarcık'), ('TR-77', 'Çiftlikköy'), ('TR-77', 'Merkez'), ('TR-77', 'Termal'),
  ('TR-78', 'Eflani'), ('TR-78', 'Eskipazar'), ('TR-78', 'Merkez'), ('TR-78', 'Ovacık'), ('TR-78', 'Safranbolu'), ('TR-78', 'Yenice'),
  ('TR-79', 'Elbeyli'), ('TR-79', 'Merkez'), ('TR-79', 'Musabeyli'), ('TR-79', 'Polateli'),
  ('TR-80', 'Bahçe'), ('TR-80', 'Düziçi'), ('TR-80', 'Hasanbeyli'), ('TR-80', 'Kadirli'), ('TR-80', 'Merkez'), ('TR-80', 'Sumbas'), ('TR-80', 'Toprakkale'),
  ('TR-81', 'Akçakoca'), ('TR-81', 'Cumayeri'), ('TR-81', 'Çilimli'), ('TR-81', 'Gölyaka'), ('TR-81', 'Gümüşova'), ('TR-81', 'Kaynaşlı'), ('TR-81', 'Merkez'), ('TR-81', 'Yığılca');

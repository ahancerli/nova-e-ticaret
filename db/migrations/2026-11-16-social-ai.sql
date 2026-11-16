-- probe: SELECT a.verify_token, ch.token_ciphertext, s.conversation_limit, r.product_ids_json, c.reply_due_at, m.handled_at, t.output_preview FROM social_ai_app a, social_ai_channels ch, social_ai_settings s, social_ai_referral_maps r, social_ai_conversations c, social_ai_messages m, social_ai_tool_calls t LIMIT 0
-- Social AI Marketing (2026-11-16): the seven social_ai_* tables, their reference rows and the two permissions
-- (social_ai.manage, social_ai.chat). The DDL below is the same text as in db/schema.sql (test_schema.py compares
-- them), so `npm run db:setup` already creates everything on an existing database; this file brings a database that
-- is upgraded with `npm run db:migrate` alone to the same state. No existing table changes. Idempotent.

CREATE TABLE IF NOT EXISTS social_ai_app (
  -- TABLO: Social AI Marketing için mağazanın Meta uygulaması (tek satır): uygulama kimlikleri, şifreli gizli anahtarlar
  --        ve webhook doğrulama anahtarı. Kurulumu yapan firma bir kez girer.
  id                 INTEGER PRIMARY KEY CHECK (id = 1),  -- Hep 1
  app_id             TEXT CHECK (app_id IS NULL OR length(app_id) BETWEEN 5 AND 40),  -- Meta uygulama kimliği (App ID)
  ig_app_id          TEXT CHECK (ig_app_id IS NULL OR length(ig_app_id) BETWEEN 5 AND 40),  -- Instagram uygulama kimliği (Instagram ile giriş ürünü)
  wa_config_id       TEXT CHECK (wa_config_id IS NULL OR length(wa_config_id) BETWEEN 5 AND 40),  -- WhatsApp Embedded Signup yapılandırma kimliği
  verify_token       TEXT NOT NULL CHECK (length(verify_token) BETWEEN 16 AND 80),  -- Webhook doğrulama anahtarı (Meta paneline yazılır)
  secrets_ciphertext TEXT,  -- Şifreli gizli anahtarlar (JSON: uygulama ve Instagram gizli anahtarı)
  secrets_nonce      TEXT,  -- Şifreleme nonce değeri
  secrets_auth_tag   TEXT,  -- GCM doğrulama etiketi
  key_version        TEXT,  -- Ana anahtar sürümü
  updated_by         TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS social_ai_channels (
  -- TABLO: Social AI Marketing kanal bağlantıları (WhatsApp, Instagram), kanal başına bir satır. Erişim anahtarı şifreli,
  --        bağlantı kesilince satır silinir.
  channel          TEXT PRIMARY KEY CHECK (channel IN ('whatsapp','instagram')),  -- whatsapp / instagram
  is_enabled       INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),  -- 1 = bot bu kanalda cevap verir
  status           TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','error')),  -- connected bağlı / error bağlantı sorunu
  external_id      TEXT NOT NULL CHECK (length(external_id) BETWEEN 3 AND 60),  -- WhatsApp telefon numarası kimliği veya Instagram hesap kimliği
  account_id       TEXT CHECK (account_id IS NULL OR length(account_id) <= 60),  -- WhatsApp Business hesap kimliği (WABA)
  display_name     TEXT CHECK (display_name IS NULL OR length(display_name) <= 120),  -- Görünen ad (telefon numarası veya kullanıcı adı)
  token_ciphertext TEXT NOT NULL,  -- Şifreli erişim anahtarı
  token_nonce      TEXT NOT NULL,  -- Şifreleme nonce değeri
  token_auth_tag   TEXT NOT NULL,  -- GCM doğrulama etiketi
  key_version      TEXT NOT NULL,  -- Ana anahtar sürümü
  token_expires_at TEXT,  -- Erişim anahtarının bitiş zamanı (NULL = süresiz)
  connected_via    TEXT NOT NULL DEFAULT 'oauth' CHECK (connected_via IN ('oauth','manual')),  -- oauth sihirbazla / manual elle girildi
  welcome_message  TEXT CHECK (welcome_message IS NULL OR length(welcome_message) <= 500),  -- Bu kanala özel karşılama mesajı (NULL = ortak ayar)
  last_error       TEXT CHECK (last_error IS NULL OR length(last_error) <= 500),  -- Son hata açıklaması
  last_error_at    TEXT,  -- Son hata zamanı
  last_inbound_at  TEXT,  -- Son gelen mesaj zamanı
  connected_by     TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Bağlayan personel
  connected_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Bağlanma zamanı
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS social_ai_settings (
  -- TABLO: Social AI Marketing bot ayarları (tek satır): marka sesi, karşılama, kurallar, yasaklar, çalışma saatleri,
  --        canlı desteğe devir kuralları ve limitler. Hazır varsayılanlarla gelir.
  id                  INTEGER PRIMARY KEY CHECK (id = 1),  -- Hep 1
  tone                TEXT NOT NULL DEFAULT 'friendly' CHECK (tone IN ('friendly','corporate','young')),  -- Marka sesi: friendly samimi / corporate kurumsal / young genç
  tone_note           TEXT NOT NULL DEFAULT '' CHECK (length(tone_note) <= 1000),  -- Marka sesi için serbest açıklama
  welcome_message     TEXT NOT NULL DEFAULT '' CHECK (length(welcome_message) <= 500),  -- İlk mesajda kullanılacak karşılama (boş = model kendisi karşılar)
  rules_text          TEXT NOT NULL DEFAULT '' CHECK (length(rules_text) <= 4000),  -- Mağaza kuralları: kargo, iade, ödeme, kampanya bilgileri
  bans_text           TEXT NOT NULL DEFAULT '' CHECK (length(bans_text) <= 2000),  -- Yasaklar: botun yapmaması gerekenler
  examples_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(examples_json) AND json_type(examples_json) = 'array'),  -- Örnek soru cevap çiftleri (JSON dizi)
  hours_enabled       INTEGER NOT NULL DEFAULT 0 CHECK (hours_enabled IN (0,1)),  -- 1 = bot yalnız çalışma saatlerinde cevap verir
  hours_json          TEXT NOT NULL DEFAULT '{"days":[1,2,3,4,5,6,7],"from":"09:00","to":"22:00"}' CHECK (json_valid(hours_json)),  -- Çalışma günleri ve saatleri (JSON, İstanbul saati)
  off_hours_message   TEXT NOT NULL DEFAULT 'Mesajınız için teşekkürler. Şu an çalışma saatlerimiz dışındayız, en kısa sürede dönüş yapacağız.' CHECK (length(off_hours_message) BETWEEN 1 AND 500),  -- Saat dışında gönderilen mesaj
  handoff_rules       TEXT NOT NULL DEFAULT '' CHECK (length(handoff_rules) <= 2000),  -- Hangi durumlarda canlı desteğe devredileceği
  conversation_limit  INTEGER NOT NULL DEFAULT 40 CHECK (conversation_limit BETWEEN 1 AND 500),  -- Bir konuşmada 24 saatte en fazla bot cevabı
  daily_limit         INTEGER NOT NULL DEFAULT 1000 CHECK (daily_limit BETWEEN 1 AND 100000),  -- Günde en fazla bot cevabı (tüm kanallar)
  updated_by          TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Son değiştiren personel
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Son güncelleme zamanı (uygulama yazar)
) STRICT;

CREATE TABLE IF NOT EXISTS social_ai_referral_maps (
  -- TABLO: Reklam veya gönderi eşlemeleri: belirli bir reklamdan, gönderiden ya da bağlantıdan gelen konuşma hangi
  --        ürünlerle ve hangi ek talimatla başlasın.
  id               TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  source_type      TEXT NOT NULL CHECK (source_type IN ('ad','post','ref')),  -- ad reklam / post gönderi / ref bağlantı kodu
  source_id        TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),  -- Reklam kimliği, gönderi kimliği veya ref kodu
  label            TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),  -- Panelde görünen ad
  product_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(product_ids_json) AND json_type(product_ids_json) = 'array'),  -- Konuşmanın başlayacağı ürünler (JSON dizi, ürün id)
  extra_prompt     TEXT NOT NULL DEFAULT '' CHECK (length(extra_prompt) <= 1000),  -- Bu kaynaktan gelenler için ek talimat
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),  -- 1 = eşleme kullanılır
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Son güncelleme zamanı (uygulama yazar)
  UNIQUE (source_type, source_id)
) STRICT;

CREATE TABLE IF NOT EXISTS social_ai_conversations (
  -- TABLO: Social AI Marketing konuşmaları, kanal ve kişi başına bir satır. Durum, geldiği reklam, cevap sırası ve
  --        kilit bilgisi burada tutulur. Mesajı kalmayan konuşma 30 günlük temizlikte silinir.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp','instagram','preview')),  -- whatsapp / instagram / preview panel denemesi
  contact_id      TEXT NOT NULL CHECK (length(contact_id) BETWEEN 1 AND 80),  -- Kişinin kanal kimliği (WhatsApp numarası veya Instagram kimliği)
  contact_name    TEXT CHECK (contact_name IS NULL OR length(contact_name) <= 120),  -- Kişinin görünen adı
  status          TEXT NOT NULL DEFAULT 'bot' CHECK (status IN ('bot','handoff','closed')),  -- bot cevaplıyor / handoff personele devredildi / closed kapandı
  referral_json   TEXT CHECK (referral_json IS NULL OR json_valid(referral_json)),  -- Geldiği reklam veya gönderi bilgisi (JSON)
  referral_source TEXT CHECK (referral_source IS NULL OR length(referral_source) <= 200),  -- Reklam veya gönderi kimliği (filtre için)
  last_inbound_at TEXT,  -- Müşterinin son mesaj zamanı (24 saat penceresi buradan hesaplanır)
  last_message_at TEXT,  -- Son mesaj zamanı (liste sırası)
  last_preview    TEXT CHECK (last_preview IS NULL OR length(last_preview) <= 160),  -- Son mesajın kısaltılmış metni
  last_sender     TEXT CHECK (last_sender IS NULL OR last_sender IN ('customer','bot','staff')),  -- Son yazan taraf
  staff_unread    INTEGER NOT NULL DEFAULT 0 CHECK (staff_unread >= 0),  -- Devredilen konuşmada personelin okumadığı mesaj sayısı
  reply_due_at    TEXT,  -- Botun cevap üreteceği zaman (art arda gelen mesajlar birikir), NULL = bekleyen yok
  locked_until    TEXT,  -- Cevap üreten işlemin kilidi
  handoff_reason  TEXT CHECK (handoff_reason IS NULL OR length(handoff_reason) <= 300),  -- Devir nedeni
  handoff_at      TEXT,  -- Devir zamanı
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  UNIQUE (channel, contact_id)
) STRICT;
CREATE INDEX IF NOT EXISTS ix_social_ai_conversations_due ON social_ai_conversations (reply_due_at) WHERE reply_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_social_ai_conversations_list ON social_ai_conversations (last_message_at);

CREATE TABLE IF NOT EXISTS social_ai_messages (
  -- TABLO: Social AI Marketing mesajları (gelen ve giden). Meta mesaj kimliği kanal içinde tekildir, aynı mesaj iki kez
  --        işlenmez. 30 günden eski mesajlar kalıcı olarak silinir.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  conversation_id TEXT NOT NULL REFERENCES social_ai_conversations(id) ON DELETE CASCADE,  -- Konuşma
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp','instagram','preview')),  -- Kanal (tekillik kontrolü için)
  direction       TEXT NOT NULL CHECK (direction IN ('in','out')),  -- in gelen / out giden
  sender          TEXT NOT NULL CHECK (sender IN ('customer','bot','staff')),  -- Yazan taraf
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,  -- Yazan personel (staff ise)
  body            TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),  -- Mesaj metni (düz metin)
  external_id     TEXT CHECK (external_id IS NULL OR length(external_id) <= 300),  -- Meta mesaj kimliği
  status          TEXT NOT NULL CHECK (status IN ('received','pending','sent','failed','blocked')),  -- received alındı / pending gönderilecek / sent gönderildi / failed hata / blocked pencere dışı
  error           TEXT CHECK (error IS NULL OR length(error) <= 300),  -- Gönderim hatası
  human_agent     INTEGER NOT NULL DEFAULT 0 CHECK (human_agent IN (0,1)),  -- 1 = personel cevabı (Instagram insan temsilci etiketi)
  handled_at      TEXT,  -- Gelen mesajın bot tarafından işlendiği zaman (NULL = sırada)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),  -- Oluşturulma zamanı (UTC ISO-8601)
  UNIQUE (channel, external_id)
) STRICT;
CREATE INDEX IF NOT EXISTS ix_social_ai_messages_conversation ON social_ai_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ix_social_ai_messages_created ON social_ai_messages (created_at);

CREATE TABLE IF NOT EXISTS social_ai_tool_calls (
  -- TABLO: Botun cevap üretirken çağırdığı araçlar (ürün arama, kargo bilgisi, devir …). Konuşma detayında gösterilir,
  --        30 günden eskiler silinir.
  id              TEXT PRIMARY KEY,  -- Birincil anahtar (uygulamada üretilen UUID)
  conversation_id TEXT NOT NULL REFERENCES social_ai_conversations(id) ON DELETE CASCADE,  -- Konuşma
  message_id      TEXT REFERENCES social_ai_messages(id) ON DELETE SET NULL,  -- Bu çağrıların sonunda yazılan bot cevabı
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),  -- Araç adı (search_products …)
  input_json      TEXT NOT NULL CHECK (json_valid(input_json)),  -- Aracın girdisi (JSON, kişisel veri maskeli)
  output_preview  TEXT NOT NULL DEFAULT '' CHECK (length(output_preview) <= 600),  -- Sonucun kısaltılmış hali
  ok              INTEGER NOT NULL DEFAULT 1 CHECK (ok IN (0,1)),  -- 1 = araç başarıyla çalıştı
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))  -- Oluşturulma zamanı (UTC ISO-8601)
) STRICT;
CREATE INDEX IF NOT EXISTS ix_social_ai_tool_calls_conversation ON social_ai_tool_calls (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ix_social_ai_tool_calls_created ON social_ai_tool_calls (created_at);

-- Reference rows (insert only; the webhook verify token is generated once per database).
INSERT OR IGNORE INTO social_ai_app (id, verify_token) VALUES (1, lower(hex(randomblob(24))));
INSERT OR IGNORE INTO social_ai_settings (id) VALUES (1);
INSERT OR IGNORE INTO permissions (id, code, description) VALUES ('perm_19','social_ai.manage','Social AI Marketing kanal bağlantıları ve bot ayarları');
INSERT OR IGNORE INTO permissions (id, code, description) VALUES ('perm_20','social_ai.chat','Social AI Marketing konuşmalarını görme ve yanıtlama');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'admin' AND p.code IN ('social_ai.manage','social_ai.chat');

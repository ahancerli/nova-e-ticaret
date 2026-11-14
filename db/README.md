# db/ — veri modeli, kurallar ve sözlükler

Bu klasör, uygulamanın tek veri kaynağı olan **SQLite** veritabanını (`data/nova.db`, Docker'da `/data/nova.db`, `node:sqlite`) tanımlar.
Ana proje dokümanı: [`../README.md`](../README.md). Bu dosya veri katmanının "neden ve nasıl"ını anlatır;
tablo/kolon ayrıntıları için doğrudan [`schema.sql`](schema.sql) okunmalıdır (yorumlu, tek dosya).

| Dosya | İçerik |
|---|---|
| `schema.sql` | Tek DDL scripti: **142 STRICT tablo**. Tekrar çalıştırılabilir (tablolar/indeksler `IF NOT EXISTS`, trigger'lar drop + create). Her tablonun başında Türkçe `-- TABLO:` açıklaması, her kolonun sonunda Türkçe yorum var (yeni kolon eklerken yorumunu da yaz). |
| `nova-veritabani-rehberi.pdf` | Tüm tabloların kolon kolon açıklaması + iş akışları (sipariş, ödeme, kampanya, pazaryeri) ve durum makineleri. |
| `seed.sql` | Roller/izinler, demo katalog, demo kullanıcılar ve **demo bir sipariş zinciri** (sepet → checkout → sipariş → havale → kargo). `INSERT OR IGNORE`, tekrar çalıştırılabilir. Gerçek kişi verisi, sır veya gerçek IBAN yok. |
| `drop_all.sql` | Tüm tabloları FK sırasıyla siler (`db:reset`). |
| `tests/test_schema.py` | 44 bağımlılıksız şema testi (`npm run db:test`, python3). |

```bash
npm run db:setup                                      # şema + (yeni dosyaysa) seed + migration'lar — tekrar çalıştırılabilir
npm run db:reset                                      # sil + kur + seed
npm run db:query -- "SELECT id, name FROM categories"
docker compose exec app node scripts/db.mjs exec --command "SELECT …"   # container içindeki veritabanı
```

**Veritabanı dosyası:** `DATABASE_PATH` (local varsayılan `data/nova.db`; Docker'da `nova-data` volume'unda `/data/nova.db`).
WAL modunda ve foreign keys açık (`src/server/sqlite-driver.ts` → `openSqlite`). DataGrip/TablePlus ile local dosyaya bağlanılabilir (açık araçta yenilemek gerekir).

---

## 1. Temel sözleşmeler

- **STRICT tablolar**, ID'ler uygulamada üretilen UUID metni (`crypto.randomUUID()`); seed kısa sabit ID'ler kullanır (`p_knit`, `c_moda`, `u_admin` …).
- **Para:** `*_minor` INTEGER, **kuruş**, **KDV dahil**. `tax_minor` toplamın *içindeki* KDV'dir, toplama tekrar eklenmez.
- **Zaman:** UTC ISO-8601 milisaniyeli metin (`strftime('%Y-%m-%dT%H:%M:%fZ','now')` / `new Date().toISOString()`). Gösterim `Europe/Istanbul`.
- **Boolean:** `0/1` INTEGER. **JSON:** yalnız snapshot/ayar/olay yükü (`json_valid` CHECK).
- **Atomiklik:** uygulama kodu `BEGIN/COMMIT` yazmaz. Çok adımlı yazmalar tek `db.batch([...])` içindedir (sürücü bunu tek `BEGIN IMMEDIATE … COMMIT` olarak, araya başka istek girmeden çalıştırır); bir trigger `RAISE(ABORT, 'kod')` attığında batch'in tamamı geri alınır. Durum geçişleri `UPDATE … WHERE status = <beklenen>` ile korunur ve hemen ardından `batch_guards` koruma satırı eklenir (`core/db/unit-of-work.ts`): koşul tutmazsa batch'in tamamı geri alınır (yarış → 409, yarım yazma yok).
- **Silme yerine durum:** sipariş/ödeme/defter kayıtları silinmez. Ürün → `archived`, varyant → `is_active = 0`, kullanıcı → `anonymized`. Append-only tablolar trigger ile korunur.
- **updated_at** uygulama tarafından yazılır (trigger yok).

## 2. Tablo grupları (schema.sql bölümleri)

| # | Grup | Tablolar (özet) | Uygulamada kullanım |
|---|---|---|---|
| 1 | Kimlik & erişim | `users`, `customer_profiles`, `staff_profiles`, `roles`, `permissions`, `user_roles`, `role_permissions`, `auth_credentials`, `sessions`, `verification_tokens`, `user_consents`, `addresses`, `geo_countries`, `geo_provinces`, `geo_districts` | Giriş (bcrypt), oturum (token HMAC'i saklanır), RBAC, checkout rızası. `geo_*` = ülke + cep telefonu kuralları (245 ülke, libphonenumber) ve Türkiye il/ilçe listesi (81 / 973, PTT); schema.sql sonunda upsert edilir, `modules/geo` telefonu E.164'e çevirir ve TR adresinde il/ilçeyi listeden doğrular. Bayraklar `public/flags/<kod>.svg` |
| 2 | Katalog & stok | `media_assets`, `brands`, `categories`, `suppliers`, `products`, `product_categories`, `product_variants`, `product_media`, `attribute_definitions`, `attribute_options`, `category_attributes`, `product_variant_axes`, `product_attribute_values`, `variant_options`, `supplier_variants`, `price_lists`, `variant_prices`, `variant_price_history`, `warehouses`, `inventory_balances`, `inventory_movements`, `stock_reservations`, `product_relations` | Admin kategori/marka/ürün CRUD, vitrin listeleme/filtre, stok |
| 3 | İçerik & vitrin | `navigation_menus/items`, `story_collections`, `stories`, `story_frames`, `sliders`, `slides`, `home_sections`, `home_section_products`, `content_pages`, `content_page_revisions`, `seo_documents`, `site_settings` | Header/footer, ana sayfa, ürün/sayfa SEO, içerik yönetimi (yasal metinler + sürüm geçmişi), site ayarları |
| 4 | Kampanya & kupon | `campaigns`, `campaign_products/brands/categories`, `campaign_tiers`, `campaign_conditions`, `pricing_policy`, `campaign_reward_products`, `coupons`, `coupon_redemptions`, `campaign_allocations` | Fiyat motoru (`modules/pricing`), panel `/admin/kampanyalar`. `campaigns.offer_type` = gerçek tür (NULL → `kind`); `cart_percentage`/`tiered_quantity`/`cross_sell` `kind='percentage'` ile saklanır (canlı D1'de `kind` CHECK'i değiştirilemez: tabloyu yeniden kurmak kuponları/hedefleri CASCADE ile siler). Taban fiyat `variant_prices.min_price_minor` |
| 5 | Sepet & sipariş | `carts`, `cart_items`, `cart_coupons`, `checkout_sessions`, `orders`, `order_addresses`, `order_items`, `order_adjustments`, `order_events` | Checkout, admin sipariş yönetimi |
| 6 | Ödeme & lojistik | `payment_configs`, `bank_accounts`, `payments`, `payment_events`, `bank_transfers`, `refunds`, `integration_providers`, `integrations`, `integration_secrets`, `ai_integration`, `ai_models`, `mail_integration`, `mail_deliveries`, `captcha_settings`, `shipping_methods`, `shipments`, `shipment_items`, `shipment_events`, `carrier_shipments` | iyzico/havale, iade, kargo, webhook, tek AI sağlayıcısı, SMS/kargo firma kataloğu |
| 7 | Etkileşim & operasyon | `wishlists(_items)`, `recent_views`, `reviews` (+ `review_votes`, `review_contacts`, `review_settings` tek satır), `admin_notifications` (+ `_states` kişi başı okundu/arşiv, `_rules` tür başı panel/e-posta, `_mutes` kişisel), `comparison_sessions/items` (kullanılmıyor: karşılaştırma listesi tarayıcıda), `external_search_jobs`, `external_offers`, `idempotency_keys`, `outbox_events`, `audit_logs`, `rate_limit_buckets`, `batch_guards`, `consent_settings` (tek satır: banner, CMP, Consent Mode, revizyon), `tracking_tags` (firma başına etiket, açık kimlikler), `tracking_tag_secrets` (GA4 / Meta sunucu anahtarları, şifreli), `order_tracking_contexts` (sipariş anındaki çerez onayı + reklam çerezleri, sunucudan satın alma olayı için), `cookie_consents` (çerez tercihi ispatı, güncellenemez) | Idempotency, outbox worker, audit (panelde `/admin/denetim`, salt okunur), rate limit, batch eşzamanlılık koruması (diğerlerinin UI'ı yok) |

## 3. Kuralları kim koruyor?

### Veritabanı (CHECK / UNIQUE / FK / trigger)
| Trigger | Ne yapar | Hata kodu (uygulama eşler) |
|---|---|---|
| `trg_categories_no_cycle_ins/upd` | Kategori ağacında döngü yok | `category_cycle` |
| `trg_nav_items_no_cycle_upd`, `trg_nav_items_same_menu` | Menü ağacı döngüsü / farklı menü | — |
| `trg_pav_type_ins/upd` | Özellik değeri tipi = tanım tipi; tek değerli tipte `value_index>0` yok | `attribute_type_mismatch` |
| `trg_variant_options_axis` | Varyant seçeneği yalnız ürüne atanmış eksenden | `variant_axis_not_assigned` |
| `trg_stock_res_check/apply` | Rezervasyon: `on_hand - reserved ≥ adet`, sonra `reserved += adet` (son adet yarışında tek kazanan) | `insufficient_stock` |
| `trg_stock_res_guard/transition` | Rezervasyon miktarı değişmez; terminalden dönüş yok; `committed` → `on_hand` ve `reserved` düşer, `released/expired` → yalnız `reserved` düşer | `reservation_terminal` |
| `trg_inv_movements_no_update/delete`, `trg_order_events_no_*`, `trg_audit_no_*` | Append-only defterler | `append_only` |
| `trg_order_amounts_immutable`, `trg_order_items_immutable` | Sipariş tutar/satır snapshot'ı değişmez | `order_snapshot_immutable` |
| `trg_campaign_capacity` | Kampanya kapasitesi aşılmaz | `campaign_capacity_exceeded` |
| `trg_coupon_limits` | Kupon aktif + global + müşteri başı limit | `coupon_*` |
| `trg_campaign_activate_targets` | `selected` kampanya hedefsiz aktif edilemez | `campaign_without_targets` |
| `trg_payment_paid_terminal` | `paid` ödeme yalnız `refunded/partially_refunded` olabilir | `payment_paid_terminal` |
| `trg_batch_guard_fail/pass` | `UnitOfWork.expectChanges`: `INSERT INTO batch_guards (guard, actual, expected) VALUES (i, changes(), n)` — eşitse satır atlanır (tablo hep boş), değilse **tüm batch** geri alınır; mesajdaki `i` hangi guard'ın tetiklendiğini söyler | `batch_guard_failed:<i>` |

**Son 30 günün en düşük fiyatı (Ticaret Bakanlığı indirim kuralı):** `variant_prices` fiyatı her değiştiğinde `trg_price_history_*` trigger'ları `variant_price_history`'de açık satırı kapatır, yenisini açar ve yeni fiyattan önceki 30 günde uygulanan en düşük fiyatı `lowest_prior_minor`'a yazar (uygulama bu tabloya yazmaz; panel, Excel, XML feed aynı yoldan geçer). Vitrin, karşılaştırma ve pazaryeri `listPrice` ham `compare_at_minor`'ı değil `shownCompareAtSql` (`modules/catalog`) sonucunu kullanır: `MIN(compare_at, lowest_prior)`, bu değer satış fiyatından büyük değilse üstü çizili fiyat gösterilmez. Tablodan önce var olan fiyatların geçmişi bilinmediği için (`lowest_prior_minor` NULL) bir sonraki gerçek indirime kadar üstü çizili fiyatları görünmez. Panel ürün düzenleyicisi eski fiyat alanının altında vitrinde gerçekte gösterilecek değeri yazar.

Önemli CHECK'ler: `orders.total = subtotal - discount + shipping`, `order_items.subtotal = qty × unit`, `variant_prices.compare_at > unit_price`, `variant_price_history` tek açık satır (`valid_to IS NULL`, varyant × fiyat listesi), `bank_transfers` `matched` ise `received = expected` + onaylayan + zaman, `carts` sahibi user **xor** guest, `inventory_balances.on_hand ≥ reserved ≥ 0`, slug'lar `[a-z0-9-]`.

### Uygulama katmanı (src/modules/*/application) — DB'nin bilmediği kurallar
- SKU ve barkod katalog genelinde benzersiz (payload içinde + diğer ürünler); varyant kombinasyonu ürün içinde benzersiz; eksensiz ürün tek varyant.
- **Varyant = fiyatı/stoğu/görseli ayrı seçenek** (Renk, Beden, Numara, Ölçü): `attribute_definitions.is_variant_axis = 1`. Disk kapasitesi gibi farklar ürün bilgisidir (ayrı ürün açılır). `varies_media = 1` olan eksen (Renk) ürün görsellerini değiştirir: editör her değere görsel yükler, kayıt `product_media.variant_id` satırlarıdır (o değerdeki tüm varyantlara aynı görseller; `is_primary` hep 0 — vitrin kapağı galerinindir). Galeri boşsa varsayılan varyantın görseli kart görselidir; yayın için galeri **veya** aktif bir varyantın görseli yeterli.
- **Model kodu** `products.model_code` (Trendyol `productMainId`): büyük harf, `[A-Za-z0-9._-]`, doluysa benzersiz (index yok — kolon ALTER ile eklendiği için; kaydetme use case'i kontrol eder). Toplu "Ürün ekle"de aynı model kodlu satırlar tek ürünün varyantları olur; var olan model koduna yazılan satırlar o ürüne yeni varyant olarak eklenir. Pazaryerine `productMainId` = model kodu › üretici kodu › slug.
- **Satılmış/hareketli varyant** (sipariş satırı, stok hareketi veya rezervasyonu olan) SKU/kombinasyon değiştiremez; kaldırılırsa silinmez, `is_active = 0` olur.
- Ürün: en az 1 kategori; `published` için en az 1 görsel ve `catalog.publish` izni; kategorinin (üst kategoriler dahil) `category_attributes.is_required` özellikleri dolu olmalı (varyant ekseni olarak seçilmişse sağlanmış sayılır).
- Stok, rezerve miktarın altına inemez; her stok değişikliği aynı batch'te `inventory_movements`'a yazılır.
- Kargo: gönderilen adet ≤ sipariş adedi (kısmi gönderim destekli).
- İade: toplam iade (requested + processing + succeeded) ≤ tahsil edilen; stoğa geri alma ≤ sipariş adedi − önceden geri alınan.
- Havale onayı: gelen ≠ beklenen → `mismatch`, sipariş ödendi **yapılmaz**; rezervasyon süresi dolmuşsa onay reddedilir.
- Kategori/marka silme: alt kategorisi/ürünü olan kategori, ürünü veya hikayesi olan marka silinmez (`stories.brand_id` CASCADE olduğu için servis engeller).
- Yüklenen medya, artık hiçbir `categories / brands / product_media` satırı göstermiyorsa DB'den ve medya deposundan (`MEDIA_DIR`) silinir (varyant görselleri dahil: kaydetmede çıkan veya silinen ürünün tüm görselleri); seed/demo medyaya dokunulmaz.

## 4. Durumlar ve geçişler

**orders.status** (durum makinesi: `src/lib/order-rules.ts`)
```
pending_payment ─┐            ┌─ prepare ─► preparing ─┐
                 ├─(ödeme)─► paid ─────────── ship ───┴─► shipped ─ deliver ─► delivered ─ complete ─► completed
awaiting_transfer┘  reconcile     (kısmi gönderimde preparing'de kalır)
pending_payment / awaiting_transfer ── cancel ──► cancelled      (stok/kupon/kampanya serbest)
paid … completed ── refund (tam) ──► refunded                     (kısmi iade durumu değiştirmez)
cron expire: süresi dolan rezervasyonlu ödenmemiş sipariş ──► cancelled
```
| Tablo.kolon | Değerler ve anlam |
|---|---|
| `orders.payment_status` | `unpaid` (iptal edilmiş) · `pending` · `paid` · `failed` (süre doldu) · `partially_refunded` · `refunded` |
| `payments.status` | `created/pending` → `paid` (markPaymentPaid) / `failed` / `cancelled` (sipariş iptali) → `partially_refunded` / `refunded` |
| `bank_transfers.status` | `awaiting` → `matched` (onay) / `mismatch` (tutar farkı) / `cancelled` / `expired` |
| `refunds.status` | `processing` (iyzico, worker bekliyor) → `succeeded` / `failed`; havale iadesi aynı istekte `succeeded` |
| `shipments.status` | `shipped` (panelden oluşturulur) → `in_transit` / `delivered` / `returned` / `lost` (webhook); terminaller yeniden açılmaz |
| `stock_reservations.status` | `reserved` → `committed` (ödeme) / `released` (iptal) / `expired` (cron) |
| `checkout_sessions.status` | `open` → `confirmed` / `cancelled` (yeni quote) / `expired` |
| `products.status` | `draft` · `in_review` · `published` (vitrinde) · `paused` · `archived` |
| `outbox_events.status` | `pending` → `processing` (5 dk kilit) → `done` / `pending` (geri çekilme) / `dead` (8 deneme veya işleyici yok) |
| `reviews.status` | `pending` (yeni / düzenlenmiş yorum, panel bildirimi) → `approved` (Yayınla; `published_at`) / `rejected` (Yayınlama, `reject_reason` zorunlu); `approved` → `hidden` (Yayından kaldır) → `approved`; `rejected` / `hidden` → `approved`. Müşteri düzenlerse yeniden `pending` (`auto_trusted` kuralı tutarsa doğrudan `approved`). Yalnız `approved` puana ve vitrine girer |
| `reviews.contact_status` | `none` → `contacted` (ilk iletişim kaydı) → `resolved` (elle) |
| `review_contacts.delivery` | `logged` (telefon / not; e-postada gönderim sonucu yazılana kadar) → `sent` / `failed` / `not_configured` (SMTP yok) |

## 5. Uygulamanın kullandığı sözlükler

| Alan | Değerler |
|---|---|
| `order_events.event_type` | `placed`, `payment_captured`, `payment_mismatch`, `status_changed`, `shipment_created`, `delivered`, `cancelled`, `refund_requested`, `refunded`, `refund_failed`, `note` (from/to_status yalnız durum değişiminde dolu) |
| `inventory_movements.kind` / `reference_type` | `receipt` (ilk stok, ref `product`), `adjustment` (panel, ref `product`), `reserve` (checkout, ref `order`), `commit` (ödeme), `release` (iptal/expire, ref `order`/`checkout`), `return` (iade stoğa alma, ref **`order_item`** — kalem bazlı iade sayımı bu satırlardan yapılır) |
| `outbox_events.event_type` → payload | `order.placed {orderNumber,paymentMethod}`, `order.paid {}`, `order.shipped {shipmentId,trackingNumber}`, `order.delivered {}`, `order.cancelled {reason}`, `refund.process {refundId,orderId}`, `refund.succeeded {refundId,amountMinor,full}`; `dedupe_key = "<tip>:<id>"` |
| `idempotency_keys.scope` | `checkout.confirm`, `order.action:<orderId>`, `order.bulk` (24 saat) |
| `rate_limit_buckets.bucket_key` | `login-fail:<ipHash>`, `storefront-login-fail:…`, `admin-login-fail:…`, `coupon-fail:…` (dakikada 5 hata), `login-account-fail:<userId>:<ipHash>` (15 dakikada 10 hata, yalnız o IP), `iyzico-callback:…` (dakikada 30 istek), `iyzico-webhook:…` (dakikada 300 istek) |
| `audit_logs.action` → `entity_type` | `category.*` → category, `brand.*` → brand, `product.*` → product (create/update/delete), `media.upload` → media, `order.<action>` / `order.bulk.<action>` → order, `campaign.create/update/delete` → campaign, `coupon.create` → campaign, `coupon.<işlem>` → coupon, `content.create/update/delete` → content_page, `showcase.{section,slider,slide,stories,story}.<işlem>` → showcase, `staff.invite/update/<işlem>` · `customer.signup/update/<işlem>` · `account.invite_accepted/password_reset` → user, `role.create/update/delete` → role, `settings.update` → site_settings (entity_id = grup), `ai_integration.create/update/delete` · `ai.product_generate` → ai_integration (entity_id = sağlayıcı; anahtar asla yazılmaz), `mail_integration.create/update/delete` → mail_integration (entity_id = `smtp`; parola asla yazılmaz), `captcha.update` → captcha_settings (entity_id = `default`; gizli anahtar asla yazılmaz), `integration.create/update/delete` → integration (entity_id = `sms` \| `shipping`; şifreler asla yazılmaz), `payment.*` → payment_config, `bank_account.*` → bank_account. Türkçe adlar ve alanlar (sekme) `src/modules/audit/domain/audit.ts`'te; **yeni action = oraya etiket** (yoksa kod olduğu gibi gösterilir). Görüntüleyici `ix_audit_created`, `ix_audit_actor`, `ix_audit_request`, `ix_audit_entity` indekslerini kullanır |
| `media_assets` (yüklenen) | `storage_key = "<klasör>/<uuid>.<png|jpg|webp|avif>"`, klasör ∈ `categories · brands · products · branding` (branding = logo/favicon/paylaşım görseli, `settings.write` ister); `public_url = "/assets/<storage_key>"` (medya deposundan sunulur); `alt_text` = orijinal dosya adı; `sha256`, `width/height` dolu |
| `ai_integration` | Tek satır (`id = 'default'` CHECK) → sistemde en fazla bir AI sağlayıcısı; `provider` ∈ openai · gemini · anthropic, `model` (2–100) panelde `ai_models` kataloğundan seçilir (FK yok: model katalogdan emekliye ayrılsa da satır geçerli kalır). API anahtarı `api_key_ciphertext/nonce/auth_tag` (AES-256-GCM, `SECRETS_MASTER_KEY`, `key_version = v1`), `api_key_hint` = `…son4`. `updated_at` eşzamanlılık kontrolü. `integrations.kind` CHECK'ine `'ai'` eklemek, başka tabloların (`integration_secrets` CASCADE, iki tablo SET NULL) işaret ettiği tabloyu yeniden kurmayı gerektirdiği için ayrı tablo. Mevcut veritabanına `db:schema:*` yeterli (yeni tablo) |
| `ai_models` | AI model kataloğu (referans veri; `schema.sql` sonunda upsert). PK `(provider, model_id)`; `status` ∈ active · deprecated · retired, `retires_at` `YYYY-MM-DD`. Sağlayıcının varsayılanı = ilk `active` satır (`sort_order`). Satır silinmez; kapanış duyurulunca `deprecated`, kapanınca `retired` (panelde gizli). Doğrulama `npm run ai:health` |
| `mail_deliveries` | Her giden e-posta denemesi (`SmtpMailSender`): `purpose` ∈ password_reset · test · other, `status` ∈ sent · failed · not_configured · throttled; `failed` ⇔ `error_code` dolu (CHECK). `stage` / `error_*` SMTP sınıflandırıcısından, `server_reply` SMTP sunucusunun kendi yanıtı. İçerik, bağlantı, parola tutulmaz; 30 günden eski satırlar yazarken silinir (`ix_mail_deliveries_created`) |
| `captcha_settings` | Tek satır (`id = 'default'`) → bot koruması: `enabled` (0/1), `provider` ∈ turnstile · recaptcha_v3, `site_key` (herkese açık), gizli anahtar `secret_ciphertext/nonce/auth_tag` AES-256-GCM (`SECRETS_MASTER_KEY`) + `secret_hint` (son 4), `forms` JSON dizisi (signup · login · forgot · review), `min_score` 0.1–0.9 (reCAPTCHA v3), `verified_at` = panelde bu anahtarlarla son başarılı doğrulama (açmak için zorunlu). `updated_at` eşzamanlılık kontrolü. Mevcut veritabanına `db:schema:*` yeterli (yeni tablo) |
| `mail_integration` | Tek satır (`id = 'default'`) → mağazanın SMTP hesabı: `host`, `port` (1–65535), `security` ∈ ssl · starttls, `username`, `from_email`, `from_name`. SMTP parolası **hash'lenemez** (sunucu SMTP'ye düz parolayı sunmak zorunda) → `password_ciphertext/nonce/auth_tag` AES-256-GCM (`SECRETS_MASTER_KEY`, `key_version = v1`). `updated_at` eşzamanlılık kontrolü. Mevcut veritabanına `db:schema:*` yeterli (yeni tablo) |
| `integration_secrets.secret_name` | iyzico (`payment_config_id`): `api_key`, `secret_key`; SMS/kargo (`integration_id`): firmanın gizli alanlarının `key`'i (Netgsm, Yurtiçi: `password`) ve push yapan kargo için `webhook_secret`. AES-256-GCM, anahtar `SECRETS_MASTER_KEY`. UNIQUE'te NULL kolon var → upsert çalışmaz, sil + ekle |
| `integration_providers` | Firma kataloğu (referans veri, `schema.sql` sonunda **upsert** — her şema çalıştırmada ad/alan/durum güncellenir). `support_status` ready = uygulamada adaptör var (CHECK: ready ise `credential_fields_json` boş olamaz), planned = listelenir ama seçilince `provider_not_integrated`. `credential_fields_json` = panel formu (`key,label,type text\|password\|select,required,secret,…`) |
| `integrations` | Tür başına tek aktif satır (`ux_integration_active_kind`); panel tür başına tek satır tutar (başka firma seçilince eskisi silinir, şifreler CASCADE). `public_config_json` = `{values:{gizli olmayan alanlar}, settings:{events:{<olay>:{enabled,template}}}}` |
| `carrier_shipments` | Gönderi başına bir kargo kaydı; `cargo_key` bizim sabit anahtarımız (`NV` + gönderi id, UNIQUE firma başına). `booked → closed` (terminal takip) \| `cancelled`; `failed` için `last_error` zorunlu |
| `site_settings.key` | Anahtar listesi, tip ve doğrulama kuralları **tek yerde**: `src/modules/settings/domain/registry.ts` (kayıtta olmayan anahtar okunmaz/yazılamaz). Gruplar: `general` (site.name, site.tagline, site.announcement `{text,href}`), `company` (company.legal_name, address, tax_office, tax_number, mersis_no, trade_registry_no, kep_address, data_controller_contact), `contact` (email, phone, whatsapp, hours), `branding` (logo/favicon `*_media_id`, accent_color `#rrggbb`), `seo` (default_title, title_template `%s`, default_description, og_image_media_id, allow_indexing, google_verification), `social` (instagram, facebook, x, youtube, tiktok, linkedin), `footer` (copyright `{{yil}}`, trust_badges `string[]` ≤ 4, payment_note). Boş değer = satır silinir |
| `content_pages` | `kind` ∈ legal · corporate · help · general; `legal_type` yalnız `kind='legal'`de (CHECK) ve arşivde olmayan **tek** sayfa (kısmi UNIQUE index); `status` draft · published · archived (`published` ⇒ `published_at`); `footer_column` corporate · help · legal (NULL = footer'da yok). Gövde HTML kaydederken sanitize edilir; `{{firma.unvan}}` gibi yer tutucular gösterimde site ayarlarından doldurulur (değerler HTML-escape). Her kayıt `version`'ı 1 artırır ve `content_page_revisions`'a o sürümün metnini yazar; checkout onayı `user_consents.document_version = "ms<v>-ob<v>"` (mesafeli satış + ön bilgilendirme sürümleri). Yayınlanmış yasal metin silinemez (arşivlenir) |
| `verification_tokens.purpose` | `staff_invite` (7 gün) ve `password_reset` (24 saat) = tek kullanımlık hesap bağlantıları; yalnız HMAC (`account:` kapsamı, oturum token'ından ayrı) saklanır; yenisi verilince eskisi `consumed_at` ile geçersiz; kullanım koşullu UPDATE ile tek sefer. Personelde `auth_credentials` satırı davet kabul edilene kadar yoktur (durum “Davet bekliyor”) |
| `roles` | `is_system` = hazır rol (silinmez); `admin` her zaman tüm izinler, `customer` personele atanamaz; özel rollerin `code`'u addan türetilir. `updated_at` rol düzenlemede eşzamanlılık kontrolü |
| `users.last_login_at` | Başarılı girişte (panel ve mağaza) yazılır; kullanıcı ve müşteri listelerinde gösterilir |
| `auth_credentials` | `failed_attempts` yalnız görünürlük içindir (başarılı girişte sıfırlanır); `locked_until` artık kilit için **kullanılmaz** (global hesap kilidi DoS'a açıktı) ve girişte temizlenir |
| `price_lists` / `warehouses` | Uygulama yalnız `pl_retail` (TRY) ve `wh_main` kullanır (sabit) |

## 6. Seed içeriği

- **Roller → izinler:** `admin` (16 iznin tamamı) · `catalog_manager` (catalog.read, catalog.write, storefront.write — **catalog.publish yok**) · `order_manager` (orders.read, orders.write, payments.reconcile, customers.read, customers.write) · `marketing_manager` (catalog.read, storefront.write, campaigns.write, content.write) · `customer` (yok).
- **İzinler:** catalog.read/write/publish, orders.read/write, payments.reconcile, payments.secrets, storefront.write, campaigns.write, integrations.write, users.manage, audit.read, settings.write, customers.read, customers.write, content.write. Etiketler ve gruplar `src/modules/staff/domain/permissions.ts` (rol editörü yalnız oradaki kodları kabul eder).
- **Demo müşteriler:** `u_cust_2..4` (Zeynep Kaya, Mehmet Yılmaz, Elif Şahin) — KVKK ve ticari ileti onaylarıyla; müşteri listesi/segment ekranları için.
- **Demo kullanıcılar:** `admin@nova.local` (u_admin, admin) ve `musteri@nova.local` (u_customer). Parola hash'leri demo amaçlıdır ve parola **dokümante edilmemiştir** → local'de kendi admininizi oluşturun: `npm run admin:create -- siz@ornek.com "Ad Soyad"` (var olan e-postada parolayı sıfırlar). **Canlı veritabanında bu demo kullanıcıları silin veya parolalarını değiştirin.**
- **Katalog:** 5 marka, 9 kategori (Moda › Erkek › Kazak; Moda zorunlu özellik: renk + beden), 5 ürün (triko 3 varyant renk×beden, diğerleri tek varyant), fiyatlar, `wh_main` stokları, demo SVG görseller (`/public/demo`).
- **Demo sipariş:** `NOVA-2026-0001` (havale bekliyor, banka hesabı `ba_demo_1`, bir kargo kaydı); `pc_bank` ve `pc_iyzico_sbx` **pasif**, iyzico sırları yok. Kampanya `cmp_3al2` (Mutfak kategorisinde 3 al 2 öde, 🔥 rozetli) **aktif**, kupon `NOVA3AL2ODE`.
- **Site ayarları ve içerik:** kurgusal firma bilgileri (Nova Elektronik Ticaret A.Ş., örnek VKN/MERSİS/KEP), iletişim, vurgu rengi, SEO, sosyal hesaplar, footer rozetleri; 8 yasal metin şablonu (6 zorunlu yayında; kullanım koşulları ve üyelik sözleşmesi taslak) + Hakkımızda, İletişim, SSS, Kargo ve Teslimat — her biri sürüm 1 ve ilk revizyonuyla. Footer menüsünde yalnız “Keşfet” sütunu var; diğer sütunlar yayındaki sayfalardan otomatik gelir. Hepsi panelden değiştirilecek örnek veridir.
- `tests/integration/services.test.ts` seed'in işlem verisini (sipariş, sepet, kullanıcı) test başında temizler; katalog seed'ine güvenir.

## 6b. Toplu işlemler

- `bulk_jobs`: her Excel içe aktarma / akış geçişi bir satır (sayaçlar + ilk 100 hata `summary_json`). Satır verisi saklanmaz.
- `product_feeds`: XML / REST kaynağı; `mapping_json` = `{alan: "kaynak/yolu"}`, `header_secret_json` AES-256-GCM (panel geri okumaz); `run_cursor` + `pass_started_at` yarım kalmış geçişi tutar, `next_run_at` cron için.
- `product_feed_items`: öğe başına son yazılan içerik / görsel hash'i ve `last_seen_at` (değişmeyen atlanır, kaynakta olmayan → stok 0).
- Anahtar aramaları için `ix_products_accounting_code` / `ix_products_manufacturer_code` (bu kolonlar benzersiz değildir; birden çok ürüne çıkan anahtar satır hatası olur).

## 7. Şema değişikliği prosedürü

1. `schema.sql` içinde ilgili tabloyu/indeksi/trigger'ı değiştir (bölüm başlıklarına uy, STRICT + CHECK ekle).
2. **Var olan veritabanı için:** `CREATE TABLE IF NOT EXISTS` mevcut tabloya kolon **eklemez**. Kolon eklemeleri `db/migrations/<tarih>-<ad>.sql` dosyasına yazılır (ilk satır `-- probe: SELECT yeni_kolon FROM tablo LIMIT 0`); `npm run db:setup` (container her açılışta) önce `schema.sql`'i, sonra probe'u başarısız olan migration'ları **bir kez** uygular. Local'de veri önemsizse `npm run db:reset` de olur; canlıda reset veri siler.
   Örnek: `db/migrations/2026-11-06-campaign-engine.sql` (kampanya motoru kolonları + demo kampanyasını açar). `db/tests/test_schema.py` #48 bunu önceki commit'in şemasıyla doğrular. `2026-11-09-variant-media.sql`: `products.model_code`, `attribute_definitions.varies_media`, `trg_ccl_products` yeniden (model kodu değişince pazaryerine içerik gider); #55 doğrular.
3. Yeni tablo eklediysen `drop_all.sql` (FK sırası: önce çocuklar) ve `tests/test_schema.py` içindeki tablo sayısını güncelle.
4. Trigger'lar her çalıştırmada drop + create edildiğinden değişiklikleri `npm run db:schema` (ya da container'ın yeniden başlaması) ile uygulanır.
5. `npm test` (tüm şema ve modül testleri, bkz. kök README §9) yeşil olmalı. Seed'e eklenen veri `INSERT OR IGNORE` olmalı.
6. SQLite sürüm farkı: SQLite ≥ 3.51, ilişkili alt sorgunun **ORDER BY**'ında dış tablo kolonuna izin vermez (`no such column`). Dış referansı yalnız `WHERE`'de kullan (örnek: `pricing.ts` `image_url` için `COALESCE(alt sorgu1, alt sorgu2)`).

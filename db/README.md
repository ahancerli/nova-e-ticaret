# db/ — veri modeli, kurallar ve sözlükler

Bu klasör, uygulamanın tek veri kaynağı olan **Cloudflare D1 (SQLite)** veritabanını tanımlar.
Ana proje dokümanı: [`../README.md`](../README.md). Bu dosya veri katmanının "neden ve nasıl"ını anlatır;
tablo/kolon ayrıntıları için doğrudan [`schema.sql`](schema.sql) okunmalıdır (yorumlu, tek dosya).

| Dosya | İçerik |
|---|---|
| `schema.sql` | Tek DDL scripti: **87 STRICT tablo · 47 indeks · 23 trigger**. Tekrar çalıştırılabilir (tablolar/indeksler `IF NOT EXISTS`, trigger'lar drop + create). |
| `seed.sql` | Roller/izinler, demo katalog, demo kullanıcılar ve **demo bir sipariş zinciri** (sepet → checkout → sipariş → havale → kargo). `INSERT OR IGNORE`, tekrar çalıştırılabilir. Gerçek kişi verisi, sır veya gerçek IBAN yok. |
| `drop_all.sql` | Tüm tabloları FK sırasıyla siler (`db:reset:*`). |
| `tests/test_schema.py` | 40 bağımlılıksız şema testi (`npm run db:test`, python3). |

```bash
npm run db:schema:local && npm run db:seed:local      # local SQLite-D1 kur
npm run db:reset:local                                # sil + kur + seed
npm run db:query:local -- "SELECT id, name FROM categories"
npm run db:schema:remote / db:seed:remote / db:reset:remote / db:query -- "…"   # Cloudflare D1
```

**Local D1 dosyası** (wrangler/miniflare yönetir, ad sabit hash'tir):
`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/c917712ba74c5102d69ecf1555a42fe4d03ba423fee62c633ac82b645ae953eb.sqlite`
DataGrip/TablePlus ile bu dosyaya bağlanılabilir (WAL modunda; açık araçta yenilemek gerekir). Uygulama başka bir `.db` dosyasını okuyamaz.

---

## 1. Temel sözleşmeler

- **STRICT tablolar**, ID'ler uygulamada üretilen UUID metni (`crypto.randomUUID()`); seed kısa sabit ID'ler kullanır (`p_knit`, `c_moda`, `u_admin` …).
- **Para:** `*_minor` INTEGER, **kuruş**, **KDV dahil**. `tax_minor` toplamın *içindeki* KDV'dir, toplama tekrar eklenmez.
- **Zaman:** UTC ISO-8601 milisaniyeli metin (`strftime('%Y-%m-%dT%H:%M:%fZ','now')` / `new Date().toISOString()`). Gösterim `Europe/Istanbul`.
- **Boolean:** `0/1` INTEGER. **JSON:** yalnız snapshot/ayar/olay yükü (`json_valid` CHECK).
- **Atomiklik:** D1'de `BEGIN/COMMIT` yok. Çok adımlı yazmalar tek `db.batch([...])` içindedir; bir trigger `RAISE(ABORT, 'kod')` attığında batch'in tamamı geri alınır. Durum geçişleri `UPDATE … WHERE status = <beklenen>` ile korunur, ilk ifadenin `changes = 1` olması kontrol edilir (yarış koşulu → 409).
- **Silme yerine durum:** sipariş/ödeme/defter kayıtları silinmez. Ürün → `archived`, varyant → `is_active = 0`, kullanıcı → `anonymized`. Append-only tablolar trigger ile korunur.
- **updated_at** uygulama tarafından yazılır (trigger yok).

## 2. Tablo grupları (schema.sql bölümleri)

| # | Grup | Tablolar (özet) | Uygulamada kullanım |
|---|---|---|---|
| 1 | Kimlik & erişim | `users`, `customer_profiles`, `staff_profiles`, `roles`, `permissions`, `user_roles`, `role_permissions`, `auth_credentials`, `sessions`, `verification_tokens`, `user_consents`, `addresses` | Giriş (bcrypt), oturum (token HMAC'i saklanır), RBAC, checkout rızası |
| 2 | Katalog & stok | `media_assets`, `brands`, `categories`, `suppliers`, `products`, `product_categories`, `product_variants`, `product_media`, `attribute_definitions`, `attribute_options`, `category_attributes`, `product_variant_axes`, `product_attribute_values`, `variant_options`, `supplier_variants`, `price_lists`, `variant_prices`, `warehouses`, `inventory_balances`, `inventory_movements`, `stock_reservations`, `product_relations` | Admin kategori/marka/ürün CRUD, vitrin listeleme/filtre, stok |
| 3 | İçerik & vitrin | `navigation_menus/items`, `story_collections`, `stories`, `story_frames`, `sliders`, `slides`, `home_sections`, `home_section_products`, `content_pages`, `seo_documents`, `site_settings` | Header/footer, ana sayfa, ürün SEO (admin ürün editörü) |
| 4 | Kampanya & kupon | `campaigns`, `campaign_products/brands/categories`, `campaign_reward_products`, `coupons`, `coupon_redemptions`, `campaign_allocations` | Fiyat motoru (`pricing.ts`); admin ekranı yok |
| 5 | Sepet & sipariş | `carts`, `cart_items`, `cart_coupons`, `checkout_sessions`, `orders`, `order_addresses`, `order_items`, `order_adjustments`, `order_events` | Checkout, admin sipariş yönetimi |
| 6 | Ödeme & lojistik | `payment_configs`, `bank_accounts`, `payments`, `payment_events`, `bank_transfers`, `refunds`, `integrations`, `integration_secrets`, `shipping_methods`, `shipments`, `shipment_items`, `shipment_events` | iyzico/havale, iade, kargo, webhook |
| 7 | Etkileşim & operasyon | `wishlists(_items)`, `recent_views`, `reviews`, `comparison_sessions/items`, `external_search_jobs`, `external_offers`, `idempotency_keys`, `outbox_events`, `audit_logs`, `rate_limit_buckets` | Idempotency, outbox worker, audit, rate limit (diğerlerinin UI'ı yok) |

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

Önemli CHECK'ler: `orders.total = subtotal - discount + shipping`, `order_items.subtotal = qty × unit`, `variant_prices.compare_at > unit_price`, `bank_transfers` `matched` ise `received = expected` + onaylayan + zaman, `carts` sahibi user **xor** guest, `inventory_balances.on_hand ≥ reserved ≥ 0`, slug'lar `[a-z0-9-]`.

### Servis katmanı (src/server/services) — DB'nin bilmediği kurallar
- SKU ve barkod katalog genelinde benzersiz (payload içinde + diğer ürünler); varyant kombinasyonu ürün içinde benzersiz; eksensiz ürün tek varyant.
- **Satılmış/hareketli varyant** (sipariş satırı, stok hareketi veya rezervasyonu olan) SKU/kombinasyon değiştiremez; kaldırılırsa silinmez, `is_active = 0` olur.
- Ürün: en az 1 kategori; `published` için en az 1 görsel ve `catalog.publish` izni; kategorinin (üst kategoriler dahil) `category_attributes.is_required` özellikleri dolu olmalı (varyant ekseni olarak seçilmişse sağlanmış sayılır).
- Stok, rezerve miktarın altına inemez; her stok değişikliği aynı batch'te `inventory_movements`'a yazılır.
- Kargo: gönderilen adet ≤ sipariş adedi (kısmi gönderim destekli).
- İade: toplam iade (requested + processing + succeeded) ≤ tahsil edilen; stoğa geri alma ≤ sipariş adedi − önceden geri alınan.
- Havale onayı: gelen ≠ beklenen → `mismatch`, sipariş ödendi **yapılmaz**; rezervasyon süresi dolmuşsa onay reddedilir.
- Kategori/marka silme: alt kategorisi/ürünü olan kategori, ürünü veya hikayesi olan marka silinmez (`stories.brand_id` CASCADE olduğu için servis engeller).
- Yüklenen medya, artık hiçbir `categories / brands / product_media` satırı göstermiyorsa DB'den ve R2'den silinir; seed/demo medyaya dokunulmaz.

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

## 5. Uygulamanın kullandığı sözlükler

| Alan | Değerler |
|---|---|
| `order_events.event_type` | `placed`, `payment_captured`, `payment_mismatch`, `status_changed`, `shipment_created`, `delivered`, `cancelled`, `refund_requested`, `refunded`, `refund_failed`, `note` (from/to_status yalnız durum değişiminde dolu) |
| `inventory_movements.kind` / `reference_type` | `receipt` (ilk stok, ref `product`), `adjustment` (panel, ref `product`), `reserve` (checkout, ref `order`), `commit` (ödeme), `release` (iptal/expire, ref `order`/`checkout`), `return` (iade stoğa alma, ref **`order_item`** — kalem bazlı iade sayımı bu satırlardan yapılır) |
| `outbox_events.event_type` → payload | `order.placed {orderNumber,paymentMethod}`, `order.paid {}`, `order.shipped {shipmentId,trackingNumber}`, `order.delivered {}`, `order.cancelled {reason}`, `refund.process {refundId,orderId}`, `refund.succeeded {refundId,amountMinor,full}`; `dedupe_key = "<tip>:<id>"` |
| `idempotency_keys.scope` | `checkout.confirm`, `order.action:<orderId>`, `order.bulk` (24 saat) |
| `rate_limit_buckets.bucket_key` | `login-fail:<ipHash>`, `storefront-login-fail:…`, `admin-login-fail:…`, `coupon-fail:…` (dakikada 5 hata), `iyzico-callback:…` (dakikada 30 istek), `iyzico-webhook:…` (dakikada 300 istek) |
| `audit_logs.action` | `category.create/update/delete`, `brand.*`, `product.*`, `media.upload`, `order.<action>`, `order.bulk.<action>` |
| `media_assets` (yüklenen) | `storage_key = "<klasör>/<uuid>.<png|jpg|webp|avif>"`, klasör ∈ `categories · brands · products`; `public_url = "/assets/<storage_key>"` (R2'den sunulur); `alt_text` = orijinal dosya adı; `sha256`, `width/height` dolu |
| `integration_secrets.secret_name` | iyzico (`payment_config_id`): `api_key`, `secret_key`; kargo (`integration_id`): `webhook_secret`. AES-256-GCM, anahtar `SECRETS_MASTER_KEY` |
| `site_settings.key` | `site.name`, `site.tagline`, `site.announcement`, `contact.email`, `contact.phone`, `seo.default_*`, `checkout.reservation_minutes`, `checkout.bank_transfer_hours`, `shipping.free_above_minor` |
| `price_lists` / `warehouses` | Uygulama yalnız `pl_retail` (TRY) ve `wh_main` kullanır (sabit) |

## 6. Seed içeriği

- **Roller → izinler:** `admin` (14 iznin tamamı) · `catalog_manager` (catalog.read, catalog.write, storefront.write — **catalog.publish yok**) · `order_manager` (orders.read, orders.write, payments.reconcile, customers.read) · `marketing_manager` (catalog.read, storefront.write, campaigns.write) · `customer` (yok).
- **İzinler:** catalog.read/write/publish, orders.read/write, payments.reconcile, payments.secrets, storefront.write, campaigns.write, integrations.write, users.manage, audit.read, settings.write, customers.read.
- **Demo kullanıcılar:** `admin@nova.local` (u_admin, admin) ve `musteri@nova.local` (u_customer). Parola hash'leri demo amaçlıdır ve parola **dokümante edilmemiştir** → local'de kendi admininizi oluşturun: `npm run admin:create:local -- siz@ornek.com "Ad Soyad"` (var olan e-postada parolayı sıfırlar). **Canlı D1'de bu demo kullanıcıları silin veya parolalarını değiştirin.**
- **Katalog:** 5 marka, 9 kategori (Moda › Erkek › Kazak; Moda zorunlu özellik: renk + beden), 5 ürün (triko 3 varyant renk×beden, diğerleri tek varyant), fiyatlar, `wh_main` stokları, demo SVG görseller (`/public/demo`).
- **Demo sipariş:** `NOVA-2026-0001` (havale bekliyor, banka hesabı `ba_demo_1`, bir kargo kaydı); `pc_bank` ve `pc_iyzico_sbx` **pasif**, iyzico sırları yok. Kampanya `cmp_3al2` (mutfak 3 al 2 öde) pasif, kupon `NOVA3AL2ODE`.
- `tests/integration/services.test.ts` seed'in işlem verisini (sipariş, sepet, kullanıcı) test başında temizler; katalog seed'ine güvenir.

## 7. Şema değişikliği prosedürü (migration sistemi yok!)

1. `schema.sql` içinde ilgili tabloyu/indeksi/trigger'ı değiştir (bölüm başlıklarına uy, STRICT + CHECK ekle).
2. **Var olan veritabanı için:** `CREATE TABLE IF NOT EXISTS` mevcut tabloya kolon **eklemez**. Ya `ALTER TABLE … ADD COLUMN …` komutunu ayrıca çalıştır (`db:query[:local]`), ya da local'de `npm run db:reset:local`. Remote'ta reset veri siler.
3. Yeni tablo eklediysen `drop_all.sql` (FK sırası: önce çocuklar) ve `tests/test_schema.py` içindeki tablo sayısını güncelle.
4. Trigger'lar her çalıştırmada drop + create edildiğinden değişiklikleri yeniden `db:schema:*` ile uygulanır.
5. `npm test` (40 şema + 23 servis testi) yeşil olmalı. Seed'e eklenen veri `INSERT OR IGNORE` olmalı.
6. SQLite sürüm farkı: SQLite ≥ 3.51, ilişkili alt sorgunun **ORDER BY**'ında dış tablo kolonuna izin vermez (`no such column`). Dış referansı yalnız `WHERE`'de kullan (örnek: `pricing.ts` `image_url` için `COALESCE(alt sorgu1, alt sorgu2)`).

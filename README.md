# nova. — E-ticaret (Next.js 16 + Tailwind 4 + Cloudflare D1)

Mağaza vitrini + yönetim paneli. Kaynak şartname: `docs/E_Ticaret_Devir_Dosyasi.pdf` (R01–R24).
Kod İngilizce, arayüz Türkçe. Para birimi TRY, tutarlar **kuruş cinsinden INTEGER** ve KDV dahil.

## Hızlı başlangıç

```bash
# 0) Node 22.13+ ve bir Cloudflare hesabı gerekli
npm install                      # package.json'daki "latest" ve ^ aralıkları kurulumda en güncel sürüme çözülür
# .env  -> remote/prod değerleri
# .env.local -> local geliştirme değerleri
npm run db:create                # D1 oluşturur → çıkan database_id'yi .env'e CLOUDFLARE_D1_DATABASE_ID olarak yaz
npm run db:schema:local          # local SQLite D1 şemasını kurar
npm run db:seed:local            # local SQLite D1 demo verisini yükler
npm run db:schema:remote         # db/schema.sql → 87 tablo, 47 indeks, 23 trigger (tek script)
npm run db:seed:remote           # roller/izinler + demo katalog
npm run admin:create -- admin@ornek.com "Ad Soyad"   # parolayı terminalden sorar
cp .dev.vars.example .dev.vars   # SESSION_SECRET, SECRETS_MASTER_KEY, CRON_SECRET üret
npm run dev                      # http://localhost:3000  ·  panel: /admin
```

Güncel sürümlere toplu yükseltme: `npm run deps:latest`.

## Ortam: local SQLite ve remote D1 ayrıdır

- **`.env` tek doğruluk kaynağıdır.** `scripts/sync-wrangler.mjs`, `.env` içindeki moda göre (`D1_MODE=local|remote`) `wrangler.jsonc` içindeki `database_name`, `database_id` ve `remote` alanlarını günceller.
- Varsayılan geliştirme akışı `D1_MODE=local` ile **local SQLite-backed D1** kullanır.
- `D1_MODE=remote` ile aynı kod Cloudflare remote D1'e bağlanır.
- `npm run preview`, `npm run deploy`, `npm run upload` komutları remote modu zorlar.
- Localde başlamak için: `npm run db:schema:local && npm run db:seed:local && npm run dev`.
- Çalışma zamanı sırları: localde `.dev.vars`, canlıda `npx wrangler secret put SESSION_SECRET` (ve diğerleri).

## Canlıya alma

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SECRETS_MASTER_KEY
npx wrangler secret put CRON_SECRET
# wrangler.jsonc → vars.PUBLIC_SITE_URL'yi gerçek alan adıyla değiştir
npm run deploy
```

## Klasör yapısı

```
db/schema.sql            Tek DDL script (87 STRICT tablo, indeksler, trigger'lar) — D1 uyumlu, tekrar çalıştırılabilir
db/seed.sql              Roller, izinler, demo katalog (sır/IBAN yok)
db/drop_all.sql          FK sırasına göre tüm tabloları siler (db:reset:remote)
db/tests/test_schema.py  40 şema testi (python3, bağımlılıksız)
tests/integration/       21 servis testi: gerçek servis kodu + şema, node:sqlite üzerinde
scripts/                 .env okuma, wrangler senkronu, D1 komutları, admin oluşturma
src/server/              Sadece sunucu: D1 erişimi, auth/RBAC, güvenlik, servisler
src/app/(storefront)/    Vitrin (header/footer SSR, ana sayfa orta alanı client-side)
src/app/(admin)/admin/   Yönetim paneli (sunucuda yetki kontrolü)
src/components/admin/    Admin panel UI primitive'leri ve dataview component'leri
src/app/api/             Route handler'lar ({data, meta, requestId} sözleşmesi)
```

## Auth yüzeyi ayrımı

- **Storefront auth:** `/giris`, `/hesabim`, `/api/storefront/auth/login`, `/api/storefront/auth/logout`
- **Admin auth:** `/admin/giris`, `/admin/profil`, `/api/admin/auth/login`, `/api/admin/auth/logout`
- Admin paneli yalnızca admin oturum çereziyle (`__Host-nova_admin_session`) açılır; mağaza oturumu ayrıdır.
- Geriye uyumluluk için `/api/auth/login|logout` storefront auth'a yönlendirilmiştir.

## Admin panel UI notu

- Admin panel ekranları Vuexy tarzı enterprise dataview yaklaşımıyla **özgün** olarak yeniden tasarlandı (semi-dark sidebar, sticky topbar, KPI kartları, gelişmiş sipariş listesi filtre/sıralama/kolon görünürlüğü).
- Admin login ekranı cover-layout olarak yenilendi (`/admin/giris`) ve admin logout aksiyonu üst barda `/api/admin/auth/logout` ile bağlandı.
- Sidebar ikonları için `lucide-react` eklendi; menü başlıkları gruplanıp (ANA/KATALOG/YÖNETİM) iç içe (nested) katalog menüsü oluşturuldu.
- Sipariş yönetimi için `/admin/siparisler` listesi ve `/admin/siparisler/[id]` detay sayfası eklendi; detay ekranı kalemler, adresler, ödeme/kargo hareketleri ve durum geçmişini gösterir.
- Dashboard (`/admin`) ve sipariş ekranları Vuexy benzeri kart + datatable düzeniyle yeniden şekillendirildi.
- Kategori yönetimi tamamlandı: `/admin/kategoriler` ağacı + create/update/delete CRUD, `/admin/kategoriler/[id]` detay sayfası ve `/api/admin/categories*` uçları.

## Mimari kararlar (şartnameye ek / farklar)

1. **SQLite → Cloudflare D1.** Şartnamedeki `BEGIN IMMEDIATE`, WAL, `busy_timeout`, `PRAGMA foreign_keys` D1'de geçerli değil. Bunların yerine:
   - Çok adımlı yazmalar `db.batch([...])` ile tek transaction'da (ilk hatada tamamı geri alınır).
   - Stok, kampanya kapasitesi, kupon limitleri **trigger** ile korunur; trigger `RAISE(ABORT, 'insufficient_stock')` attığında batch'in tamamı geri alınır. Son adet yarışında yalnız biri kazanır (testli).
   - D1 FK'leri varsayılan olarak zorlar.
2. **Ödeme ağ çağrısı transaction dışında.** Sipariş + rezervasyon + outbox önce commit edilir, sonra iyzico çağrılır.
3. **iyzico'da tarayıcı dönüşüne güvenilmez.** Callback ve webhook yalnızca hangi token'ın doğrulanacağını söyler; sonuç her zaman iyzico detail API'sinden okunup tutar/para birimi/basketId ile karşılaştırılır. Webhook tekrarları `payment_events UNIQUE(provider, provider_event_id)` ile tekilleştirilir.
4. **Fiyat her zaman sunucuda.** Quote hash'i saklanır; confirm'de yeniden hesaplanan quote farklıysa 409 döner.
5. **Idempotency-Key** checkout confirm'de zorunlu (aynı anahtar + farklı gövde → 409).
6. **Ürün detay sayfası SSR** (SEO + JSON-LD). Şartnamedeki "orta alan client-side" kuralı ana sayfaya uygulandı.
7. **Kimlik yalnız oturum çerezinden** (`__Host-` önekli, HttpOnly, Secure, SameSite=Lax); token'ın kendisi değil HMAC'i saklanır. Yazan uçlarda Origin kontrolü (CSRF).
8. **Oran sınırı D1 üzerinde** (login ve kupon: IP başına dakikada 5 başarısız deneme). Yüksek trafikte Cloudflare Rate Limiting binding'ine taşınabilir.
9. **Sırlar** `integration_secrets` tablosunda AES-256-GCM ile şifreli; ana anahtar Worker secret'ı.
10. **Tipler:** `@cloudflare/workers-types` global olarak eklenmedi (DOM lib ile çakışıyor); kullanılan D1 yüzeyi `cloudflare-env.d.ts` içinde tanımlı.

## Testler

```bash
npm run db:test         # 40/40 şema testi
npm run test:services   # 21/21 servis testi (katalog, filtre, sepet, 3 al 2 öde, kupon, checkout, ödeme, expire, RBAC...)
```

## Bu teslimde doğrulanan / doğrulanmayan

- ✅ Şema gerçek SQLite 3.53 ile kuruldu, seed + integrity/FK kontrolleri + 40 test geçti.
- ✅ Sunucu servisleri (TypeScript) Node üzerinde gerçek şemaya karşı 21 testten geçti.
- ⚠️ `npm install`, `tsc`, `next build` bu ortamda çalıştırılamadı (npm registry'ye erişim yoktu). İlk kurulumda `npm run typecheck && npm run build` çalıştırıp çıkan hataları düzeltin.
- ⚠️ D1'e gerçek bağlantı ve iyzico sandbox uçtan uca denenmedi.

## Yol haritası (bilerek eksik bırakılanlar)

- Admin CRUD ekranları: ürün/varyant, kategori, marka, kampanya, vitrin, ödeme/IBAN, entegrasyon, kullanıcı/rol, ayarlar (veri modeli hazır; panelde yer tutucu sayfalar var). Sipariş grid'i ve gösterge paneli çalışıyor.
- Havale mutabakat ekranı (`POST /api/admin/bank-transfers/:id/reconcile` → `markPaymentPaid`).
- Admin MFA (TOTP) akışı — altyapı alanları var, `ADMIN_MFA_ENFORCED` şimdilik `false`.
- iyzico webhook V3 imza doğrulaması (şu an güven kaynağı API ile yeniden doğrulama).
- "X al Y bedava" hediye satırının otomatik eklenmesi (hesap motoru hazır, hediye SKU rezervasyonu eksik).
- Zamanlanmış iş: `/api/cron/expire` uç noktası hazır; her 5 dk çağıracak bir Cron Trigger worker'ı veya dış zamanlayıcı bağlanmalı.
- Outbox worker'ı (e-posta/SMS/kargo), kargo ve SMS adaptörleri, dış fiyat arama sağlayıcısı.
- Üye kaydı, parola sıfırlama, hesabım sipariş geçmişi/favoriler/karşılaştırma/yorum modülleri.
- Yasal metinler (KVKK, mesafeli satış, ön bilgilendirme), gerçek vergi/kargo oranları, TCKN toplama kararı.
- Görsel optimizasyonu (Cloudflare Images) ve R2 tabanlı ISR cache.

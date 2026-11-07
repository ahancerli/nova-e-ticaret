# nova. — E-ticaret vitrini + yönetim paneli

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Cloudflare Workers (OpenNext) · Cloudflare D1 (SQLite) · R2.
Tek satıcılı mağaza: müşteri vitrini (`/`) ve yönetim paneli (`/admin`) aynı uygulamada.
**Kod İngilizce, arayüz Türkçe.** Para birimi TRY; tutarlar **kuruş cinsinden INTEGER ve KDV dahil**.

> **Yeni oturum / devir için okuma sırası:** bu dosya → [`db/README.md`](db/README.md) (veri kuralları, durumlar, sözlükler) → `db/schema.sql`.
> Kaynak şartname: `docs/E_Ticaret_Devir_Dosyasi.pdf` (gereksinimler R01–R24). Kod yazmadan önce `AGENTS.md`'ye uyun:
> bu Next.js sürümü eğitim verisinden farklı olabilir, ilgili rehber `node_modules/next/dist/docs/` altında.

---

## 1. Hızlı başlangıç (local)

```bash
nvm use 25                       # Node ≥ 22.13 zorunlu (v18 / v22.9 → tsc/next/servis testleri bozulur)
npm install
npm run db:schema:local          # local SQLite-D1: 95 tablo · 60 indeks · 25 trigger (tekrar çalıştırılabilir: yeni tablolar + firma kataloğu)
npm run db:seed:local            # roller/izinler + demo katalog + demo sipariş
npm run admin:create:local -- siz@ornek.com "Ad Soyad"   # panel kullanıcısı (parolayı terminal sorar, ≥12 karakter)
npm run dev                      # http://localhost:3000 · panel: /admin (giriş: /admin/giris)
```

Seed'deki `admin@nova.local` kullanıcısının parolası dokümante değildir; local'de daima `admin:create:local` kullanın.
`.env.local` local çalışma için gerekli sırları zaten içerir (`SESSION_SECRET`, `SECRETS_MASTER_KEY`, `CRON_SECRET`); local R2 için ek kurulum yoktur.

### Komutlar
| Komut | İş |
|---|---|
| `npm run dev` / `dev:remote` | Local D1 (varsayılan) / Cloudflare D1'e bağlı geliştirme |
| `npm run typecheck` · `npm run lint` | `tsc --noEmit` · ESLint |
| `npm test` | `db:test` (49 şema, python3) + `test:core` (14) + `test:catalog` (18) + `test:identity` (9) + `test:storefront` (23: fiyat motoru aşamaları, kademe, çapraz indirim, kilit, strateji, kupon hariç tutma, ilk sipariş, taban fiyat, üst sınır, rozetler) + `test:orders` (8) + `test:integrations` (6: kart ödemesi, outbox, kargo webhook) + `test:reporting` (8: dönem sınırları, KPI, gösterge paneli) + `test:content` (12: site ayarları, içerik sayfaları, yasal metinler) + `test:accounts` (11: davet, parola bağlantıları, roller, üyelik, müşteriler) + `test:campaigns` (10) + `test:showcase` (5) + `test:audit` (14: etiketler, alanlar, filtreler, maskeleme, append-only) + `test:ai` (11: şifreli anahtar, sağlayıcı değişimi, ürün içeriği, HTTP istemcileri — gerçek sağlayıcı çağrılmaz) + `test:providers` (18: telefon/şablon kuralları, Netgsm ve Yurtiçi adaptörleri, katalog ↔ adaptör, SMS bildirimi, kargo kaydı ve takip — firma çağrılmaz) + `test:payments` (12: IBAN, şifreli iyzico anahtarları, tek aktif ortam, havale/hesap korumaları, vitrin seçenekleri — iyzico çağrılmaz) + `test:bulk` (16: güvenli XML, .xlsx okuma/yazma, para biçimleri, akış analizi, Excel içe aktarma ve XML/REST senkronu gerçek katalog use case'leriyle, SSRF) + `test:services` (23 uçtan uca senaryo) — Node ≥ 22.13 |
| `npm run test:e2e` | Playwright tarayıcı testleri (15): ayrı bir local veritabanı kurar, `next dev`'i 3210 portunda açar, Chromium'da çalıştırır |
| `npm run db:{schema,seed,reset}:{local,remote}` | Şema / seed / sil-kur-seed |
| `npm run db:query[:local] -- "SQL"` | Tek SQL (remote varsayılan, `:local` ile local) |
| `npm run admin:create[:local] -- email "Ad"` | Admin oluştur / parolasını sıfırla (remote / local) |
| `npm run r2:create` | Canlı R2 bucket'ı (`nova-assets`) bir kez oluştur |
| `npm run preview` / `deploy` / `upload` | OpenNext build + Cloudflare (remote modu zorlar) |
| `npm run deps:latest` | Bağımlılıkları en güncele yükselt (dikkatli) |

## 2. Ortamlar ve yapılandırma

| Dosya | Amaç |
|---|---|
| `.env` | **Remote** (Cloudflare hesap/token, remote D1 adı/ID). Git'e girmez. |
| `.env.local` | **Local** (local D1 adı/ID, `APP_ENV`, local sırlar). Git'e girmez. |
| `.dev.vars.example` | `wrangler dev` sırlarının şablonu |
| `wrangler.jsonc` | Worker, `DB` (D1) ve `ASSETS_BUCKET` (R2) binding'leri. D1 `database_name/id/remote` alanları **elle düzenlenmez**: `scripts/sync-wrangler.mjs` her `dev/preview/deploy` öncesi `.env*`'den yazar. |
| `cloudflare-env.d.ts` | Kullanılan D1/R2/Fetcher yüzeyinin elle yazılmış tipleri (`@cloudflare/workers-types` DOM ile çakıştığı için global eklenmedi) |

Local'de `next dev`, `initOpenNextCloudflareForDev()` ile wrangler binding'lerini kullanır: D1 → `.wrangler/state/v3/d1/…sqlite`, R2 → `.wrangler/state/v3/r2`. **Binding değişince dev sunucusu yeniden başlatılmalı.**

**Canlıya alma:**
```bash
npx wrangler secret put SESSION_SECRET      # 32+ bayt rastgele, base64
npx wrangler secret put SECRETS_MASTER_KEY  # 32 bayt, base64 (AES-256-GCM, integration_secrets)
npx wrangler secret put CRON_SECRET
npm run db:create && npm run db:schema:remote && npm run db:seed:remote   # ilk kurulum
npm run r2:create
# wrangler.jsonc → vars.PUBLIC_SITE_URL gerçek alan adı · demo kullanıcıları sil/parolasını değiştir
npm run deploy
```
Zamanlanmış işler (OpenNext worker'ı `scheduled` olayını dışa aktarmaz → ayrı Cron Trigger worker'ı veya dış zamanlayıcı):
`POST /api/cron/outbox` her **1 dk**, `POST /api/cron/expire` her **5 dk**, `POST /api/cron/shipping-sync` her **15–30 dk** (kargo takibi), başlık `Authorization: Bearer $CRON_SECRET`.
`POST /api/cron/integrations` her **1 dk** (katalog değişikliklerini kuyruğa aktarır, pazaryeri görevlerini kendi aralıklarında çalıştırır, çekilen siparişleri içe alır; 25 sn bütçe).

**Entegrasyon kuyruğu (Kafka):** varsayılan `INTEGRATION_BUS=database` (D1 tabloları, ek kurulum yok). Kafka için Workers TCP konuşamadığından **Kafka REST Proxy v2** gerekir (Confluent REST Proxy, Redpanda HTTP Proxy `:8082`, Aiven Karapace): `INTEGRATION_BUS=kafka`, `KAFKA_REST_URL` (canlıda herkese açık **HTTPS**), `KAFKA_REST_USERNAME` / `KAFKA_REST_PASSWORD` (Basic, opsiyonel), `KAFKA_TOPIC_PREFIX` (varsayılan `nova`). Topic'ler: `<prefix>.catalog.product-info`, `.catalog.stock`, `.catalog.price`, `.catalog.images`, `<prefix>.marketplace.orders` (auto-create kapalıysa elle açın). Durum: Entegrasyonlar › Pazaryerleri › bağlantı › Genel › Kuyruk.

## 3. Klasör yapısı

```
db/                       Şema, seed, drop, şema testleri — ayrıntı: db/README.md
docs/                     Kaynak şartname (PDF)
scripts/                  env okuma, wrangler senkronu, d1/r2 sarmalayıcıları, admin oluşturma
public/demo/              Seed görselleri (SVG)
tests/unit/               Çekirdek (src/core) birim testleri
tests/integration/        Servis testleri: gerçek servis kodu + schema/seed, node:sqlite üzerinde D1 taklidi
src/
  app/
    (storefront)/         Vitrin sayfaları — ince route dosyaları, içerik `features/shop`'tan (header/footer/ana sayfa SSR)
    (admin)/admin/        Panel sayfaları + layout (AdminShell) + template (sayfa geçiş animasyonu) + loading.tsx'ler
    (admin-auth)/admin/giris   Panel giriş sayfası (kabuk dışında)
    (admin-print)/admin/yazdir Yazdırılabilir belgeler (kabuk dışında)
    api/                  Route handler'lar ({data, meta, requestId} sözleşmesi)
    assets/[...path]/     R2'deki yüklenmiş görselleri sunar
  components/             Paylaşılan UI (iş bilgisi yok)
    ui/                   DataGrid, Toaster, Popover, Collapsible, Portal, ErrorState, ErrorBoundary, RouteError, ClientErrorReporter
    admin/                Panel tasarım sistemi: ui (kart, rozet, tablo), AdminDrawer, AdminConfirmDialog, AdminFormDialog, Skeleton
  features/               Domain'e göre frontend (ayrıntı §4.3); her feature kendi api.ts'i ile konuşur
    admin-shell/          AdminShell, AdminSidebar, CommandPalette, TopProgress
    auth/                 LoginForm + api (giriş/çıkış)
    catalog/              categories/ · brands/ · products/ (ProductEditor + editor/ bölümleri)
    media/                ImageUpload, MediaGallery + api (yükleme)
    orders/               OrdersManager, OrderDetailView (+ detail/), PrintToolbar
    audit/                AuditLogViewer (sekmeler, filtreler, sunucu taraflı grid) + AuditDetailDrawer
    integrations/         AiIntegrationManager (tek AI sağlayıcısı), IntegrationPlaceholder (SMS, kargo şablonu)
    shop/                 Vitrin mikrofrontend'i (§4.3): layout/ (SSR header, mega menü, footer) · home/ · listing/ · product/ · ui/ (ortak kart, fiyat, grid, ray) · data/ (GraphQL istemcisi)
    cart/ checkout/       Sepet çekmecesi, ödeme
  server/graphql/         Salt okunur vitrin grafı: şema + resolver'lar (storefront sorgularını çağırır), çalıştırıcı (derinlik/token sınırı)
  core/                   Çatıdan bağımsız temel (ayrıntı §4.1): errors, di, db, logging, runtime, http, security (crypto, HTML sanitizer)
  modules/                İş modülleri (ayrıntı §4.2): platform (CSRF, rate limit, idempotency), identity (giriş, oturum, RBAC), audit (yazma portu + denetim kaydı görüntüleyici), media,
                          catalog (admin: kategori, marka, ürün), storefront (vitrin okuma), pricing (fiyat motoru), cart (sepet, kupon),
                          checkout (teklif, sipariş, ödeme sonuçlandırma, süre aşımı), orders (sipariş ekranları, durum makinesi, iade),
                          reporting (gösterge paneli: dönem, KPI, salt okunur), settings (site ayarları kaydı), content (sayfalar, yasal metinler,
                          footer/checkout bağlantıları), staff (panel kullanıcıları, davet, roller), customers (üyeler, üye olma),
                          campaigns (kampanya kuralları, kapsam, kuponlar), mail (SMTP hesabı, şifreli parola, MailSender portu → parola sıfırlama e-postası), ai (tek AI sağlayıcısı: OpenAI / Gemini / Claude, “AI ile ürün ekle”; sistem promptları `ai/prompts/system-prompts.ts`), showcase (ana sayfa bölümleri, slider, hikayeler), payments (iyzico gateway), shipping (kargo adaptörleri + webhook), outbox (worker + işleyici kaydı), notifications
  lib/                    İstemci+sunucu ortak: api-client, use-field-errors, error-reporting, toast, motion, money, slug, safe-redirect, ids, types, order-rules, product-rules
  proxy.ts                Sayfa CSP'si (istek başına script nonce)
  server/                 Yalnız sunucu ("server-only"): app.ts = composition root (DI kayıtları, `route`, `resolveService`, `currentPrincipal`, `requireAdminPage`); env.ts = Worker binding + local .env
```

## 4. Mimari kurallar (tüm yeni kod bunlara uyar)

1. **Veri erişimi yalnız sunucuda** (`src/server`, `import "server-only"`). Parametreli sorgu (`?`); sıralama/kolon adları allowlist'ten. D1 sınırı: ifade başına ≤ 100 parametre → `IN` listeleri 80'lik parçalara bölünür (`placeholders()`).
2. **Atomiklik:** çok adımlı yazma = tek `UnitOfWork` (D1 batch). Durum geçişleri `WHERE status = <beklenen>` + `uow.expectChanges(1, () => new ConflictError(…))`: koşul tutmazsa **batch'in tamamı veritabanında geri alınır** (`batch_guards` trigger'ı). Bir batch'te birden çok guard olabilir; hangisi tetiklenirse onun hatası atılır. Batch bittikten sonra `changes` kontrol etmek yetersizdir (diğer ifadeler yazılmış olur). Sınır kontrolleri de (iade toplamı ≤ tahsilat, gönderilen ≤ sipariş adedi, stoğa alınan ≤ satılan) `INSERT … SELECT … WHERE <koşul>` + guard ile batch içinde yapılır. Dış ağ çağrıları (iyzico, kargo) **batch dışında**, mümkünse outbox üzerinden.
3. **API sözleşmesi:** başarı `{data, meta, requestId}`, hata `{error:{code,message,fieldErrors}, requestId}`. Bütün JSON route'lar `route({...})` ile yazılır (§4.1); yalnız yönlendirme dönen iyzico callback'i, sağlayıcıya özel yanıt dönen iyzico webhook'u ve görsel akışı yapan `/assets` düz route'tur (aynı modülleri kullanır). Hatalar `AppError` alt sınıflarıyla atılır; Zod ve DB trigger/constraint hataları `toAppError` ile tek yerde eşlenir (`src/core/errors/translate.ts`). 5xx'te istemci genel mesaj alır, ayrıntı `requestId` ile JSON log'a gider.
4. **Kimlik:** yalnız oturum çerezinden (`modules/identity`). Mağaza `__Host-nova_store_session` (`SameSite=Lax`, 7 gün), panel `__Host-nova_admin_session` (ayrı; `SameSite=Strict`, 8 saat). Token'ın kendisi değil HMAC'i saklanır; çıkış oturumu sunucuda iptal eder. Body'deki userId asla yetki değildir. Giriş sonrası işler (misafir sepeti birleştirme) `addLoginListener` ile bağlanır (Observer).
5. **Yetki:** API route'ları `route({ auth: { audience: "admin", permission: "<kod>" } })` (401/403), admin sayfaları `await requireAdminPage("<kod>")` (oturum yok → `/admin/giris`, yetki yok → `/admin/yetkisiz`). UI gizlemek yetki değildir. Nesne/durum kuralları use case'te ayrıca kontrol edilir (ör. sipariş işlemleri: her işlemin kendi izni, `assertActionAllowed`).
6. **CSRF:** `route()` yazan her uçta varsayılan olarak Origin/Referer + JSON içerik tipini doğrular (`SameOriginGuard`); yükleme uçları `csrf: "multipart"`, çerezsiz makine uçları (cron, kargo webhook) `csrf: "none"` + kendi doğrulamaları.
7. **Idempotency:** `Idempotency-Key` başlığı checkout confirm, sipariş işlemleri ve toplu işlemlerde zorunlu (`route({ idempotency })`, `D1IdempotencyStore`); aynı anahtar + farklı gövde → 409, tekrar → kayıtlı yanıt + `idempotent-replayed: true` başlığı.
8. **Fiyat her zaman sunucuda** (`modules/pricing`: `BuildQuote` veriyi yükler, saf `priceCart` hesaplar; her kampanya türü `CAMPAIGN_RULES`'ta bir Strategy — yeni tür = bir sınıf + bir satır + `campaigns/domain/campaign.ts` `CAMPAIGN_KINDS`'ta aşaması). Hesaplama sırası sabit: 1. ürün → 2. sepet → 3. kupon → 4. kargo; çakışmada mağaza kuralı (`pricing_policy`: öncelik / en yüksek indirim), birleşmeyen kampanya kullandığı birimleri kilitler; taban fiyat (`variant_prices.min_price_minor`) ve sepet başına azami indirim oranı her zaman korunur. Vitrin kartı / ürün sayfası rozetleri ve "Sepette ₺X" aynı motordan (`GetProductPromotions`) gelir. Quote hash'i saklanır, confirm'de farklıysa 409. Sepet yazmaları göreli (`quantity = quantity + n`, üst sınırlı) ve sürüm kontrolü batch içinde guard'lıdır.
9. **Validasyon:** tüm girdiler Zod 4 şemalarından geçer (`modules/<m>/http/schemas.ts`); Zod mesajları Türkçe (`modules/shared/schemas.ts`). Slug alanları serbest metin alır, servis `slugify` ile normalize eder (Türkçe karakter çevrilir: "Yaşam" → `yasam`).
10. **Audit:** admin yazma işlemleri `audit_logs`'a yazılır (sözlük: db/README.md §5). Modüllerde audit satırı, değişikliğin **aynı UnitOfWork'üne** `AuditLog.recordStatement()` ile eklenir (ya ikisi ya hiçbiri).
11. **Rate limit / kaba kuvvet:** login için IP başına dakikada 5 hata; ayrıca (hesap, IP) başına 15 dakikada 10 hata yalnız **o IP'yi o hesap için** kapatır — hesap global kilitlenmez (saldırgan admini dışarıda bırakamaz). Kupon: IP başına dakikada 5 hata. `?next=` yönlendirmeleri `safeInternalPath` (`lib/safe-redirect.ts`) ile süzülür.
12. **HTML:** admin'in yazdığı açıklamalar vitrinde `sanitizeRichHtml` (tokenizer tabanlı allowlist; yalnız `https://` veya site içi `/yol` bağlantıları) üzerinden geçer; kullanıcı içeriği asla HTML olarak basılmaz. Temizleyici `src/core/security/sanitize-html.ts`; yeni XSS bulgusu = `tests/integration/services.test.ts` içindeki payload listesine bir satır.
13. **Sırlar** `integration_secrets`'ta AES-256-GCM; ana anahtar Worker secret. Panel sırları geri göstermez. AI API anahtarı aynı zarfla `ai_integration` satırında (panel yalnız son 4 karakteri görür).
14. **CSP:** sayfa CSP'si `src/proxy.ts`'te her istekte üretilen **script nonce** ile kurulur (`'unsafe-inline'` script yok, `'strict-dynamic'`). Bu yüzden root layout `connection()` ile tüm sayfaları dinamik render eder. Inline `<script>` yazılmaz; gerekiyorsa `headers().get("x-nonce")` ile `nonce` verilir. API ve `public/demo` yanıtları `next.config.ts`'te `default-src 'none'` alır. Harici script/iframe eklemek = `src/proxy.ts`'te ilgili direktife kaynak eklemek.

### 4.1 Çekirdek (`src/core`) ve route yazımı

`src/core` hiçbir `src/server` / modül kodunu import etmez; uygulama ona `src/server/app.ts` (composition root) üzerinden bağlanır.

| Parça | Dosya | Ne için |
|---|---|---|
| Hata hiyerarşisi | `core/errors` | `AppError` → `BadRequest` 400 · `Unauthorized` 401 · `Forbidden` 403 · `NotFound` 404 · `Conflict` 409 · `PayloadTooLarge` 413 · `UnsupportedMediaType` 415 · `Validation` 422 · `RateLimit` 429 · `Internal` 500 · `ExternalService` 502. `code` sabit, `message` Türkçe kullanıcı metni, `details` yalnız log. Yeni trigger kodu = `translate.ts`'te bir satır |
| DI | `core/di/container.ts` | `token<T>()`, `singleton / scoped / transient`, istek başına `createScope()`, `provide()`. Döngü ve "singleton → scoped" (captive) bağımlılık hata verir |
| Veri | `core/db` | `Database` port'u (+ `D1DatabaseAdapter`), `UnitOfWork` (`add`, `expectChanges`, `commit`), `Repository` taban sınıfı, `placeholders`, `chunk` |
| Altyapı | `core/logging`, `core/runtime` | `JsonLogger` (hassas anahtarlar maskelenir, `child({requestId})`), `Clock` / `FixedClock`, `IdGenerator`, `buildConfig` (canlıda eksik sır → başlangıçta hata) |
| HTTP | `core/http` | `createRouter` → `route()`; port'lar: `Authenticator`, `OriginGuard`, `RateLimiter`, `IdempotencyStore` |

**Route tanımı** (sıra sabit: hata sınırı → rate limit → origin/CSRF → kimlik/yetki → params/query/body doğrulama → idempotency → handler):
```ts
export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },   // "public" | "storefront" (+ required) | "admin" (+ permission)
  params: z.object({ id: z.string() }),
  body: adminCategoryUpdateSchema,                            // multipart: body yok + csrf: "multipart"
  idempotency: { scope: ({ params }) => `category.update:${params.id}` },   // opsiyonel
  rateLimit: { name: "coupon", limit: 5, windowSec: 60 },     // opsiyonel
  handle: ({ params, body, user, resolve }) => resolve(UpdateCategoryToken).execute(params.id, body, user!),
});
```
Handler yalnız doğrulanmış girdi alır, use case'i DI'dan çözer; düz veri döner (200) veya `reply.created(data, meta)`. Yanıtlar `Cache-Control: no-store` (public: `no-cache`).

### 4.2 Modül yapısı (`src/modules/<modül>`)

```
domain/           Saf tipler ve kurallar (I/O yok): category.ts (buildTree, parentOptionsFor), errors.ts (hata kataloğu)
application/      Use case sınıfları — her işlem ayrı sınıf: ListCategoryTree, GetCategoryDetail, CreateCategory, UpdateCategory, DeleteCategory
                  ports.ts: ihtiyaç duyulan repository/servis arayüzleri (Dependency Inversion)
infrastructure/   Port gerçeklemeleri: D1CategoryRepository, R2ObjectStorage … (SQL yalnız burada)
http/             Zod girdi şemaları
module.ts         Token'lar + DI kayıtları (registerX)
index.ts          Modülün dışa açık yüzeyi — diğer kod yalnız buradan import eder
```

Kurallar: use case bağımlılıklarını constructor'dan alır, somut sınıf bilmez. Yazmalar `UnitOfWork` ile; durum/varlık koşulları `expectChanges` ile batch içinde korunur (ör. "alt kategori yoksa sil" → `DELETE … AND NOT EXISTS (…)` + guard). Dış etkiler (R2 silme) commit'ten sonra. Sorgular (Query) yokluğu `null` ile döner, route 404'e çevirir. Sayfalar (server component) use case'i `resolveService(Token)` ile çözer; yetkiyi sayfa kontrol eder. Modüller arası bağımlılık arayüz üzerinden (catalog → `MediaLibrary`).

### 4.3 Frontend ve hata yönetimi

- **Feature klasörü** (`src/features/<alan>`): ekran bileşenleri + `api.ts` (o alanın uçlarını tipli fonksiyonlar olarak toplar; istek/yanıt tipleri `import type` ile `@/modules/*`'tan gelir, sunucu kodu pakete girmez). Bileşenler ham URL / `fetch` yazmaz. Büyük ekranlar parçalanır: `catalog/products/editor/*` (form modeli, doğrulama, alanlar, her bölüm ayrı dosya), `orders/detail/*` (biçimlendirme, ilerleme, kargo çekmecesi, iade diyaloğu, kart parçaları).
- **API istemcisi** (`lib/api-client.ts`): her hata tek tip `ClientApiError` olur — HTTP, ağ (`network_error`), zaman aşımı (`timeout`, varsayılan 20 sn), iptal, JSON olmayan yanıt. Yardımcılar: `isValidation`, `isConflict`, `isUnauthorized`, `isRateLimited`, `isServer`… `errorMessage(err)` 5xx'te kısa bir `Ref` (requestId başı) ekler. 401 → `nova:unauthorized` olayı → panel kabuğu "oturum süresi doldu" uyarısı + `/admin/giris?next=<sayfa>`.
- **Form hataları:** `useFieldErrors()` (`lib/use-field-errors.ts`) — `fromError(err)` sunucunun `fieldErrors`'ını alır, `get("a.b")` alanın ilk mesajını verir; istemci doğrulaması aynı anahtarları kullanır.
- **Hata sınırları:** her route grubunda `error.tsx` (vitrin, panel — kabuk içinde, yazdırma, giriş) + kök `error.tsx` + `global-error.tsx` (kök layout çökerse; kendi `<html>`'i, satır içi stil). Panelde `not-found.tsx` kabuk içinde. Sunucu hata metni kullanıcıya **hiç** gösterilmez; Next'in `digest`'i "Ref" olarak gösterilir ve sunucu log satırıyla eşleşir. Tek widget'ı izole etmek için `<ErrorBoundary name="…">` (ana sayfa bölümleri bununla sarılı: bozuk bir bölüm gizlenir, sayfa ayakta kalır).
- **İstemci hata raporu:** `reportClientError()` (`lib/error-reporting.ts`) → `POST /api/client-errors` (aynı köken, ≤ 8 KB, IP başına dakikada 30, DB'ye yazmaz) → sunucu JSON log'u (`message: "client error"`). Sınırlar, `ClientErrorReporter` (yakalanmamış hata / promise reddi; API hataları hariç) ve sayfa başına en fazla 10 rapor.
- **Vitrin mikrofrontend'i** (`src/features/shop`): `(storefront)` route'ları yalnız `@/features/shop` index'inden (sunucu girişi) import eder; shop içindeki istemci dosyaları göreli yol kullanır. Header, mega menü (yalnız CSS hover/focus — JS'siz çalışır), footer ve ana sayfa **SSR**; etkileşimli parçalar küçük istemci adacıkları (sepete ekle, ray kaydırma, slider, arama önerisi, mobil menü). Ürün kartı tek yerde (`ui/ProductCard`): ana sayfa rayları, listeleme, arama ve benzer ürünler aynı bileşeni kullanır. Renkler `globals.css` `@theme` token'larından (`brand` = Site ayarları vurgu rengi).
- **GraphQL (hibrit):** SSR sayfalar servisleri doğrudan çağırır (parse/validate maliyeti yok). İstemci tarafı okuma `POST /api/graphql` ile tek istekte yapılır: listeleme (ürünler + facet'ler), arama önerisi. Graf **salt okunur**; yazmalar REST'te kalır (CSRF / idempotency / sürüm kontrolü). Uç `route()` içinde çalışır: aynı CSRF, Zod gövde (≤ 8 KB sorgu), `{data, meta, requestId}` zarfı; ilk resolver hatası kendi `AppError`'ı olarak döner (GraphQL'in kısmi `errors` dizisi yok). Sınırlar: 6 seviye derinlik, 1500 token, canlıda introspection kapalı. Listeleme ilk sayfayı SSR alır; filtre/sıralama/sayfa `window.history.pushState` ile URL'e yazılır (sunucu round-trip'i yok) ve tek GraphQL isteğiyle yenilenir. Yeni alan = `schema.ts`'te SDL + `rootValue` satırı + `features/shop/data/graph.ts`'te sorgu.
- **Log bütünlüğü:** `JsonLogger`'da `level/time/message` ve bağlam alanları (`requestId`, `route`) çağıranın alanlarından sonra yazılır; istemciden gelen bir alan bunları ezemez.

**Yeni modül eklemek:** klasörü kur → `module.ts`'te `registerX(c)` → `src/server/app.ts`'te `registerX(container)` → route dosyaları `route({...})` → `tests/integration/<modül>.test.ts` (container testte kurulur, yalnız dış servisler sahte).

## 5. Modül durumu

| Alan | Durum |
|---|---|
| **Vitrin** (`features/shop`) | SSR header (duyuru + yardımcı linkler, logo, canlı öneri veren arama, hesap menüsü, sepet) + kategori çubuğu ve **mega menü** (alt kategoriler sütun, torunlar link, kategori/menü görselleri) + mobilde kademeli kategori menüsü; SSR ana sayfa (hikaye şeridi, slider — ardından banner gelirse yan yana —, kategori kutuları, ürün rayı/ızgarası, banner, marka şeridi; bölümler panelden), SSR footer (link sütunları, sosyal medya, iletişim, güven rozetleri, firma bilgisi). Kategori/marka/arama/fırsat listeleme (ilk sayfa SSR, sonrası GraphQL) + facet filtreler (aynı attribute OR, farklı AND, varyant eksenleri aynı SKU'da), arama, ürün detayı (SSR + JSON-LD, varyant seçici), sağ sepet çekmecesi (yaylı kayma animasyonu, eklenen ürün vurgusu, “Sepete git”) → **sepet sayfası `/sepet`** (adet, kaldır, kupon, özet; mobilde yapışkan toplam çubuğu) → ödeme, kupon, misafir checkout (iyzico / havale), sipariş sonuç sayfası, mağaza girişi, basit hesabım |
| **Panel kabuğu** | Sidebar (yalnız seçili öğe mor, iç içe menü kayarak açılır, mobilde soldan drawer), üst bar (breadcrumb, ⌘K komut paleti, ortam rozeti, "Yeni" menüsü, bildirim paneli, kullanıcı menüsü/çıkış) |
| **Gösterge paneli** `/admin` | Dönem seçimi (`?donem=bugun\|7g\|30g\|90g`, İstanbul gün sınırları, önceki eşit dönemle "aynı saate kadar" karşılaştırma); bekleyen işler (havale onayı, hazırlanacak, kargoya verilecek, tükenen → filtreli listeye link, `/admin/siparisler?sekme=`); KPI kartları (ciro = tahsil edilen, sipariş, ortalama sepet, iade; değişim oku + sparkline); satış grafiği (ciro/sipariş, saatlik/günlük, klavye ile gezilebilir, tablo görünümü); sipariş durumları, ödeme yöntemi dağılımı, en çok satanlar, kritik stok, son siparişler. Müşteri bilgisi `customers.read`, stok `catalog.read` yoksa gizli |
| **İçerik yönetimi** `/admin/icerik` | Yasal metin kontrol listesi (mesafeli satış, ön bilgilendirme, KVKK, gizlilik, çerez, iade zorunlu; kullanım koşulları, üyelik isteğe bağlı) → eksikse “Şablondan oluştur”. Sayfa editörü: zengin metin (başlık, liste, bağlantı, alıntı, HTML modu, yapıştırılan metin temizlenir), **değişken ekle** (`{{firma.unvan}}`, `{{iletisim.eposta}}` … site ayarlarından dolar, boş olanlar uyarılır), önizleme, yayın durumu, footer sütunu + sıra, SEO, **sürüm geçmişi** (eski sürümü görüntüle / editöre yükle). Yayındaki sayfalar footer'a otomatik eklenir; checkout onay kutusu mesafeli satış + ön bilgilendirme sayfalarına bağlanır ve sürümleri siparişle kaydedilir |
| **Site ayarları** `/admin/ayarlar` | Genel, firma bilgileri, iletişim, marka ve logo, SEO, sosyal medya, footer — formlar ayar kaydından üretilir; grup bazında güncelleme ve eşzamanlı düzenleme kontrolü (`409 settings_changed`). Vitrin header/footer, logo, vurgu rengi, sayfa başlık şablonu, favicon, paylaşım görseli, indeksleme ve yazdırılan belgelerdeki satıcı bilgisi buradan gelir |
| **Kullanıcılar** `/admin/kullanicilar` | Panel kullanıcıları (Aktif / Davet bekleyen / Askıda). **Davet:** hesap parolasız açılır, kişi 7 gün geçerli tek kullanımlık bağlantıyla parolasını kendisi belirler (admin parola görmez/girmez). Detay: profil, roller (+ sonuç yetkiler önizlemesi), yeni davet bağlantısı, daveti iptal, parola sıfırlama bağlantısı (24 saat), tüm oturumları kapat, askıya al / etkinleştir, açık oturumlar. Kendinizi askıya alamazsınız; “Kullanıcı ve rol yönetimi” yetkisine sahip son aktif kişi bu yetkiyi kaybedemez |
| **Roller ve yetkiler** `/admin/kullanicilar/roller` | Rol listesi + gruplu yetki matrisi (hassas yetkiler işaretli). Özel rol ekle/düzenle/sil; hazır roller silinmez, Yönetici rolü her zaman tüm yetkilere sahip. Yetki kataloğu: `src/modules/staff/domain/permissions.ts` |
| **Müşteriler** `/admin/musteriler` | Mağaza üyeleri (personel hariç), sunucu taraflı arama (ad — Türkçe harf duyarsız —, e-posta, telefon), sıralama ve sayfalama; gruplar: sipariş verenler, henüz sipariş yok, ileti izni verenler, askıda. Detay: sipariş sayısı, harcama, ortalama sepet, son siparişler, profil + iç not (customers.write), adresler, KVKK / İYS onay geçmişi (sürümleriyle), parola sıfırlama bağlantısı, oturumları kapat, askıya al |
| **Üye ol / parola** `/uye-ol`, `/hesap/sifre/[token]`, `/admin/sifre/[token]` | Mağaza üyeliği: parola kuralı (≥ 10 karakter, harf+rakam, yaygın/ad/e-posta içermez — sunucu ve form aynı kural), KVKK aydınlatma onayı zorunlu, e-posta/SMS ticari ileti izinleri ayrı ve işaretsiz; onaylar belge sürümüyle kaydedilir; IP başına saatte 5 üyelik. Personel ve müşteri hesapları ayrıdır: personel hesabı mağazaya, müşteri hesabı panele giriş yapamaz |
| **Toplu işlemler** `/admin/toplu-islemler` | Excel sekmeleri (ürün ekle, güncelle, görseller, fiyat, stok): örnek .xlsx koddan üretilir (`modules/bulk/domain/bulk.ts` `BULK_OPS`); anahtar barkod / SKU / muhasebe / üretici kodu. Dosya **tarayıcıda** okunur (`domain/xlsx.ts`, zip-bomb sınırları), sunucuya yalnız sınırlı hücre metinleri gider; seçilince otomatik doğrulama (kuru çalıştırma, `CheckProductSave`) → "Yükle" → parçalı yazma + ilerleme. XML ve REST/JSON kaynakları: URL → yapı analizi (ürün listesi + alan yolları + otomatik eşleştirme) → anahtar ve alan eşleştirme → kurallar (güncellenecek alanlar, yeni ürün, fiyat ±%, kaynakta olmayan → stok 0, zamanlama) → önizleme. Senkron dilimlidir, değişmeyen ürünler hash ile atlanır. Geçmiş sekmesi `bulk_jobs` |
| **Kampanyalar** `/admin/kampanyalar` | Kampanya kuralları paneli: çakışma stratejisi (öncelik / en yüksek indirim) + sepette azami indirim oranı. Türler (aşamaya göre): ürün — yüzde, sabit fiyat, adet bazlı kademeli, X al Y öde, çapraz indirim (koşul kategorisi/markası/ürünü + en az adet); sepet — sepette %, sepette ₺; kargo — ücretsiz kargo. Vitrin rozeti: emoji ve/veya görsel (`campaigns` klasörü) + metin. "Yalnız ilk alışveriş" seçeneği. Kuponlarda "kampanyalı sepette de kullanılabilsin" seçeneği. Kapsam: tüm ürünler veya seçili kategori (alt kategoriler dahil) / marka / ürün, hariç tutma her zaman öncelikli. Koşullar: minimum sepet, en fazla indirim, adet kapasitesi, öncelik, birleşme kuralı; başlangıç/bitiş (İstanbul saati). Kural değişince `rule_version` artar (siparişler kendi sürümünü saklar). Kuponlar: tek kod veya 200'e kadar üretilmiş benzersiz kod, kullanım/limit, CSV; kullanılmış kupon ve siparişte kullanılmış kampanya silinmez. Liste: durum sekmeleri, sipariş sayısı ve verilen indirim |
| **Vitrin** `/admin/vitrin` | Ana sayfa düzeni (bölüm ekle/düzenle/sırala/aç-kapa/zamanla): büyük slider, hikaye şeridi, ürün şeridi/ızgarası (elle veya en yeni / en çok satan / indirimli), kategori kutuları, marka şeridi, banner. Slider sekmesi: slaytlar (masaüstü + mobil görsel, metin, buton, bağlantı, tarih, sıra). Hikayeler sekmesi: marka, kapak, çok kareli hikayeler. Eksik bölüm taslak olarak kaydedilebilir ama yayına alınamaz |
| **Kategoriler** `/admin/kategoriler` | Ağaç + sağ drawer'da güncelle/sil, `/yeni` sayfasında ekle; tüm kolonlar, görseller R2'ye yükleme |
| **Markalar** `/admin/markalar` | DataGrid + sağ drawer'da güncelle/sil, `/yeni` sayfasında ekle; logo/banner yükleme |
| **Ürünler** `/admin/urunler` | DataGrid; `/yeni` ve `/[id]` **adım adım sekmeli sayfa**: Genel · Marka&Kategori · Görseller · Varyant&Stok · Özellikler · SEO. Zorunlu alanlar dolmadan ileri geçilmez. Tüm ürün tek batch'te kaydedilir |
| **Siparişler** `/admin/siparisler` | KPI kartları, sayaçlı durum sekmeleri, filtre paneli, sunucu taraflı DataGrid, çoklu seçim + **toplu işlem çubuğu** |
| **Sipariş detayı** `/admin/siparisler/[id]` | İlerleme çizelgesi, bağlama göre tek ana işlem + işlemler menüsü, ürünler/tutar dökümü, iadeler, kargo gönderileri, aktivite + not, müşteri/ödeme/havale/adres kartları, belge yazdırma |
| **İade** | Kısmi/tam, stoğa geri alma; havale manuel, iyzico outbox ile; tam iade → `refunded` (ödenmiş sipariş iptali budur) |
| **Belgeler** `/admin/yazdir` | Sipariş özeti/proforma fatura + sevk irsaliyesi, A4, tekli/toplu (≤ 50). e-Fatura/e-İrsaliye **değildir** |
| **Kargo & outbox** | Outbox worker (kilit, geri çekilme, dead). “Kargoya ver” → `order.shipped` → aktif kargo firmasına gönderi kaydı (`carrier_shipments`, gönderi başına sabit `cargo_key` → yeniden denemede çift kayıt yok; ret `failed` + hata metniyle kaydedilip outbox tarafından tekrar denenir). Firma bağlı değilse `manual` (takip no elle). Takip: `POST /api/cron/shipping-sync` (Yurtiçi gibi webhook'u olmayan firmalar) takip no'yu yazar (+ `shipment.tracking_assigned` SMS olayı), yolda/teslim durumlarını uygular, terminal durumda sorgulamayı bırakır; push yapan firmalar için imzalı kargo webhook'u |
| **Denetim kayıtları** `/admin/denetim` | Salt okunur; kayıtlar değiştirilemez/silinemez (append-only trigger). Alan sekmeleri sayaçlı (Katalog, Siparişler, Kampanyalar, İçerik ve vitrin, Kullanıcılar ve müşteriler, Ayarlar, Diğer — alan, işlem kodunun ilk parçasından). Filtreler: kişi, kayıt türü, kayıt, tarih aralığı (İstanbul günleri); arama: kişi adı/e-postası, işlem kodu, sipariş no, istek no; sunucu taraflı sayfalama, CSV. Satır → sağ çekmecede Türkçe işlem adı, kişi, kaydın güncel adı, istek no, değişiklik tablosu (gizli görünen anahtarlar okumada da maskelenir), aynı istekteki diğer kayıtlar (toplu işlem), kaydın geçmişi, “Kayda git”. Derin bağlantı: `?kisi=<userId>`, `?tur=<entityType>&kayit=<id>`. İşlem adları `src/modules/audit/domain/audit.ts` |
| **Entegrasyonlar** (sidebar grubu) | **AI entegrasyonları** `/admin/entegrasyonlar/ai`: OpenAI, Google Gemini veya Claude'dan **yalnız biri**; model (`ai_models` kataloğundan seçim; kapanacak modeller uyarıyla, emekliler gizli) + API anahtarı. Anahtar şifreli saklanır, geri gösterilmez (yalnız `…son4`); aynı sağlayıcıda boş bırakılırsa eskisi korunur, başka sağlayıcı seçmek bağlantının yerini alır (yeni anahtar ister). “Bağlantıyı test et” (sağlık kontrolü: önce sağlayıcının models endpoint'inden modeli sorgular — ücretsiz, anahtar + model doğrulanır —, sonra tek kısa üretim isteği; model kapanacaksa uyarı), “Kaldır”, eşzamanlı düzenleme kontrolü (`409 ai_integration_changed`). **E-posta (SMTP)** `/admin/entegrasyonlar/e-posta`: mağazanın giden posta hesabı (hazır ayar: Gmail / Outlook / Yandex; sunucu, port, SSL veya STARTTLS, kullanıcı, parola, gönderen adı/adresi). Parola AES-256-GCM ile şifreli saklanır, hiç geri gösterilmez (boş bırakılırsa eskisi korunur); “Test e-postası gönder” giriş yapan admin'in adresine gider; `409 mail_integration_changed`. **Son gönderimler** kartı her denemeyi (`mail_deliveries`, 30 gün) gösterir: gönderildi (SMTP sunucusunun kabul satırı, ör. Gmail `250 2.0.0 OK … gsmtp`), gönderilemedi (sınıflandırılmış neden + adım + sunucu yanıtı), SMTP ayarı yok, bekletildi (2 dk içinde tekrar sıfırlama isteği). SMTP hataları `modules/mail/domain/smtp-failure.ts` `classifySmtpFailure` ile ayrışır: `smtp_host_not_found`, `smtp_connect_refused`, `smtp_connect_timeout`, `smtp_security_mismatch` (465↔SSL, 587↔STARTTLS), `smtp_tls_certificate`, `smtp_starttls_unsupported`, `smtp_app_password_required` (Gmail 534 5.7.9), `smtp_auth_failed`, `smtp_auth_disabled`, `smtp_auth_unsupported`, `smtp_sender_rejected`, `smtp_recipient_rejected`, `smtp_sending_limit`, `smtp_message_too_large`, `smtp_message_rejected`, `smtp_temporary`, `smtp_timeout`, `smtp_connection_closed`. Form, bilinen hatalı kombinasyonlarda (port/güvenlik uyuşmazlığı, Gmail'de farklı gönderen) kaydetmeden önce uyarır. **SMS entegrasyonları** `/sms` ve **Kargo entegrasyonları** `/kargo`: firma kataloğu `integration_providers` tablosundan (SMS: Netgsm, İleti Merkezi, Mutlucell, Verimor, JetSMS, Vatan SMS, Organik SMS, Twilio; kargo: Yurtiçi, Aras, MNG, PTT, Sürat, HepsiJET, Kolay Gelsin, Sendeo, UPS, DHL Express). **Hazır** (adaptörü olan) firma seçilince API alanları katalogdaki alan tanımlarından gelir; **entegrasyonu olmayan** firma seçilince “… için entegrasyon henüz yapılmadı, yazılım firmanıza bilgi verin” hatası (sunucu da `409 provider_not_integrated` ile reddeder). Şu an hazır: **Netgsm** (kullanıcı adı, API şifresi, SMS başlığı) ve **Yurtiçi Kargo** (test/canlı ortam, web servis kullanıcı adı, şifre). Tür başına tek bağlantı (başka firma seçmek eskisinin yerini alır, şifreleri silinir); şifre alanları AES-256-GCM ile `integration_secrets`'e, diğerleri `integrations.public_config_json`'a; boş şifre = eskisi korunur; `409 integration_changed`. SMS'te bildirim seçimi ve metinleri (sipariş alındı — kartta ödeme başarılı olunca, havalede hemen —, ödeme onaylandı, kargoya verildi, takip numarası oluştu, teslim edildi, iptal; değişkenler `{{magaza}} {{siparis_no}} {{tutar}} {{kargo_firmasi}} {{takip_no}} {{takip_url}} {{takip_bilgisi}}`, önizleme + yaklaşık SMS sayısı). Test: SMS → girilen numaraya test mesajı; kargo → kimlik doğrulama sorgusu (gönderi oluşmaz) |
| **AI ile ürün ekle** (ürün editörü) | Yalnız AI entegrasyonu varken görünür. Çekmece: alan seçimi (ürün adı, kısa açıklama, açıklama, SEO, görseller), 1–2 görsel (JPG/PNG/WebP), kısa açıklama (10–1500) → “AI ile oluştur” → önizleme → “Forma uygula”. Ürün kaydedilmez; alanlar dolar, görseller galeriye eklenir. **AI görsel üretmez**, “Görseller” seçeneği yüklenen fotoğrafları galeriye ekler. Sistem promptu müşteriye gösterilmez: sağlayıcı başına `src/modules/ai/prompts/system-prompts.ts`'te (yazılımcı düzenler). Açıklama HTML'i `sanitizeRichHtml`'den geçer. Her üretim audit'e yazılır (`ai.product_generate`); IP başına dakikada 10 |
| **Pazaryerleri** `/admin/entegrasyonlar/pazaryerleri` | Trendyol hazır (Hepsiburada, N11, Çiçeksepeti “yakında”). Bağlantı = satıcı hesabı (Satıcı ID + API Key/Secret, AES-256-GCM; canlı/test ortamı), kargo firma ID, teslim süresi, fiyat farkı %, güvenlik stoğu, listPrice seçeneği, 4 ayrı aralık (sipariş, stok, fiyat, ürün bilgisi+görsel). Sekmeler: **Genel** (ayarlar, test, “Şimdi senkronize et”, kuyruk durumu, sonraki çalışma zamanları), **Eşleştirme** (kategori → Trendyol yaprak kategori, marka, kategori özellikleri: mağaza özelliğinden / sabit değer / serbest metin + seçenek→değer), **Ürünler** (ürün ekle → tüm aktif varyantlar, barkod = pazaryeri anahtarı; durum: gönderilecek / onay bekliyor / satışta / reddedildi / hata / durduruldu, hata metni), **Siparişler** (çekilen paketler: aktarıldı / hatalı / atlandı). Mağazadaki ürün, stok, fiyat, görsel değişikliği trigger → kuyruk → pazaryeri; değişmeyen değer tekrar gönderilmez. Sipariş paketi bir kez siparişe döner (`orders.sales_channel = trendyol`, stok düşer; stok yetmezse sipariş yine yazılır, notla uyarılır), sonraki durumlar sipariş notu olur; bilinmeyen barkod `hatalı` kalır ve sonraki çekişte yeniden denenir |
| **Ödeme sistemleri** `/admin/odemeler` | Yalnız “Ödeme anahtarları” (`payments.secrets`) yetkisiyle. **Kart (iyzico):** Test (sandbox) ve Canlı için ayrı API + güvenlik anahtarı; AES-256-GCM ile `integration_secrets`'e şifreli yazılır, geri gösterilmez (API anahtarının yalnız son 4 karakteri), boş bırakılan anahtar korunur, `409 payment_settings_changed`. “Bağlantıyı test et” imzalı BIN sorgusu yapar (ödeme oluşmaz). Ödemeyi alan ortam: Kapalı / Test / Canlı — anahtarı olmayan ortam seçilemez, aynı anda tek ortam (`ux_payment_config_active`), canlıya alırken onay istenir. **Havale / EFT:** aç/kapa (en az bir aktif hesap şart), banka hesabı ekle/güncelle/sil (IBAN mod-97 + TR 26 hane, tekil); siparişte kullanılmış hesap silinmez ve IBAN'ı değişmez (pasif yapılabilir); Havale açıkken son aktif hesap pasif yapılamaz/silinemez. **Vitrin:** ödeme sayfası yalnız açık yöntemleri gösterir; havale seçilince ve sipariş sonucu sayfasında aktif IBAN'lar (açıklamaya yazılacak sipariş no ile) listelenir. Her değişiklik audit'e yazılır (anahtarlar ve IBAN yazılmaz) |

## 6. Panel arayüz sistemi (yeni ekranlar bu parçalarla yapılır)

**Görsel dil:** mor vurgu `#7367f0` (hover `#6559df`), slate nötrler, beyaz kartlar (`rounded-2xl border-slate-200 shadow-sm`), sidebar `#25293c`. Bileşenler `src/components/admin/ui.tsx` (`AdminPageHeader`, `AdminCard`, `AdminCardTitle`, `AdminBadge`, `AdminTable`).

**Hareket sistemi:** tüm animasyonlar yalnız `src/app/globals.css` `@theme` bloğunda tanımlı; bileşenler hazır sınıfları kullanır: `animate-fade-in/out`, `slide-in/out-right`, `slide-in/out-left`, `scale-in/out`, `pop-in/out`, `page-in`, `shake`, `shimmer`, `progress`, `ease-out-expo`. `prefers-reduced-motion` global uygulanır. Kapanış animasyonu için `usePresence(open)` (`src/lib/motion.ts`), odak/Escape/scroll kilidi/iç içe modal yığını için `useDialogFocus`. Overlay'ler `<Portal>` ile `body`'ye basılır.

| Bileşen | Ne zaman |
|---|---|
| `components/ui/DataGrid` | **Her liste.** AG Grid Community 36 (MIT) sarmalayıcısı; feature kodu `ag-grid-*` import etmez. `rows` (istemci modu) veya `fetchPage` (sunucu modu, `useCallback` ile filtrelere bağlı → değişince 1. sayfadan yeniden yükler). Arama, kolon göster/gizle, CSV (formül enjeksiyonu korumalı), `stateKey` ile görünüm hafızası, `highlightRowId`, `selectable` + `onSelectionChange`, `initialSearch`, `refreshToken`, Türkçe yerelleştirme |
| `lib/toast` → `notify.success/error/info/warning/promise` | **Her geri bildirim.** Sonner motoru + nova tasarımı (`components/ui/Toaster`, root layout'ta). `notify.error(err)` ApiError mesajını gösterir; effect içinden atılan toast'a `id` verin (dedupe) |
| `AdminDrawer` | Sağdan kayan düzenleme paneli (kategori, marka, kargo formu) |
| `AdminConfirmDialog` | Evet/hayır onayı (silme vb.). `window.confirm` kullanılmaz |
| `AdminFormDialog` | Küçük formlu işlem penceresi (havale onayı, iptal sebebi, iade, toplu işlem) |
| `Popover` | Bağlı menüler (kullanıcı, "Yeni", "İşlemler", "Yazdır") |
| `Collapsible` | Yükseklik animasyonlu aç/kapa (sidebar grubu, ağaç dalı, filtre paneli) |
| `features/media/ImageUpload` / `MediaGallery` | Bilgisayardan tek / çoklu görsel yükleme (R2), ilerleme, sürükle-bırak |
| `Skeleton`, `LoadingShell`, `GridSkeleton`, `TreeSkeleton`, `FormSkeleton`, `StepEditorSkeleton`, `TopProgress` | Her admin rotasında `loading.tsx` gerçek düzeni taklit eden iskelet + üstte ilerleme çubuğu |
| `features/admin-shell/CommandPalette` | ⌘K / Ctrl+K; sidebar + hızlı işlemlerden beslenir (`AdminShell`) |
| `ErrorState` / `ErrorBoundary` | Hata ve "bulunamadı" ekranları / tek widget'ı izole eden sınır (§4.3) |

**Ekran kalıpları:**
- *Basit kayıt (kategori, marka):* liste + üstte yalnız "X ekle" butonu → `/x/yeni` sayfası → kaydedince listeye dön (`?eklendi=id` → toast + satır vurgusu). Satıra tıkla → sağ drawer'da güncelle, sil = onay diyaloğu.
- *Çok alanlı kayıt (ürün):* `/x/yeni` ve `/x/[id]` ayrı sayfalar, yapışkan adım sekmeleri, yüzen alt eylem çubuğu, bölüm bazlı istemci doğrulaması (sunucu aynı kuralları uygular), kaydedilmemiş değişiklik uyarısı. Kayıttan sonra `?vurgula=id` ile listeye dön.
- **Eşzamanlı düzenleme (ürün):** editör güncellemede `expectedUpdatedAt` (yüklenen `updatedAt`) ve her varyant için `expectedStock` (yüklenen stok) gönderir. Arada başkası ürünü kaydettiyse `409 product_changed`; stok değiştiyse (satış dahil) `409 stock_changed`. Kullanıcının **değiştirmediği stok hiç yazılmaz** — editör açıkken yapılan satışlar geri alınmaz.
- *Operasyon kaydı (sipariş):* detay sayfası + durum makinesine bağlı işlemler (`lib/order-rules.ts`), tek `actions` ucu. Her işlem `modules/orders/application/actions` altında bir Command sınıfı; durum, yan etkiler, geçmiş, outbox ve audit tek UnitOfWork'te.
- **Metin kuralı:** yeni kayıtta "Oluştur/Ekle", var olan kayıtta "**Güncelle**" (asla "Kaydet").

## 7. İş akışları

**Checkout:** `POST /api/checkout/quote` (sunucu fiyatı + 15 dk oturum) → `POST /api/checkout/confirm` (Idempotency-Key): tek batch'te sipariş + adres/ürün snapshot + stok rezervasyonu (trigger kontrollü) + kampanya/kupon tahsisi + ödeme kaydı (+ havale talimatı) + olay + outbox. iyzico formu batch'ten sonra başlatılır; sonuç **callback/webhook'tan değil** iyzico detail API'sinden doğrulanır (tutar/para birimi/basketId) → `VerifyCardPayment` → `SettlePayment` (stok `committed`). iyzico `PaymentGateway` port'unun arkasındadır (`modules/payments`); anahtarlar `SecretVault` ile çözülür.

**Sipariş durum makinesi** (ayrıntı db/README.md §4): `reconcile` (havale onayı, `payments.reconcile` izni; havale eşleşmesi + ödeme + stok taahhüdü tek batch) · `prepare` · `ship` (kısmi destekli) · `deliver` · `complete` · `cancel` (yalnız ödenmemiş; stok/kupon/kampanya serbest) · `refund` (tahsilatı olan; kısmi/tam; iptal edilmiş siparişte geç gelen ödeme için de) · `note`. Her biri `order_events`'e yazılır; ship/deliver/cancel/refund outbox olayı üretir. Tanım `src/lib/order-rules.ts` (`ORDER_ACTIONS`, `PRIMARY_ACTION`, `BULK_ACTIONS`, `ORDER_TABS`) — **yeni işlem = `ORDER_ACTIONS`'a kayıt + `modules/orders/application/actions` altında bir `OrderAction` sınıfı + `orders/module.ts`'te listeye ekleme + `orders/http/schemas.ts`'te şema**.

**Ödeme sonuçlandırma** (`SettlePayment`): ödeme → paid, sipariş → paid, rezervasyon/kampanya/kupon → committed; hepsi guard'lı (eşzamanlı ikinci sonuçlandırma = no-op). **Geç ödeme:** iyzico'nun doğruladığı ödeme sipariş iptal/süre aşımından sonra gelirse ödeme kaydedilir, sipariş iptal kalır, stok satılmaz, `order.payment_after_cancel` outbox olayı + olay notu düşer; personel sipariş sayfasından iade eder. Panelden havale onayı ise süre aşımında reddedilir (`reservation_expired`).

**Toplu işlem:** `POST /api/admin/orders/bulk {orderIds, action}` — prepare/ship(tüm kalan)/deliver/complete/cancel/note; her sipariş ayrı kural kontrolü, sonuç sipariş bazında.

**Outbox worker** (`modules/outbox`): olayı kilitleyerek alır, işleyicileri çalıştırır, hata → üstel geri çekilme (1, 2, 4 … 60 dk), 8 deneme ya da işleyicisi olmayan olay → `dead`; kilidi başkasına geçmiş olayı işaretlemez. İşleyiciler modüllerden `addOutboxHandler(tip, factory)` ile kaydolur: `refund.process` → `ProcessCardRefund` (payments), `order.shipped` → `BookShipment` (shipping) + müşteri bildirimi, `order.* / refund.succeeded` → `NotifyCustomer` (sağlayıcı yoksa `skipped`), `order.payment_after_cancel` → personel uyarısı (log). Yeni olay = ilgili modülde bir işleyici (idempotent olmalı).

**Kargo** (`modules/shipping`): aktif `integrations(kind='shipping')` satırının adaptörü `modules/integrations` (`IntegrationRuntime.carrier()`, Strategy; yoksa `manual`). Yeni firma = `infrastructure/connectors/` altında bir sınıf + `defaultConnectors()` kaydı + `integration_providers` satırını `ready` ve alan tanımlarıyla güncellemek (tutarlılık `test:providers`'ta). Webhook `POST /api/webhooks/shipping/:provider`: başlıklar `x-nova-timestamp` (unix sn, ±5 dk) ve `x-nova-signature = hex(HMAC-SHA256(webhook_secret, "<ts>.<rawBody>"))`; gövde `{events:[{eventId, trackingNumber, status: in_transit|delivered|returned|lost, occurredAt}]}`. Her olay tek batch'te işlenir (olay kaydı + gönderi durumu + gerekirse sipariş `delivered` + olay notu + outbox); tekrarlar tekilleştirilir, terminal gönderi durumları yeniden açılmaz.

**Medya:** `POST /api/admin/media` (multipart, `file` + `folder` ∈ categories|brands|products, ≤ 5 MB, JPG/PNG/WebP/AVIF; tür ilk baytlardan doğrulanır, **SVG kabul edilmez**) → R2 `ASSETS_BUCKET` + `media_assets` satırı → `/assets/<folder>/<uuid>.<ext>` uzun önbellekle sunulur. Kullanılmayan yüklemeler kayıt güncellenince/silinince temizlenir.

## 8. API referansı

| Uç | Metot | Yetki / koruma |
|---|---|---|
| `/api/graphql` | POST | Herkese açık, salt okunur sorgular (§4.3); CSRF (Origin + JSON), gövde ≤ 16 KB, derinlik 6 / 1500 token, canlıda introspection kapalı |
| `/api/home`, `/api/catalog/products`, `/api/catalog/facets`, `/api/products/:slug`, `/api/health` | GET | Herkese açık (`health` yalnız `{status}` döner; katalog filtresi ≤ 8 özellik / 40 değer) |
| `/api/cart` · `/api/cart/items` · `/api/cart/items/:id` · `/api/cart/coupons` | GET · POST · PATCH/DELETE · POST/DELETE | Sepet çerezi/oturum, CSRF, `Cache-Control: no-store`; PATCH `version` ile (eski sekme → 409); kupon: IP başına dakikada 5 **hatalı** deneme |
| `/api/checkout/quote` · `/api/checkout/confirm` | POST | CSRF; confirm Idempotency-Key |
| `/api/storefront/auth/login|logout` (+ eski `/api/auth/*`) | POST | CSRF, IP + (hesap, IP) limiti; girişte misafir sepeti birleşir |
| `/api/admin/auth/login|logout` | POST | CSRF, IP + (hesap, IP) limiti, yalnız `staff_profiles`; login `remember: true` → 7 günlük oturum (yoksa 8 saat) |
| `/api/admin/auth/forgot` | POST | CSRF, IP başına 15 dk'da 5; **her adres için aynı yanıt** — hesap arama ve SMTP gönderimi yanıttan sonra (`after()`), aynı hesaba 2 dk içinde ikinci bağlantı gitmez |
| `/api/admin/categories[/:id]` | GET · POST · PUT/DELETE | catalog.read / catalog.write, CSRF, audit |
| `/api/admin/brands[/:id]` | GET · POST · PUT/DELETE | catalog.read / catalog.write, CSRF, audit |
| `/api/admin/products[/:id]` | GET · POST · PUT/DELETE | catalog.read / catalog.write (+ catalog.publish yayın için), CSRF, audit |
| `/api/admin/media` | POST multipart | klasöre göre: categories/brands/products → catalog.write, branding → settings.write; CSRF, audit |
| `/api/admin/content[/:id]` · `/api/admin/content/:id/revisions/:version` | GET · POST · PUT/DELETE · GET | content.write, CSRF, audit; PUT `expectedVersion` ile (409 page_changed), gövde ≤ 256 KB |
| `/api/admin/staff[/:id]` · `/api/admin/staff/:id/actions` · `/api/admin/roles[/:id]` | GET · POST · PATCH · POST · GET/POST/PUT/DELETE | users.manage, CSRF, audit; davet ve sıfırlama yanıtı tek kullanımlık bağlantıyı içerir (`no-store`) |
| `/api/admin/customers[/:id]` · `/api/admin/customers/:id/actions` | GET · PATCH · POST | customers.read (+ customers.write değişiklik için), CSRF, audit |
| `/api/storefront/auth/register` · `/api/account/password` | POST | Herkese açık, CSRF; üyelik IP başına saatte 5; parola bağlantısı IP başına 15 dakikada 10, token tek kullanımlık |
| `/api/admin/campaigns[/:id]` · `/api/admin/campaigns/:id/coupons[/:couponId]` | GET · POST · PUT/DELETE · POST | campaigns.write, CSRF, audit; PUT `expectedUpdatedAt` ile (409 campaign_changed) |
| `/api/admin/bulk/check` · `/api/admin/bulk/apply` · `/api/admin/bulk/jobs` | POST · POST · GET | catalog.write, CSRF, gövde ≤ 3 MB / ≤ 50 satır; her ürün değişikliği ürün kaydetme use case'inden geçer (audit `product.*` + `bulk.<op>`) |
| `/api/admin/bulk/feeds[/:id]` · `/feeds/analyze` · `/feeds/preview` · `/feeds/:id/run` · `/api/cron/feeds-sync` | GET/POST · PUT/DELETE · POST | catalog.write; analyze/preview IP başına dakikada 20 (dış siteye istek); cron `Authorization: Bearer <CRON_SECRET>`, 10–15 dakikada bir |
| `/api/admin/marketplaces[/:id]` · `/:id/test` · `/:id/sync` · `/:id/categories[/:ext/attributes[/:attr/values]]` · `/:id/brands` · `/:id/mappings/{categories,brands,attributes}` · `/:id/listings` · `/:id/orders` · `/api/cron/integrations` | GET/POST · PUT/DELETE · POST · GET · PUT · GET/POST/PUT | integrations.write, CSRF; anahtarlar hiç dönmez; audit `marketplace.*`; test/sync IP başına dakikada 10/20; cron `Bearer CRON_SECRET` her dakika |
| `/api/admin/campaigns/policy` | GET · PUT | campaigns.write, CSRF, audit `pricing_policy.update`; PUT `expectedUpdatedAt` ile (409 pricing_policy_changed) |
| `/api/admin/showcase/{sections,sliders,stories}…` | GET · POST · PUT · PATCH · DELETE | storefront.write, CSRF, audit; sıralama uçları tam listeyi ister (409 order_changed) |
| `/api/admin/settings` · `/api/admin/settings/:group` | GET · PUT | settings.write, CSRF, audit; PUT `{ values, expectedVersion }` (409 settings_changed) |
| `/api/admin/integrations/mail` · `/api/admin/integrations/mail/test` | GET · PUT · DELETE · POST | integrations.write, CSRF, audit (parola asla yazılmaz); PUT `{host, port, security, username, password?, fromEmail, fromName, expectedUpdatedAt}`; port 25 reddedilir; test IP başına dakikada 5 |
| `/api/admin/integrations/ai` · `/api/admin/integrations/ai/test` | GET · PUT · DELETE · POST | integrations.write, CSRF, audit; PUT `{provider, model, apiKey?, expectedUpdatedAt}` (model `ai_models`'ta olmalı; 409 ai_integration_changed); test → `AiHealthReport`; test IP başına dakikada 5 |
| `/api/admin/integrations/:kind` · `/api/admin/integrations/:kind/test` (`kind` = `sms` \| `shipping`) | GET · PUT · DELETE · POST | integrations.write, CSRF, audit (şifreler asla yazılmaz); PUT `{providerCode, values, events?, expectedUpdatedAt}` (409 provider_not_integrated / integration_changed, 422 `values.<alan>`); test `{phone?}` IP başına dakikada 5 |
| `/api/admin/payments` · `/payments/iyzico` · `/payments/iyzico/test` · `/payments/card` · `/payments/bank-transfer` · `/payments/bank-accounts[/:id]` | GET · PUT · POST · PUT · PUT · POST/PUT/DELETE | payments.secrets, CSRF, audit (anahtarlar asla yazılmaz); iyzico PUT `{environment, apiKey?, secretKey?, expectedUpdatedAt}` (409 payment_settings_changed); card PUT `{environment}` (`null` = kapalı; 409 iyzico_keys_missing); bank-transfer PUT `{active}` (409 bank_account_required); hesap `{bankName, accountHolder, iban, instructions?, isActive}` (409 bank_account_in_use / last_active_bank_account); test IP başına dakikada 5 |
| `/api/admin/ai/product-content` | POST | catalog.write, CSRF, IP başına dakikada 10; `{fields, prompt, mediaIds(1–2)}` → taslak (kaydetmez); sağlayıcı hataları 502 `ai_key_rejected` / `ai_rate_limited` / `ai_provider_error` / `ai_bad_output`, entegrasyon yoksa 409 `ai_not_configured` |
| `/api/admin/audit` · `/api/admin/audit/:id` | GET | audit.read; liste `?area&actorId&entityType&entityId&from&to&q&dir&page&pageSize`, meta'da `areaCounts` |
| `/api/admin/orders` · `/api/admin/orders/:id` | GET | orders.read (müşteri verisi customers.read yoksa maskeli) |
| `/api/admin/orders/:id/actions` · `/api/admin/orders/bulk` | POST | işleme göre orders.write / payments.reconcile, CSRF, Idempotency-Key, audit |
| `/api/payments/iyzico/callback` · `/api/webhooks/iyzico` | POST | Sağlayıcı yeniden doğrulaması (çerez değil), IP başına rate limit (30 / 300 dk) |
| `/api/webhooks/shipping/:provider` | POST | HMAC imza + zaman damgası |
| `/api/cron/expire` · `/api/cron/outbox` · `/api/cron/shipping-sync` | POST | `Bearer CRON_SECRET` |
| `/assets/*` | GET | Herkese açık, yalnız üretilmiş anahtar biçimi |

Roller ve izinler seed'dedir (db/README.md §6). Panel menüsü `src/app/(admin)/admin/layout.tsx` içindeki `NAV`'dan izinlere göre süzülür.

## 9. Testler

- `npm test` → **49/49** şema + **14/14** çekirdek + **18/18** katalog + **9/9** identity + **23/23** storefront + **8/8** orders + **6/6** integrations + **8/8** reporting + **12/12** content + **11/11** accounts + **10/10** campaigns + **5/5** showcase + **14/14** audit + **11/11** ai + **23/23** senaryo testi (Node ≥ 22.13; `--experimental-transform-types`).
- Servis testleri gerçek servis kodunu çalıştırır; `tests/integration/hooks.mjs` şunları taklit eder: `server-only`, `@opennextjs/cloudflare` (env = `globalThis.__ENV`), `next/headers` (çerez kavanozu), `next/server`, `bcryptjs` (`$2b$12$<parola>`). Zod gerçek paketle çalışır. D1 taklidi: `tests/integration/d1-sqlite.mjs` (node:sqlite, `batch` = transaction).
- `npm run test:e2e` → **15/15** Playwright testi (`tests/e2e/`): misafir sepet → havale ile checkout → sipariş numarası; personel girişi → siparişe not → havaleyi onayla → "Ödendi"; yanlış parola tek genel hata; Türkçe slug ile kategori oluşturma; panel içi "Kayıt bulunamadı"; işlem sırasında oturum düşerse `?next=` ile girişe dönüş; gösterge panelinde dönem değiştirme ve bekleyen işten filtreli sipariş listesine geçiş; firma unvanı değişince yasal metnin güncellenmesi, hatalı ayar alanı, yayınlanan yardım sayfasının footer'a otomatik gelmesi, yayındaki yasal metnin silinememesi; mağazadan üye olup admin müşteri listesinde görünme; personel daveti → kişinin kendi parolasını belirlemesi → panel girişi (bağlantı tek kullanımlık, personel hesabı mağazaya giremez); kategori oluşturunca denetim kaydında görünmesi → çekmece → “Kayda git”; Claude entegrasyonu ekleyince ürün editöründe “AI ile ürün ekle” çekmecesinin açılması (sağlayıcı çağrılmaz).
  - **Ayrı veritabanı:** `scripts/e2e-setup.mjs` her koşuda `.wrangler/e2e`'yi silip `db/schema.sql` + `db/seed.sql` kurar, havaleyi aktif eder ve test admini ekler (`e2e-admin@nova.test`, yalnız bu klasörde). Dev sunucusu `NOVA_PERSIST_DIR=.wrangler/e2e` ile başlar (`next.config.ts` → `initOpenNextCloudflareForDev({ persist })`); geliştiricinin local D1'ine dokunulmaz.
  - **Isınma:** `tests/e2e/global-setup.ts` test edilen sayfaları önceden bir kez ister; aksi hâlde `next dev` ilk derlemede tam sayfa yenileme gönderip testleri bozar.
  - İlk kurulumda tarayıcı: `npx playwright install chromium`. Hata olursa iz/ekran görüntüsü `test-results/` altında (`npx playwright show-trace …`).
  - Seçici kuralı: önce erişilebilir rol/etiket (`getByRole`, `getByLabel`); etiket birden çok alana uyuyorsa alan `id`'si (`#s_province`). Metinler arayüzle birebir aynı olmalı — buton metni değişirse test de değişir.
- Admin modülleri (kategori, marka, ürün, sipariş, iade, toplu işlem, outbox, kargo webhook, route'lar) geliştirme sırasında aynı altyapıyla senaryo testlerinden geçirildi; bu senaryolar henüz `tests/integration/`'a taşınmadı (yol haritası).

## 10. Bilinen tuzaklar

- **APP_ENV / PUBLIC_SITE_URL:** `wrangler.jsonc` bu `vars`'ları canlı değerleriyle local `next dev`'e de verir; bu yüzden `.env.local`'deki değerler önceliklidir (`buildConfig`, `src/server/env.ts`). Canlıda (`APP_ENV=production`) `SESSION_SECRET` (≥ 32 karakter), `SECRETS_MASTER_KEY`, `CRON_SECRET` yoksa istekler başlangıçta `ConfigError` ile durur — deploy öncesi `wrangler secret list` ile kontrol edin.

- **iCloud:** proje iCloud ile eşitlenen Masaüstü'ndeyse iCloud `.next/` ve `.git/` içinde `… 2`, `… 3` kopyaları üretir (tsc'yi bozar, git'i riske atar). `tsconfig` `.next/**/* ?.ts` kopyalarını yok sayar; kalıcı çözüm projeyi iCloud dışına taşımaktır.

- **Node sürümü:** makinede varsayılan Node 18 olabilir; Node ≥ 22.13 olmadan `tsc`, `next dev` ve servis testleri çalışmaz.
- **İstemci bileşenleri modül `index`'inden değer import etmez:** `"use client"` dosyaları `@/modules/<modül>` index'inden yalnız **tip** (`import type`) alır; sabit/fonksiyon gerekiyorsa saf `domain/*` dosyasından import edin. Index, sunucu kodunu (`next/headers`, D1) da yükler; istemciye girince sayfa 500 verir (“You're importing a module that depends on next/headers”).
- **E-posta (SMTP):** panelde “Parolamı unuttum” sıfırlama bağlantısını Entegrasyonlar › E-posta (SMTP) hesabıyla gönderir (`modules/mail`, bağımlılıksız SMTP istemcisi `node:net`/`node:tls` — Workers'ta `nodejs_compat`; port 25 Workers'ta kapalı). Ham token veritabanına/outbox'a yazılmaz, bu yüzden e-posta istek sırasında (`after()`) gönderilir; SMTP hatası loglanır, kullanıcı tekrar isteyebilir. SMTP ayarı yoksa bağlantı yalnız **geliştirmede** loga yazılır (`resetLink`), canlıda yazılmaz. **Gmail:** normal parola çalışmaz — 2 adımlı doğrulama + 16 haneli *uygulama şifresi* gerekir, gönderen adresi hesapla aynı olmalı. Gerçek Gmail'e SSL (465) ve STARTTLS (587) el sıkışması Node'da doğrulandı; Workers üzerinde STARTTLS yükseltmesi henüz canlıda denenmedi (sorun olursa 465/SSL kullanın). Davet bağlantıları hâlâ admin'e gösterilir; mağaza müşterisi için “Şifremi unuttum” ekranı henüz yok (use case `RequestPasswordReset` `customer` kitlesini destekliyor).
- **Local D1'e dev sunucusu açıkken yazmayın:** `npm run dev` çalışırken `db:*:local` / `db:query:local` / `wrangler d1 execute --local` ile şema veya veri değiştirmek, aynı SQLite dosyasına iki ayrı süreç yazdığı için dosyayı bozabilir (belirti: her istekte `internal error; reference = …`, `sqlite3`'te `database disk image is malformed`). Önce dev sunucusunu durdurun, komutu çalıştırın, sonra yeniden başlatın. Bozulduysa `.wrangler/state` yedeğinden dönün ya da `npm run db:reset:local`.
- **Dev'de sonsuz yeniden yükleme:** Next 16 her istekte `.next/dev/logs/next-development.log`'a yazar; Tailwind 4 varsayılan olarak proje kökünü tarayıp izlediği için her yazım CSS'i yeniden derletip sayfayı yeniletiyordu (e2e'de "navigation to finish" ile takılma). `globals.css` bu yüzden `@import "tailwindcss" source("..")` ile yalnız `src/`'yi tarar — kaldırmayın; sınıf içeren dosyalar `src/` dışına konmaz. (İlk derleme sırasında, prefetch edilen yeni route'lar derlenirken birkaç yeniden yükleme normaldir.)
- **Dev sunucusu bayat modül:** `src/modules/*/http/schemas.ts` veya `src/server/app.ts` gibi paylaşılan sunucu modülleri değiştiğinde çalışan `next dev` eski kopyayı tutabiliyor (belirti: `Cannot read properties of undefined (reading 'parse')`, "Beklenmeyen bir hata"). Çözüm: dev sunucusunu yeniden başlat.
- **SQLite ≥ 3.51:** ilişkili alt sorgunun `ORDER BY`'ında dış kolon kullanılamaz (`no such column: v.id`). Dış referansı `WHERE`'de tut.
- **AI modelleri:** liste `ai_models` tablosunda (DDL + `db/schema.sql` sonundaki upsert DML). Model ekleme/kaldırma = DML satırı + `db:schema:*`; silinmez, `status` `deprecated` (uyarı + `retires_at`) veya `retired` (gizli) yapılır. Panel yalnız listedeki modelleri kabul eder (kayıtlı model listeden çıksa bile anahtar değişikliğinde korunur). Listeyi gerçek anahtarlarla doğrulamak: `npm run ai:health` (`OPENAI_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`; `--generate` kısa üretim de dener, `--provider=` / `--model=` filtre). Sağlayıcı hataları `ai-clients.ts` `classifyFailure` ile ayrışır: `ai_key_rejected`, `ai_access_denied`, `ai_quota_exceeded` (kredi/kota/harcama limiti — tekrar denemek işe yaramaz), `ai_rate_limited`, `ai_model_not_found`, `ai_model_unusable`, `ai_request_rejected`, `ai_request_too_large`, `ai_provider_busy` (500/502/503/504/529 yeniden denendikten sonra), `ai_timeout`, `ai_content_blocked`, `ai_output_truncated`, `ai_bad_output`. Yeni sağlayıcı = `providers.ts` + `infrastructure/ai-clients.ts`'te bir sınıf (`generate` + `checkModel`) + `prompts/system-prompts.ts` + `ai_integration`/`ai_models` provider CHECK'leri + `ai_models` satırları.
- **Migration yok:** `schema.sql` mevcut tabloya kolon eklemez → `ALTER TABLE` veya local reset (db/README.md §7).
- **ESLint / build:** `npm run lint` ve `next build` hatasız ve uyarısız olmalı; yeni kod bu durumu bozmamalı. `tests/**` için yalnız `no-explicit-any` kapalı (dinamik import).
- iyzico: iade ucu `/v2/payment/refund` ve webhook V3 imza doğrulaması **sandbox'ta denenmedi**; canlı öncesi güncel dokümanla doğrulanmalı. iyzico `identityNumber` sabit yer tutucu (TCKN toplama işletme kararı).
- Fiyat motoru: "X al Y öde" ve ücretsiz kargo uygulanır; "X al Y hediye" (buy_x_get_y) şemada var ama hediye satırı sepete eklenemediği için panelde sunulmaz. Kargo KDV'si %20 varsayılır.
- Saat dilimi: tarih filtreleri UTC gün sınırlarıyla çalışır (gösterim Europe/Istanbul).
- **Yasal metinler örnektir:** seed'deki şablonlar genel taslaktır; yayın öncesi hukuk danışmanına kontrol ettirilmeli ve Site ayarları → Firma bilgileri gerçek bilgilerle doldurulmalı.
- **Canlı veritabanı (içerik/ayarlar):** `content_pages` ve `site_settings` tablolarının yapısı değişti, `content_page_revisions` eklendi. `schema.sql` mevcut tabloyu değiştirmez (`CREATE TABLE IF NOT EXISTS`) — canlıda bu tablolar eski hâliyle duruyorsa önce yedek alıp bu iki tabloyu (ve `seo_documents`'taki `page_id` satırlarını) yeniden oluşturmak, sonra `db:schema:remote` + ilgili seed satırlarını çalıştırmak gerekir.

## 11. Yol haritası

1. Entegrasyon adaptörleri: katalogda “planlanan” SMS/kargo firmaları (Aras, MNG, PTT, İleti Merkezi …), sipariş ekranında kargo kaydı durumu / hata gösterimi, e-posta bildirim şablonları.
2. Bildirim adaptörleri (e-posta/SMS) ve gerçek kargo firması adaptörü; Cron Trigger worker'ı.
3. Ürün editörüne: ilişkili ürünler, tedarikçi kodu/maliyet, varyanta özel görseller.
4. Müşteri tarafı: üye kaydı, parola sıfırlama, hesabım sipariş geçmişi/takip, favoriler, karşılaştırma, yorumlar; havale bildirimi formu.
5. Admin MFA (`ADMIN_MFA_ENFORCED`, `sessions.mfa_verified_at` hazır), e-Fatura/e-İrsaliye entegratörü, yasal metinler (KVKK, mesafeli satış, ön bilgilendirme sayfaları — checkout bunlara link veriyor, sayfalar yok).
6. Senaryo testlerini `tests/integration/`'a taşımak; Playwright kapsamını genişletmek (ürün editörü, kart ödemesi sandbox, iade, toplu işlem).

## 12. Devir notu

- GitHub: `https://github.com/ahancerli/nova-e-ticaret` (public, `main`). İlk commit teslim alınan hâli içerir.
- Belgeler: veri kuralları, durum geçişleri ve sözlükler `db/README.md`'de; iş kuralları `src/lib/order-rules.ts` ve `src/lib/product-rules.ts`'te tek yerde.

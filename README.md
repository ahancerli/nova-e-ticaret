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
npm run db:schema:local          # local SQLite-D1: 88 tablo · 47 indeks · 25 trigger
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
| `npm test` | `db:test` (41 şema, python3) + `test:core` (14 çekirdek) + `test:catalog` (18 katalog/ürün/medya modülü) + `test:services` (23 eski servis) — Node ≥ 22.13 |
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
`POST /api/cron/outbox` her **1 dk**, `POST /api/cron/expire` her **5 dk**, başlık `Authorization: Bearer $CRON_SECRET`.

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
    (storefront)/         Vitrin sayfaları (header/footer SSR, ana sayfa orta alanı client-side)
    (admin)/admin/        Panel sayfaları + layout (AdminShell) + template (sayfa geçiş animasyonu) + loading.tsx'ler
    (admin-auth)/admin/giris   Panel giriş sayfası (kabuk dışında)
    (admin-print)/admin/yazdir Yazdırılabilir belgeler (kabuk dışında)
    api/                  Route handler'lar ({data, meta, requestId} sözleşmesi)
    assets/[...path]/     R2'deki yüklenmiş görselleri sunar
  components/
    ui/                   Proje geneli: DataGrid, Toaster, Popover, Collapsible, Portal
    admin/                Panel bileşenleri (aşağıda katalog)
    storefront/ cart/ checkout/   Vitrin bileşenleri
  core/                   Çatıdan bağımsız temel (ayrıntı §4.1): errors, di, db, logging, runtime, http
  modules/                İş modülleri (ayrıntı §4.2): audit, media, catalog (kategori, marka, ürün); diğerleri henüz src/server/services'te
  lib/                    İstemci+sunucu ortak: api-client, toast, motion, money, slug, ids, types, order-rules, product-rules
  proxy.ts                Sayfa CSP'si (istek başına script nonce)
  server/                 Yalnız sunucu ("server-only"): app (composition root + route), db, auth, http, security, validation, idempotency, crypto
    services/             Henüz modüle taşınmamış iş mantığı: catalog (vitrin), cart, pricing, checkout, iyzico, admin-orders, shipping, outbox
```

## 4. Mimari kurallar (tüm yeni kod bunlara uyar)

1. **Veri erişimi yalnız sunucuda** (`src/server`, `import "server-only"`). Parametreli sorgu (`?`); sıralama/kolon adları allowlist'ten. D1 sınırı: ifade başına ≤ 100 parametre → `IN` listeleri 80'lik parçalara bölünür (`placeholders()`).
2. **Atomiklik:** çok adımlı yazma = tek `UnitOfWork` (D1 batch). Durum geçişleri `WHERE status = <beklenen>` + `uow.expectChanges(1, () => new ConflictError(…))`: koşul tutmazsa **batch'in tamamı veritabanında geri alınır** (`batch_guards` trigger'ı). Bir batch'te birden çok guard olabilir; hangisi tetiklenirse onun hatası atılır. Batch bittikten sonra `changes` kontrol etmek yetersizdir (diğer ifadeler yazılmış olur) — eski servislerde bu kalıp Aşama 3'te değiştirilecek. Dış ağ çağrıları (iyzico, kargo) **batch dışında**, mümkünse outbox üzerinden.
3. **API sözleşmesi:** başarı `{data, meta, requestId}`, hata `{error:{code,message,fieldErrors}, requestId}`. Yeni route'lar `route({...})` ile yazılır (§4.1); eski `handler()` da aynı hata hattını kullanır. Hatalar `AppError` alt sınıflarıyla atılır; Zod ve DB trigger/constraint hataları `toAppError` ile tek yerde eşlenir (`src/core/errors/translate.ts`). 5xx'te istemci genel mesaj alır, ayrıntı `requestId` ile JSON log'a gider.
4. **Kimlik:** yalnız oturum çerezinden. Mağaza `__Host-nova_store_session` (`SameSite=Lax`), panel `__Host-nova_admin_session` (ayrı; `SameSite=Strict`, 8 saat). Token'ın kendisi değil HMAC'i saklanır. Body'deki userId asla yetki değildir.
5. **Yetki:** her admin route/sayfa `requirePermission("<kod>")` çağırır; UI gizlemek yetki değildir. Nesne/durum kuralları serviste ayrıca kontrol edilir.
6. **CSRF:** cookie ile yazan her uç `assertSameOrigin(req)` (Origin/Referer + JSON içerik tipi; yükleme uçları `{multipart:true}`).
7. **Idempotency:** `Idempotency-Key` başlığı checkout confirm, sipariş işlemleri ve toplu işlemlerde zorunlu (`withIdempotency`); aynı anahtar + farklı gövde → 409, tekrar → kayıtlı yanıt.
8. **Fiyat her zaman sunucuda** (`pricing.buildQuote`); quote hash'i saklanır, confirm'de farklıysa 409.
9. **Validasyon:** tüm girdiler Zod 4 şemalarından geçer (modüllerde `modules/<m>/http/schemas.ts`, eskiler `src/server/validation.ts`); Zod mesajları Türkçe (`modules/shared/schemas.ts`). Slug alanları serbest metin alır, servis `slugify` ile normalize eder (Türkçe karakter çevrilir: "Yaşam" → `yasam`).
10. **Audit:** admin yazma işlemleri `audit_logs`'a yazılır (sözlük: db/README.md §5). Modüllerde audit satırı, değişikliğin **aynı UnitOfWork'üne** `AuditLog.recordStatement()` ile eklenir (ya ikisi ya hiçbiri); eski servisler hâlâ `audit()` kullanır.
11. **Rate limit:** login ve kupon için IP başına dakikada 5 hata (D1 üzerinde).
12. **HTML:** admin'in yazdığı açıklamalar vitrinde `sanitizeRichHtml` (tokenizer tabanlı allowlist; yalnız `https://` veya site içi `/yol` bağlantıları) üzerinden geçer; kullanıcı içeriği asla HTML olarak basılmaz. Yeni XSS bulgusu = `tests/integration/services.test.ts` içindeki payload listesine bir satır.
13. **Sırlar** `integration_secrets`'ta AES-256-GCM; ana anahtar Worker secret. Panel sırları geri göstermez.
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

**Yeni modül eklemek:** klasörü kur → `module.ts`'te `registerX(c)` → `src/server/app.ts`'te `registerX(container)` → route dosyaları `route({...})` → `tests/integration/<modül>.test.ts` (container testte kurulur, yalnız dış servisler sahte).

## 5. Modül durumu

| Alan | Durum |
|---|---|
| **Vitrin** | Ana sayfa (hikaye şeridi, tek slider, vitrinler; client-side), kategori/marka listeleme + facet filtreler (aynı attribute OR, farklı AND, varyant eksenleri aynı SKU'da), arama, ürün detayı (SSR + JSON-LD, varyant seçici), sağ sepet çekmecesi, kupon, misafir checkout (iyzico / havale), sipariş sonuç sayfası, mağaza girişi, basit hesabım |
| **Panel kabuğu** | Sidebar (yalnız seçili öğe mor, iç içe menü kayarak açılır, mobilde soldan drawer), üst bar (breadcrumb, ⌘K komut paleti, ortam rozeti, "Yeni" menüsü, bildirim paneli, kullanıcı menüsü/çıkış) |
| **Dashboard** `/admin` | Son 30 gün KPI, son siparişler, düşük stok |
| **Kategoriler** `/admin/kategoriler` | Ağaç + sağ drawer'da güncelle/sil, `/yeni` sayfasında ekle; tüm kolonlar, görseller R2'ye yükleme |
| **Markalar** `/admin/markalar` | DataGrid + sağ drawer'da güncelle/sil, `/yeni` sayfasında ekle; logo/banner yükleme |
| **Ürünler** `/admin/urunler` | DataGrid; `/yeni` ve `/[id]` **adım adım sekmeli sayfa**: Genel · Marka&Kategori · Görseller · Varyant&Stok · Özellikler · SEO. Zorunlu alanlar dolmadan ileri geçilmez. Tüm ürün tek batch'te kaydedilir |
| **Siparişler** `/admin/siparisler` | KPI kartları, sayaçlı durum sekmeleri, filtre paneli, sunucu taraflı DataGrid, çoklu seçim + **toplu işlem çubuğu** |
| **Sipariş detayı** `/admin/siparisler/[id]` | İlerleme çizelgesi, bağlama göre tek ana işlem + işlemler menüsü, ürünler/tutar dökümü, iadeler, kargo gönderileri, aktivite + not, müşteri/ödeme/havale/adres kartları, belge yazdırma |
| **İade** | Kısmi/tam, stoğa geri alma; havale manuel, iyzico outbox ile; tam iade → `refunded` (ödenmiş sipariş iptali budur) |
| **Belgeler** `/admin/yazdir` | Sipariş özeti/proforma fatura + sevk irsaliyesi, A4, tekli/toplu (≤ 50). e-Fatura/e-İrsaliye **değildir** |
| **Kargo & outbox** | Outbox worker (kilit, geri çekilme, dead), kargo adaptör arayüzü (şimdilik `manual`), imzalı kargo webhook'u (otomatik teslim) |
| **Yer tutucu** | Kampanyalar, Vitrin (slider/hikaye), Ödeme sistemleri (iyzico/IBAN ayarı), Entegrasyonlar, Kullanıcılar/roller, Ayarlar, Denetim kayıtları → `/admin/[...module]` "Roadmap" sayfası. Veri modeli hazır. |

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
| `ImageUpload` / `MediaGallery` | Bilgisayardan tek / çoklu görsel yükleme (R2), ilerleme, sürükle-bırak |
| `Skeleton`, `LoadingShell`, `GridSkeleton`, `TreeSkeleton`, `FormSkeleton`, `StepEditorSkeleton`, `TopProgress` | Her admin rotasında `loading.tsx` gerçek düzeni taklit eden iskelet + üstte ilerleme çubuğu |
| `CommandPalette` | ⌘K / Ctrl+K; sidebar + hızlı işlemlerden beslenir (`AdminShell`) |

**Ekran kalıpları:**
- *Basit kayıt (kategori, marka):* liste + üstte yalnız "X ekle" butonu → `/x/yeni` sayfası → kaydedince listeye dön (`?eklendi=id` → toast + satır vurgusu). Satıra tıkla → sağ drawer'da güncelle, sil = onay diyaloğu.
- *Çok alanlı kayıt (ürün):* `/x/yeni` ve `/x/[id]` ayrı sayfalar, yapışkan adım sekmeleri, yüzen alt eylem çubuğu, bölüm bazlı istemci doğrulaması (sunucu aynı kuralları uygular), kaydedilmemiş değişiklik uyarısı. Kayıttan sonra `?vurgula=id` ile listeye dön.
- **Eşzamanlı düzenleme (ürün):** editör güncellemede `expectedUpdatedAt` (yüklenen `updatedAt`) ve her varyant için `expectedStock` (yüklenen stok) gönderir. Arada başkası ürünü kaydettiyse `409 product_changed`; stok değiştiyse (satış dahil) `409 stock_changed`. Kullanıcının **değiştirmediği stok hiç yazılmaz** — editör açıkken yapılan satışlar geri alınmaz.
- *Operasyon kaydı (sipariş):* detay sayfası + durum makinesine bağlı işlemler (`lib/order-rules.ts`), tek `actions` ucu.
- **Metin kuralı:** yeni kayıtta "Oluştur/Ekle", var olan kayıtta "**Güncelle**" (asla "Kaydet").

## 7. İş akışları

**Checkout:** `POST /api/checkout/quote` (sunucu fiyatı + 15 dk oturum) → `POST /api/checkout/confirm` (Idempotency-Key): tek batch'te sipariş + adres/ürün snapshot + stok rezervasyonu (trigger kontrollü) + kampanya/kupon tahsisi + ödeme kaydı (+ havale talimatı) + olay + outbox. iyzico formu batch'ten sonra başlatılır; sonuç **callback/webhook'tan değil** iyzico detail API'sinden doğrulanır (tutar/para birimi/basketId) → `markPaymentPaid` (stok `committed`).

**Sipariş durum makinesi** (ayrıntı db/README.md §4): `reconcile` (havale onayı, `payments.reconcile` izni) · `prepare` · `ship` (kısmi destekli) · `deliver` · `complete` · `cancel` (yalnız ödenmemiş; stok/kupon/kampanya serbest) · `refund` (ödenmiş; kısmi/tam) · `note`. Her biri `order_events`'e yazılır; ship/deliver/cancel/refund outbox olayı üretir. Tanım `src/lib/order-rules.ts` (`ORDER_ACTIONS`, `PRIMARY_ACTION`, `BULK_ACTIONS`, `ORDER_TABS`) — **yeni işlem = buraya kayıt + `runOrderAction` içinde bir case + `validation.ts`'te şema**.

**Toplu işlem:** `POST /api/admin/orders/bulk {orderIds, action}` — prepare/ship(tüm kalan)/deliver/complete/cancel/note; her sipariş ayrı kural kontrolü, sonuç sipariş bazında.

**Outbox worker** (`src/server/services/outbox.ts`): `refund.process` → iyzico iade; `order.shipped` → kargo adaptörü `book()`; `order.* / refund.succeeded` → müşteri bildirimi (sağlayıcı yoksa `skipped`). Yeni olay = `HANDLERS`'a bir işleyici (idempotent olmalı).

**Kargo** (`src/server/services/shipping.ts`): aktif `integrations(kind='shipping')` satırının `provider_code`'u adaptörü seçer (yoksa `manual`). Webhook `POST /api/webhooks/shipping/:provider`: başlıklar `x-nova-timestamp` (unix sn, ±5 dk) ve `x-nova-signature = hex(HMAC-SHA256(webhook_secret, "<ts>.<rawBody>"))`; gövde `{events:[{eventId, trackingNumber, status: in_transit|delivered|returned|lost, occurredAt}]}`. Tekrarlar tekilleştirilir; tüm koliler teslim → sipariş `delivered`.

**Medya:** `POST /api/admin/media` (multipart, `file` + `folder` ∈ categories|brands|products, ≤ 5 MB, JPG/PNG/WebP/AVIF; tür ilk baytlardan doğrulanır, **SVG kabul edilmez**) → R2 `ASSETS_BUCKET` + `media_assets` satırı → `/assets/<folder>/<uuid>.<ext>` uzun önbellekle sunulur. Kullanılmayan yüklemeler kayıt güncellenince/silinince temizlenir.

## 8. API referansı

| Uç | Metot | Yetki / koruma |
|---|---|---|
| `/api/home`, `/api/catalog/products`, `/api/catalog/facets`, `/api/products/:slug`, `/api/health` | GET | Herkese açık (`health` yalnız `{status}` döner; katalog filtresi ≤ 8 özellik / 40 değer) |
| `/api/cart` · `/api/cart/items` · `/api/cart/items/:id` · `/api/cart/coupons` | GET · POST · PATCH/DELETE · POST/DELETE | Sepet çerezi/oturum, CSRF, kupon rate limit |
| `/api/checkout/quote` · `/api/checkout/confirm` | POST | CSRF; confirm Idempotency-Key |
| `/api/storefront/auth/login|logout` (+ eski `/api/auth/*`) | POST | CSRF, rate limit; girişte misafir sepeti birleşir |
| `/api/admin/auth/login|logout` | POST | CSRF, rate limit, yalnız `staff_profiles` |
| `/api/admin/categories[/:id]` | GET · POST · PUT/DELETE | catalog.read / catalog.write, CSRF, audit |
| `/api/admin/brands[/:id]` | GET · POST · PUT/DELETE | catalog.read / catalog.write, CSRF, audit |
| `/api/admin/products[/:id]` | GET · POST · PUT/DELETE | catalog.read / catalog.write (+ catalog.publish yayın için), CSRF, audit |
| `/api/admin/media` | POST multipart | catalog.write, CSRF, audit |
| `/api/admin/orders` · `/api/admin/orders/:id` | GET | orders.read (müşteri verisi customers.read yoksa maskeli) |
| `/api/admin/orders/:id/actions` · `/api/admin/orders/bulk` | POST | işleme göre orders.write / payments.reconcile, CSRF, Idempotency-Key, audit |
| `/api/payments/iyzico/callback` · `/api/webhooks/iyzico` | POST | Sağlayıcı yeniden doğrulaması (çerez değil), IP başına rate limit (30 / 300 dk) |
| `/api/webhooks/shipping/:provider` | POST | HMAC imza + zaman damgası |
| `/api/cron/expire` · `/api/cron/outbox` | POST | `Bearer CRON_SECRET` |
| `/assets/*` | GET | Herkese açık, yalnız üretilmiş anahtar biçimi |

Roller ve izinler seed'dedir (db/README.md §6). Panel menüsü `src/app/(admin)/admin/layout.tsx` içindeki `NAV`'dan izinlere göre süzülür.

## 9. Testler

- `npm test` → **41/41** şema + **14/14** çekirdek + **18/18** katalog modülü + **23/23** servis testi (Node ≥ 22.13; `--experimental-transform-types`).
- Servis testleri gerçek servis kodunu çalıştırır; `tests/integration/hooks.mjs` şunları taklit eder: `server-only`, `@opennextjs/cloudflare` (env = `globalThis.__ENV`), `next/headers` (çerez kavanozu), `next/server`, `bcryptjs` (`$2b$12$<parola>`). Zod gerçek paketle çalışır. D1 taklidi: `tests/integration/d1-sqlite.mjs` (node:sqlite, `batch` = transaction).
- Admin modülleri (kategori, marka, ürün, sipariş, iade, toplu işlem, outbox, kargo webhook, route'lar) geliştirme sırasında aynı altyapıyla senaryo testlerinden geçirildi; bu senaryolar henüz `tests/integration/`'a taşınmadı (yol haritası).

## 10. Bilinen tuzaklar

- **iCloud:** proje iCloud ile eşitlenen Masaüstü'ndeyse iCloud `.next/` ve `.git/` içinde `… 2`, `… 3` kopyaları üretir (tsc'yi bozar, git'i riske atar). `tsconfig` `.next/**/* ?.ts` kopyalarını yok sayar; kalıcı çözüm projeyi iCloud dışına taşımaktır.

- **Node sürümü:** makinede varsayılan Node 18 olabilir; Node ≥ 22.13 olmadan `tsc`, `next dev` ve servis testleri çalışmaz.
- **Dev sunucusu bayat modül:** `src/server/validation.ts` veya `security.ts` gibi paylaşılan sunucu modülleri değiştiğinde çalışan `next dev` eski kopyayı tutabiliyor (belirti: `Cannot read properties of undefined (reading 'parse')`, "Beklenmeyen bir hata"). Çözüm: dev sunucusunu yeniden başlat.
- **SQLite ≥ 3.51:** ilişkili alt sorgunun `ORDER BY`'ında dış kolon kullanılamaz (`no such column: v.id`). Dış referansı `WHERE`'de tut.
- **Migration yok:** `schema.sql` mevcut tabloya kolon eklemez → `ALTER TABLE` veya local reset (db/README.md §7).
- **ESLint / build:** `npm run lint` ve `next build` hatasız ve uyarısız olmalı; yeni kod bu durumu bozmamalı. `tests/**` için yalnız `no-explicit-any` kapalı (dinamik import).
- iyzico: iade ucu `/v2/payment/refund` ve webhook V3 imza doğrulaması **sandbox'ta denenmedi**; canlı öncesi güncel dokümanla doğrulanmalı. iyzico `identityNumber` sabit yer tutucu (TCKN toplama işletme kararı).
- Fiyat motoru: "X al Y bedava" hesaplanır ama hediye satırı otomatik eklenmez. Kargo KDV'si %20 varsayılır.
- Saat dilimi: tarih filtreleri UTC gün sınırlarıyla çalışır (gösterim Europe/Istanbul).
- Dashboard (`/admin/page.tsx`) henüz eski tasarımda: "Refunded" kartı gerçek veri değil (`sipariş × 0.02`), metinler kısmen İngilizce. Sipariş ekranındaki KPI'lar gerçektir.
- Vitrin footer/checkout linkleri `/hesabim/siparisler`, `/sayfa/iade`, `/sayfa/on-bilgilendirme`, `/sayfa/mesafeli-satis` henüz 404; `gizlilik` sayfası yayında değil.

## 11. Yol haritası

1. Panel: kampanya/kupon, vitrin (slider/hikaye/ana sayfa blokları), ödeme sistemleri (iyzico anahtarı, IBAN), entegrasyonlar (kargo/SMS sırları, webhook secret), kullanıcı/rol, site & SEO ayarları, denetim kaydı görüntüleyici.
2. Bildirim adaptörleri (e-posta/SMS) ve gerçek kargo firması adaptörü; Cron Trigger worker'ı.
3. Ürün editörüne: ilişkili ürünler, tedarikçi kodu/maliyet, varyanta özel görseller.
4. Müşteri tarafı: üye kaydı, parola sıfırlama, hesabım sipariş geçmişi/takip, favoriler, karşılaştırma, yorumlar; havale bildirimi formu.
5. Admin MFA (`ADMIN_MFA_ENFORCED`, `sessions.mfa_verified_at` hazır), e-Fatura/e-İrsaliye entegratörü, yasal metinler (KVKK, mesafeli satış, ön bilgilendirme sayfaları — checkout bunlara link veriyor, sayfalar yok).
6. Senaryo testlerini `tests/integration/`'a taşımak; Playwright ile uçtan uca test.

## 12. Devir notu

- GitHub: `https://github.com/ahancerli/nova-e-ticaret` (public, `main`). İlk commit teslim alınan hâli içerir.
- Belgeler: veri kuralları, durum geçişleri ve sözlükler `db/README.md`'de; iş kuralları `src/lib/order-rules.ts` ve `src/lib/product-rules.ts`'te tek yerde.

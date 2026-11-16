# Social AI Marketing modülü — görev tanımı

Bu dosya yeni bir oturumda bu modülü planlayıp yazacak ajan içindir. Önce bu dosyayı sonuna kadar oku. Ardından kodu incele, bir plan çıkar ve planı kullanıcıya onaylat. Kodlamaya ancak onaydan sonra başla.

## 1. Amaç

Ayrı bir panel yazılmayacak. Her şey **mevcut nova admin panelinin içinde**, yeni bir ana menü olarak yer alacak: **Social AI Marketing**. Altında iki menü bulunacak: **WhatsApp** ve **Instagram**.

Mağaza sahibi kanala ilk girdiğinde adım adım ilerleyen, mümkün olan en kullanıcı dostu bir kurulum ekranı görür. Kurulum **bir kez** yapılır. Sonrasında kanal, mağaza sahibi modülü kapatana kadar sürekli aktif kalır.

Aktif kanala gelen **bütün** mesajlara (Instagram DM'leri ve WhatsApp mesajları) AI otomatik olarak cevap verir:

- **Ürün sorusuysa:** Katalogdan ürünü bulur, stok, fiyat ve varyant bilgisini verir, ürün linkini gönderir.
- **Genel bir soruysa** (kargo, iade, ödeme, beden, mağaza bilgisi gibi): Sitenin içeriklerinden ve mağaza ayarlarından bakarak cevap verir.

Konuşma, mağazada çalışan bir insanın yazdığı kadar doğal olmalıdır.

Temel senaryo: Mağaza Instagram'da sponsorlu bir ürün paylaşır, insanlar da DM'den yazar. Bot hangi reklamdan ya da gönderiden gelindiğini bilir ve o ürünle konuşmaya başlar. Müşteriye soru sorar, birden fazla ürünü karşılaştırır, ürün linkleri gönderir, stok, fiyat ve kargo sorularını cevaplar. Gerektiğinde konuşmayı bir insana devreder.

## 2. Önce yapılacaklar (proje kuralları)

- `CLAUDE.md` ve `AGENTS.md` dosyalarına uy. Serena'da `initial_instructions` çağır, `core` hafızasını oku, oradan işaret edilen hafızalara geç.
- `README.md` içinde şu bölümleri oku: §4 mimari kuralları, §4.1 core/route, §4.2 modül yapısı, §6 admin UI kit.
- Bu Next.js sürümü alışık olduğundan farklı. Kod yazmadan önce `node_modules/next/dist/docs/` altındaki ilgili rehberi oku.
- Şema değişikliklerini `db/schema.sql` dosyasına yaz. Her tabloda `-- TABLO:` satırı, her kolonda Türkçe yorum bulunmalı. Değişiklikle birlikte `db/migrations/` altında `-- probe:` satırı olan bir migration da yaz. İş bitince şunları çalıştır: `npm run db:backup`, `npm run db:setup`, `npm run db:check` ("in sync" çıktısı görülmeli).
- UI işine başlamadan önce `frontend-design:frontend-design` skill'ini çağır.
- **`npm run build` çalıştırma.** Kullanıcının çalışan dev sunucusunu bozuyor. Gerekiyorsa önce sor.
- Mimari değiştiği için iş sonunda ilgili Serena hafızalarını (`core` vb.) güncelle ve hangilerini değiştirdiğini kullanıcıya bildir.
- `* 2.ts` / `* 2.tsx` gibi iCloud kopyalarına dokunma.

## 3. Mevcut yapıyla ilişki (tekrar yazma, yeniden kullan)

Kodda doğrula, sonra kullan:

- `src/modules/ai/`: Tek bir AI sağlayıcısı (OpenAI, Gemini veya Claude), anahtarı sealed olarak `ai_integration` tablosunda, model kataloğu `ai_models` tablosunda. Bot bu yapıyı kullanmalı. Mevcut `generate` metodu tool use (fonksiyon çağırma) desteklemiyorsa, bu desteği ai modülüne sağlayıcıdan bağımsız bir port olarak ekle.
- `src/modules/search/`: Meilisearch ile ürün arama. Botun `urun_ara` aracı bunun üzerine kurulacak.
- `src/modules/catalog/`, `pricing/`, `delivery/`, `orders/`: Stok, fiyat ("Sepette ₺X" dahil), tahmini teslim ve sipariş durumu bilgileri buradan okunacak.
- **Genel soruların bilgi kaynakları:**
  - `src/modules/content/`: Site sayfaları ve yasal şablonlar (kargo, iade, gizlilik vb.)
  - `src/modules/questions/`: Cevaplanmış, herkese açık ürün soruları
  - `size-charts/`: Beden tabloları
  - `delivery_settings`: Teslimat ayarları
  - Ürün açıklamaları ve özellikleri
- `src/app/(admin)/admin/layout.tsx`: Admin menüsü burada tanımlı. Yeni ana menü ve alt menüler buraya, mevcut yetki (`perm`) ve ikon düzenine uygun şekilde eklenecek.
- `src/modules/integrations/`, `marketplaces/`, `social-login/`: Bağlantı ve sealed secret saklama desenleri ile OAuth akışı için örnek al.
- `src/modules/notifications/`: Canlı desteğe devir bildirimleri için panel bildirimi.
- `src/modules/support/`: Destek modülünün ne yaptığına bak; devredilen konuşmalarla nasıl ilişkileneceğine karar ver.
- `src/modules/consent/` ve `iys/`: KVKK aydınlatma metni ve izin yapısı.
- `scripts/scheduler.mjs` ve `/api/cron/*`: 30 günlük silme işi gibi zamanlanmış görevler için.
- `outbox`: Dışarıya mesaj gönderimi için güvenilir teslim ve yeniden deneme mekanizması.

## 4. Mimari

```
Meta webhook ─► Kanal adaptörü (WhatsApp | Instagram) ─► Ortak mesaj formatı
                                                          │
                                   Konuşma servisi (UoW, kayıt, kilit/sıra)
                                                          │
                                LLM orkestratörü (ai modülü + araçlar)
                                                          │
                     Cevap ─► outbox ─► Kanal adaptörü ─► Meta Send API
```

- **Kanal bağımsız çekirdek:** Konuşma, mesaj, bot ayarları ve orkestratör tek bir yerde durur. Her kanal yalnızca bir adaptördür (`ChannelAdapter`: webhook doğrulama ve parse, gönderim, sınırlar). İleride web chat ya da Telegram eklemek sadece yeni bir adaptör yazmak olmalı.
- **Webhook:**
  - İmza doğrulaması: `X-Hub-Signature-256` ve app secret ile.
  - GET ile gelen verify-token doğrulaması.
  - Hızlı 200 dönüşü: işleme kuyruğa alınır.
  - Idempotency: Meta mesaj ID'sine unique kısıt konur, aynı mesaj iki kez işlenmez.
  - Aynı konuşmaya art arda gelen mesajlar sırayla işlenir. Kısa bir debounce süresinde birikip tek cevapla yanıtlanması tercih edilir; insanlar mesajlarını parça parça yazar.
- **LLM araçları** (ilk sürüm önerisi; isimler İngilizce olsun):
  - `search_products(query, filters)`: Birden fazla sonuç döner.
  - `get_product(id)`: Varyant, stok, fiyat ve link.
  - `send_product_links(ids)`: Linkleri kanal formatında gönderir. WhatsApp'ta ürün kartı ya da link önizlemesi kullanılabilir.
  - `search_store_content(query)`: Genel soruların cevabını sitenin içeriklerinde arar (bkz. §3 bilgi kaynakları). Bulamazsa model tahmin etmez; "kontrol edip dönelim" der ve gerekirse konuşmayı insana devreder.
  - `get_shipping_info()`
  - `get_order_status(orderNo, phone/email)`: Kimlik doğrulaması dikkatli yapılmalı; başkasının siparişi gösterilmemeli.
  - `handoff_to_human(reason)`
  - Model fiyat, stok, kargo ya da iade bilgisini **uydurmaz**. Bu bilgiler yalnızca araçlardan veya admin ayarlarından gelir.
- **Reklam ve gönderi referansı:** Click-to-DM ve Click-to-WhatsApp reklamlarında webhook'a gelen `referral` bilgisini (ad_id, gönderi ve kaynak) konuşmaya kaydet. Admin panelinde tanımlanan reklam veya gönderi → ürün/kampanya eşlemesiyle konuşmayı o ürünle başlat.
- **Mesajlaşma pencereleri:** 24 saat kuralı geçerli. Müşterinin son mesajından itibaren 24 saat serbest mesaj gönderilebilir, sonrasında WhatsApp'ta yalnızca onaylı şablon mesajlar kullanılabilir. Instagram'da insan desteğine devredilen konuşmalar için "human agent" etiketiyle süre 7 güne çıkar. Pencere dışına düşen gönderimleri engelle ve panelde görünür kıl.
- **Maliyet ve güvenlik:** Konuşma başına ve günlük token ya da mesaj limiti koy. Prompt injection'a karşı müşteri mesajı veri olarak ele alınmalı, talimat olarak değil. Araçlar yalnızca okuma yapar; sipariş oluşturmak veya iptal etmek ilk sürümün kapsamında değildir.

## 5. Admin panel (mevcut nova paneli içinde)

### 5.0 Menü yapısı

```
Social AI Marketing            (ana menü)
├── WhatsApp                   /admin/social-ai/whatsapp
├── Instagram                  /admin/social-ai/instagram
├── Konuşmalar                 (iki kanalın konuşmaları tek listede, kanal filtresiyle)
└── Bot ayarları               (iki kanalın ortak ayarları; kanal başına geçersiz kılınabilir)
```

URL'ler ve menü etiketleri projenin mevcut Türkçe URL düzenine göre netleştirilebilir.

Her kanal sayfasının iki hâli vardır:
- **Kurulmamış:** Kurulum sihirbazı (§5.1) gösterilir.
- **Kurulu:** Durum ekranı gösterilir: bağlı hesap, aktif/pasif anahtarı, bugünkü mesaj sayısı, son hatalar, "bağlantıyı kes". Kurulum ekranı bir daha görünmez.

### 5.1 Kurulum sihirbazı (en kullanıcı dostu hâliyle)

Hedef: Teknik bilgisi olmayan bir mağaza sahibi kurulumu birkaç dakikada, hiçbir token ya da ID kopyalamadan bitirebilmeli.

**Instagram:**
1. Ön koşul kontrol listesi. Örnek: "Instagram hesabın Business/Creator olmalı ve bir Facebook sayfasına bağlı olmalı." Bu adımları anlatan kısa görsel yardım da eklenir.
2. "Instagram ile bağlan" butonu: Facebook Login for Business (OAuth) penceresi açılır.
3. Birden fazla hesap varsa hesap seçimi yapılır.
4. Bağlantı test edilir ve webhook aboneliği otomatik açılır.
5. "Hazır" ekranı: "Kendi hesabından DM atıp dene" yönlendirmesi.

**WhatsApp:**
1. Ön koşul kontrol listesi: Meta Business hesabı ve WhatsApp'ta kullanılmayan bir numara.
2. "WhatsApp ile bağlan" butonu: Meta Embedded Signup açılır. WABA ve numara ID'si otomatik alınır.
3. Bağlantı test edilir ve webhook aboneliği otomatik açılır.
4. "Hazır" ekranı ve test mesajı.

**Ortak kurallar:**
- Token'lar sealed olarak saklanır.
- AI entegrasyonu (`ai_integration`) hazır değilse sihirbazın ilk adımı bunu bildirir ve ilgili sayfaya yönlendirir.
- Hatalar Türkçe ve ne yapılması gerektiğini söyleyen cümlelerle gösterilir.
- Yalnızca geliştirme/yedek amaçlı gizli bir "manuel bilgi gir" seçeneği olabilir.

**Kurulumdan sonra:**
- Kanal **kapatılana kadar aktif** kalır.
- Token süresi dolacaksa otomatik yenilenir; yenilenemiyorsa panelde bildirim çıkar.
- Bağlantı koparsa kanal durum ekranında ve panel bildirimlerinde uyarı gösterilir.

### 5.2 Bot ayarları
- Bot açık/kapalı (kanal başına) ve çalışma saatleri, saat dışında verilecek mesaj.
- **Marka sesi:** Hazır seçenekler (samimi, kurumsal, genç) ve serbest metin. Örnek soru-cevap çiftleri (few-shot) eklenebilir.
- **Karşılama/intro mesajı:** Kanal başına ayrı.
- **Kurallar:** Kargo, iade, ödeme ve kampanya bilgileri. Model bunları buradan okur.
- **Yasaklar:** Rakip markalardan bahsetmemek, pazarlık yapmamak, belirli konulara girmemek gibi.
- **Kampanya/reklam eşlemeleri:** Gönderi veya reklam → ürünler ve ek prompt. Örnek: "Bu reklamdan gelene %10 kodu ver."
- **Canlı desteğe devir kuralları:** Hangi durumlarda devredileceği, bildirimin kime gideceği. Devredildiğinde bot o konuşmada susar; panelden geri açılabilir.
- **Önizleme/test alanı:** Admin ayarları kaydetmeden önce botla panel içinden konuşup cevapları görebilir.

Ayarların hepsi hazır varsayılanlarla gelir. Kurulumdan hemen sonra, mağaza sahibi hiçbir ayara dokunmasa bile bot makul cevaplar verebilmeli.

### 5.3 Konuşmalar ekranı
- Kanal, tarih, durum (bot / devredildi / kapandı) ve reklam kaynağına göre filtrelenebilen liste. Konuşma detayında mesajlar ve hangi araçların çağrıldığı görünür.
- Devredilen konuşmaya admin panelden insan cevabı yazılabilir (24 saat ve human agent kurallarına uyarak).

## 6. Kurallar ve dürüstlük

- Ton doğal ve insan gibi olabilir. Ancak müşteri "bot musun / yapay zekâ mısın" diye açıkça sorarsa bot inkâr etmez. Meta'nın mesajlaşma politikaları ve yapay zekâ şeffaflığı mevzuatı bunu gerektiriyor. Bu kural sistem promptunda sabit olmalı ve admin tarafından kapatılamamalı.
- Kişisel veriler sadece sipariş durumu sorgulamak için ve en az ölçüde istenir.

## 7. Veri saklama: 30 gün

- Konuşmalar, mesajlar, araç çağrısı kayıtları ve referral bilgileri `created_at` ile saklanır.
- Zamanlanmış görev (scheduler + `/api/cron/...`) **her gün** 30 günden eski mesajları ve artık mesajı kalmamış konuşmaları **kalıcı olarak siler**. Sadece işaretleme yapılmaz, gerçekten silinir. Bu silme işlemi audit'e kaydedilir; kaydedilen bilgi yalnızca silinen satır sayısıdır, içerik değil.
- Panelde saklama süresi bilgi olarak gösterilir. KVKK aydınlatma metnine eklenecek cümle kullanıcıya önerilir.
- Testler: 30 günden eski kayıtların silindiği, yeni kayıtların silinmediği ve silmenin idempotent olduğu doğrulanmalı.

## 8. Planlamada kullanıcıya sorulacak açık kararlar

1. **Meta uygulaması kimin?** nova tek satıcılık bir uygulama ve her mağaza ayrı kuruluyor. İki seçenek var: (a) her mağaza kendi Meta uygulamasını açar, ya da (b) platform sahibinin tek bir Meta uygulaması (Tech Provider) kullanılır. (b) seçilirse Meta webhook'ları tek bir adrese gönderdiği için bunları doğru kuruluma yönlendiren merkezi bir router servisi gerekir. Bu karar mimariyi değiştirir; plan öncesinde sor.
2. AI sağlayıcı: Mevcut `ai_integration` mı kullanılacak, yoksa bu modül için ayrı bir model seçimi mi yapılacak?
3. İlk sürümde WhatsApp şablon mesajları (pencere dışı gönderim) olacak mı, yoksa sadece gelen mesajlara cevap mı verilecek?
4. Instagram gönderi yorumlarına otomatik cevap ilk sürüme girecek mi, yoksa sadece DM mi?

## 9. Dış API'ler

Meta Graph API, WhatsApp Cloud API, Instagram Messaging API ve Embedded Signup için **güncel resmi dokümana bakarak** ilerle; bellekteki bilgiye güvenme. Sürüm numaralarını, izin adlarını (scope) ve webhook alanlarını oradan doğrula ve kod yorumunda hangi tarihte kontrol ettiğini belirt (iyzico entegrasyonunda yapıldığı gibi). Canlıya çıkmak için App Review ve Tech Provider onayı gerektiğini kullanıcıya hatırlat; bu süreç haftalar sürebilir.

## 10. Teslim

- İş fazlara bölünsün, her fazın sonunda testler ve kısa bir özet olsun:
  1. Şema ve çekirdek
  2. AI tool use
  3. WhatsApp adaptörü
  4. Instagram adaptörü
  5. Admin bağlantı ekranları
  6. Ayarlar ve konuşmalar ekranları
  7. 30 günlük saklama görevi
- Gerçek Meta hesabı olmadan test edebilmek için webhook payload fixture'ları ve sahte bir gönderim adaptörü olsun.
- `README.md` dosyasına modül durumu ve API tablosu, Serena hafızalarına yeni modül eklensin.

import type { SidebarIcon } from "./AdminSidebar";

/**
 * The panel map: one place for the sidebar, the page info button in the top bar and the user guide
 * (/admin/kilavuz). Groups follow the jobs of a shop team (sell → catalog → marketing → customers → connections →
 * system), so pages that work together sit together. `info` is the one-sentence purpose shown to staff.
 */
export type NavLink = {
  type: "link";
  href: string;
  label: string;
  /** Required permission; leave out for pages every staff member sees. */
  perm?: string;
  icon: SidebarIcon;
  info: string;
};

export type NavNest = { type: "nest"; label: string; icon: SidebarIcon; info: string; children: NavLink[] };
export type NavEntry = NavLink | NavNest;
export type NavGroup = { title: string; tone: string; info: string; items: NavEntry[] };

const link = (href: string, label: string, icon: SidebarIcon, perm: string | undefined, info: string): NavLink => ({ type: "link", href, label, icon, perm, info });

export const NAV: NavGroup[] = [
  {
    title: "Genel bakış",
    tone: "var(--color-dept-5)",
    info: "Günün özeti ve sizi bekleyen işler.",
    items: [
      link("/admin", "Dashboard", "dashboard", "orders.read", "Ciro, sipariş sayısı, bekleyen işler ve biten stoklar tek ekranda. Güne buradan başlayın."),
      link("/admin/bildirimler", "Bildirimler", "notifications", undefined, "Yeni sipariş, onay bekleyen yorum, başarısız entegrasyon gibi olaylar. Hangi bildirimi alacağınızı buradan seçersiniz."),
    ],
  },
  {
    title: "Satış",
    tone: "var(--color-dept-1)",
    info: "Siparişin ödemeden teslimata ve iadeye kadar bütün yolu.",
    items: [
      link("/admin/siparisler", "Siparişler", "orders", "orders.read", "Gelen siparişleri hazırlayın, kargoya verin, teslim edin veya iptal edin. Havale onayı da sipariş detayında yapılır."),
      link("/admin/iadeler", "İadeler", "returns", "orders.read", "Müşterilerin iade taleplerini onaylayın veya reddedin. Onaylanan iade para iadesini başlatır."),
      link("/admin/faturalar", "Faturalar", "invoices", "orders.read", "Siparişlere kesilen faturalar. e-Fatura entegrasyonu açıksa fatura buradan entegratöre gönderilir."),
      {
        type: "nest", label: "Ödeme ve teslimat", icon: "payments",
        info: "Müşterinin ödeme adımında gördüğü seçenekler.",
        children: [
          link("/admin/odemeler", "Ödeme yöntemleri", "payments", "payments.secrets", "iyzico (kart), havale / EFT hesapları ve kapıda ödeme. Açık olan yöntemler ödeme adımında görünür."),
          link("/admin/kargo-ucretleri", "Kargo ücretleri", "shipping", "settings.write", "Kargo seçenekleri, ücretleri, ücretsiz kargo eşiği ve ürün sayfasındaki tahmini teslim tarihi kuralları."),
        ],
      },
    ],
  },
  {
    title: "Katalog",
    tone: "var(--color-dept-3)",
    info: "Sattığınız her şey: ürünler ve onları düzenleyen yapı.",
    items: [
      link("/admin/urunler", "Ürünler", "products", "catalog.read", "Ürün ekleyin, fiyat ve stok girin, varyant (renk, beden) tanımlayın, yayına alın."),
      {
        type: "nest", label: "Ürün yapısı", icon: "categories",
        info: "Ürün eklemeden önce hazır olması gereken tanımlar.",
        children: [
          link("/admin/kategoriler", "Kategoriler", "categories", "catalog.write", "Mağaza menüsünü oluşturan kategori ağacı. Her ürün bir ana kategoriye bağlanır."),
          link("/admin/markalar", "Markalar", "brands", "catalog.write", "Marka adı, logo ve marka sayfası görseli."),
          link("/admin/ozellikler", "Özellikler ve varyantlar", "categories", "catalog.write", "Renk, beden gibi varyant eksenleri ve materyal, kapasite gibi teknik özellikler. Filtreler de bunlardan oluşur."),
          link("/admin/beden-tablolari", "Beden tabloları", "categories", "catalog.write", "Ürün sayfasında beden seçiminin yanında açılan ölçü tabloları. Kategoriye veya tek ürüne bağlanır."),
        ],
      },
      link("/admin/toplu-islemler", "Toplu işlemler", "bulk", "catalog.write", "Excel dosyası veya XML / REST akışıyla çok sayıda ürünü, fiyatı, stoğu ve görseli tek seferde güncelleyin."),
      link("/admin/arama", "Mağaza araması", "search", "catalog.write", "Müşterilerin ne aradığını görün, eş anlamlı kelime tanımlayın, arama dizinini yenileyin."),
    ],
  },
  {
    title: "Pazarlama",
    tone: "var(--color-dept-2)",
    info: "Mağazanın ön yüzü, indirimler ve müşteriye ulaşan kanallar.",
    items: [
      link("/admin/kampanyalar", "Kampanyalar ve kuponlar", "campaigns", "campaigns.write", "İndirim kuralları (yüzde, 3 al 2 öde, sepette indirim) ve kupon kodları. Çakışma kuralları da buradadır."),
      link("/admin/vitrin", "Vitrin", "showcase", "storefront.write", "Ana sayfa: slider, hikayeler, ürün blokları ve üst menü. Yayınlamadan önce önizleyebilirsiniz."),
      link("/admin/icerik", "İçerik sayfaları", "content", "content.write", "Sözleşmeler, KVKK metni, hakkımızda ve yardım sayfaları. Yasal metinler sürüm numarasıyla saklanır."),
      link("/admin/e-bulten", "E-bülten", "newsletter", "customers.read", "Bültene kayıt olan adresler. Listeyi dışa aktarıp e-posta aracınızda kullanabilirsiniz."),
      {
        type: "nest", label: "Social AI Marketing", icon: "social",
        info: "WhatsApp ve Instagram mesajlarını yapay zekâ yanıtlar, gerektiğinde size devreder.",
        children: [
          link("/admin/social-ai/konusmalar", "Konuşmalar", "social", "social_ai.chat", "Müşterilerle WhatsApp ve Instagram konuşmaları. Botun size devrettiği konuşmaları buradan yanıtlarsınız."),
          link("/admin/social-ai/whatsapp", "WhatsApp bağlantısı", "social", "social_ai.manage", "WhatsApp Business numaranızı bağlayın."),
          link("/admin/social-ai/instagram", "Instagram bağlantısı", "social", "social_ai.manage", "Instagram işletme hesabınızı bağlayın."),
          link("/admin/social-ai/bot-ayarlari", "Bot ayarları", "social", "social_ai.manage", "Botun üslubu, çalışma saatleri, hangi durumda insana devredeceği ve reklam eşlemeleri."),
        ],
      },
    ],
  },
  {
    title: "Müşteriler",
    tone: "var(--color-dept-6)",
    info: "Üyeler ve onlardan gelen her ses.",
    items: [
      link("/admin/musteriler", "Müşteriler", "customers", "customers.read", "Üye listesi, sipariş geçmişi ve adresler. Hesabı askıya alabilir, şifre sıfırlama bağlantısı üretebilirsiniz."),
      {
        type: "nest", label: "Müşteri iletişimi", icon: "reviews",
        info: "Müşterilerin yazdığı ve yanıt bekleyen her şey.",
        children: [
          link("/admin/yorumlar", "Ürün yorumları", "reviews", "reviews.moderate", "Yorumları onaylayın, reddedin veya mağaza adına yanıtlayın. Yalnızca onaylanan yorum mağazada görünür."),
          link("/admin/sorular", "Ürün soruları", "reviews", "reviews.moderate", "Ürün sayfasından sorulan sorular. Yanıtladığınızda soru yayınlanır ve müşteriye e-posta gider."),
          link("/admin/canli-destek", "Canlı destek", "support", "support.chat", "Üyelerin mağazadan yazdığı anlık mesajlar."),
        ],
      },
    ],
  },
  {
    title: "Entegrasyonlar",
    tone: "var(--color-dept-4)",
    info: "Mağazanın bağlandığı dış servisler.",
    items: [
      {
        type: "nest", label: "Satış ve operasyon", icon: "integrations",
        info: "Siparişin dışarıdaki ayakları: pazaryeri, kargo firması, fatura.",
        children: [
          link("/admin/entegrasyonlar/pazaryerleri", "Pazaryerleri", "integrations", "integrations.write", "Trendyol mağazanızı bağlayın: ürünler oraya gönderilir, siparişler buraya düşer, stok ve fiyat eşitlenir."),
          link("/admin/entegrasyonlar/kargo", "Kargo firmaları", "shipping", "integrations.write", "Kargo firması hesabı. Bağlıyken gönderi kaydı ve takip numarası otomatik oluşur."),
          link("/admin/entegrasyonlar/e-fatura", "e-Fatura / e-Arşiv", "invoices", "integrations.write", "Fatura entegratörü (Paraşüt). Açıkken faturalar ödeme veya kargo anında otomatik kesilir."),
        ],
      },
      {
        type: "nest", label: "İletişim kanalları", icon: "newsletter",
        info: "Müşteriye giden e-posta ve SMS'in altyapısı.",
        children: [
          link("/admin/entegrasyonlar/e-posta", "E-posta (SMTP)", "newsletter", "integrations.write", "Sipariş, şifre sıfırlama ve bildirim e-postalarının gönderildiği hesap. Son gönderimleri de burada görürsünüz."),
          link("/admin/entegrasyonlar/sms", "SMS", "integrations", "integrations.write", "Sipariş durumu SMS'leri için sağlayıcı hesabı."),
          link("/admin/entegrasyonlar/iys", "İYS izinleri", "integrations", "integrations.write", "Ticari ileti izinleri İleti Yönetim Sistemi'ne otomatik bildirilir. Yasal zorunluluktur."),
        ],
      },
      {
        type: "nest", label: "Yapay zekâ ve izleme", icon: "social",
        info: "AI sağlayıcısı ve ziyaretçi ölçümü.",
        children: [
          link("/admin/entegrasyonlar/ai", "Yapay zekâ", "social", "integrations.write", "AI sağlayıcısı ve modeli (OpenAI, Gemini, Claude). Ürün metni üretimi ve Social AI Marketing bunu kullanır."),
          link("/admin/entegrasyonlar/cerez-onayi", "Çerez onayı ve izleme", "integrations", "integrations.write", "KVKK çerez bandı ile Google Analytics, Meta, TikTok gibi izleme kodları. Kodlar yalnızca izin verilince çalışır."),
        ],
      },
    ],
  },
  {
    title: "Sistem",
    tone: "#94a3b8",
    info: "Ekip, yetkiler ve mağazanın genel ayarları.",
    items: [
      {
        type: "nest", label: "Ekip ve yetkiler", icon: "users",
        info: "Panele kimin girebileceği ve neyi görebileceği.",
        children: [
          link("/admin/kullanicilar", "Kullanıcılar", "users", "users.manage", "Panel kullanıcılarını davet edin, rol atayın, askıya alın. Davet edilen kişi kendi parolasını belirler."),
          link("/admin/kullanicilar/roller", "Roller ve yetkiler", "users", "users.manage", "Hazır roller (Ürün, Sipariş, Reklam ve Pazarlama, Yönetici) ve kendi oluşturacağınız roller. Bir rol hangi modülleri açar, burada belirlenir."),
        ],
      },
      {
        type: "nest", label: "Mağaza ayarları", icon: "settings",
        info: "Mağazanın kimliği ve giriş güvenliği.",
        children: [
          link("/admin/ayarlar", "Site ayarları", "settings", "settings.write", "Firma bilgileri, logo, marka rengi, SEO ve footer."),
          link("/admin/ayarlar/sosyal-giris", "Google ile giriş", "settings", "settings.write", "Müşterilerin Google hesabıyla üye olup giriş yapması."),
          link("/admin/ayarlar/bot-korumasi", "Bot koruması", "settings", "settings.write", "Üyelik, giriş ve yorum formlarını botlara karşı koruyan doğrulama (Turnstile / reCAPTCHA)."),
        ],
      },
      link("/admin/denetim", "Denetim kayıtları", "audit", "audit.read", "Panelde kim, neyi, ne zaman değiştirdi. Kayıtlar silinemez."),
      link("/admin/kilavuz", "Kullanım kılavuzu", "guide", undefined, "Panelin bütün bölümleri ve sık yapılan işlerin adım adım anlatımı."),
    ],
  },
];

export const linksOf = (entry: NavEntry): NavLink[] => (entry.type === "link" ? [entry] : entry.children);

/** The groups a staff member may see: links without the permission drop out, empty nests and groups too. */
export function visibleNav(has: (perm: string) => boolean): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const group of NAV) {
    const items: NavEntry[] = [];
    for (const item of group.items) {
      if (item.type === "link") {
        if (!item.perm || has(item.perm)) items.push(item);
        continue;
      }
      const children = item.children.filter((c) => !c.perm || has(c.perm));
      if (children.length > 0) items.push({ ...item, children });
    }
    if (items.length > 0) groups.push({ ...group, items });
  }
  return groups;
}

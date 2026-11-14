/**
 * Permission catalogue for the role editor: every permission code the code base checks, grouped and labelled.
 * The `permissions` table holds the same codes (seed); a role can only be given codes listed here.
 */
export interface PermissionDef {
  code: string;
  label: string;
  description: string;
  /** Sensitive: shown with a warning in the role editor. */
  sensitive?: boolean;
}

export const PERMISSION_GROUPS: { key: string; label: string; permissions: PermissionDef[] }[] = [
  {
    key: "orders", label: "Siparişler ve müşteriler", permissions: [
      { code: "orders.read", label: "Siparişleri görüntüleme", description: "Sipariş listesi, detay ve gösterge paneli." },
      { code: "orders.write", label: "Sipariş işlemleri", description: "Hazırlama, kargo, teslim, iptal ve iade." },
      { code: "payments.reconcile", label: "Havale onayı", description: "Gelen havaleyi siparişle eşleştirme." },
      { code: "customers.read", label: "Müşteri bilgilerini görme", description: "Ad, e-posta, telefon ve adresler maskesiz görünür.", sensitive: true },
      { code: "customers.write", label: "Müşteri hesaplarını yönetme", description: "Düzenleme, askıya alma, şifre sıfırlama bağlantısı.", sensitive: true },
    ],
  },
  {
    key: "catalog", label: "Katalog ve vitrin", permissions: [
      { code: "catalog.read", label: "Kataloğu görüntüleme", description: "Ürün listesi ve stok durumu." },
      { code: "catalog.write", label: "Katalog düzenleme", description: "Ürün, varyant, kategori, marka ve görseller." },
      { code: "catalog.publish", label: "Ürün yayınlama", description: "Ürünü mağazada yayına alma." },
      { code: "storefront.write", label: "Vitrin", description: "Slider, hikaye ve ana sayfa blokları." },
      { code: "campaigns.write", label: "Kampanya ve kupon", description: "İndirim kuralları ve kuponlar." },
      { code: "content.write", label: "İçerik yönetimi", description: "Yasal metinler, kurumsal ve yardım sayfaları." },
      { code: "reviews.moderate", label: "Ürün yorumları", description: "Yorumları yayınlama / reddetme, mağaza yanıtı, müşteriyle iletişim, yorum ayarları." },
      { code: "support.chat", label: "Canlı destek", description: "Üyelerin canlı destek mesajlarını görme ve yanıtlama, konuşma kapatma." },
    ],
  },
  {
    key: "system", label: "Yönetim", permissions: [
      { code: "settings.write", label: "Site ayarları", description: "Firma bilgileri, logo, SEO, footer." },
      { code: "integrations.write", label: "Entegrasyonlar", description: "Kargo, SMS ve e-posta sağlayıcıları." },
      { code: "payments.secrets", label: "Ödeme anahtarları", description: "iyzico anahtarları ve IBAN.", sensitive: true },
      { code: "users.manage", label: "Kullanıcı ve rol yönetimi", description: "Personel daveti, rol atama, askıya alma.", sensitive: true },
      { code: "audit.read", label: "Denetim kayıtları", description: "Kim neyi ne zaman değiştirdi." },
    ],
  },
];

export const PERMISSION_CODES: readonly string[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.code));
export const isPermissionCode = (v: string) => PERMISSION_CODES.includes(v);

/** Roles with fixed meaning. */
export const ADMIN_ROLE = "admin";
export const CUSTOMER_ROLE = "customer";
/** The permission that manages users — at least one active staff member must keep it. */
export const MANAGE_USERS = "users.manage";

/**
 * Site configuration registry: every setting the shop has, its group, type, visibility and validation limits.
 * The table (site_settings) only stores values; a key that is not listed here can be neither read through the
 * typed API nor written from the admin panel.
 */

export const SETTING_GROUPS = {
  general: { label: "Genel", description: "Mağaza adı, slogan ve duyuru şeridi" },
  company: { label: "Firma bilgileri", description: "Yasal metinlerde ve footer'da kullanılan resmî bilgiler" },
  contact: { label: "İletişim", description: "Müşterilerin size ulaşacağı kanallar" },
  branding: { label: "Marka ve logo", description: "Logo, favicon ve vurgu rengi" },
  seo: { label: "SEO", description: "Arama motorları ve sosyal paylaşım varsayılanları" },
  social: { label: "Sosyal medya", description: "Footer'da gösterilen hesaplar" },
  footer: { label: "Footer", description: "Telif satırı, güven rozetleri ve ödeme notu" },
} as const;

export type SettingGroup = keyof typeof SETTING_GROUPS;
export const SETTING_GROUP_KEYS = Object.keys(SETTING_GROUPS) as SettingGroup[];
export const isSettingGroup = (v: unknown): v is SettingGroup => typeof v === "string" && Object.hasOwn(SETTING_GROUPS, v);

export type SettingType =
  | "text" | "textarea" | "email" | "phone" | "url" | "image" | "boolean" | "color" | "link" | "list" | "digits";

export interface SettingDef {
  key: string;
  group: SettingGroup;
  label: string;
  type: SettingType;
  /** Readable by the storefront (header, footer, legal templates, metadata). */
  public: boolean;
  required?: boolean;
  max?: number;
  /** For "digits": exact allowed lengths (VKN 10, TCKN 11, MERSİS 16). */
  lengths?: number[];
  help?: string;
  placeholder?: string;
  /** Name of the {{placeholder}} that legal / content templates can use for this value. */
  templateVar?: string;
}

export const SETTINGS: readonly SettingDef[] = [
  // general
  { key: "site.name", group: "general", label: "Mağaza adı", type: "text", public: true, required: true, max: 60, templateVar: "site.adi", placeholder: "nova." },
  { key: "site.tagline", group: "general", label: "Slogan", type: "text", public: true, max: 160, help: "Footer'da logonun altında görünür." },
  { key: "site.announcement", group: "general", label: "Duyuru şeridi", type: "link", public: true, max: 160, help: "Header'ın üstündeki ince şerit. Boş bırakılırsa gösterilmez." },

  // company (legal identity)
  { key: "company.legal_name", group: "company", label: "Ticari unvan", type: "text", public: true, required: true, max: 200, templateVar: "firma.unvan", placeholder: "Nova E-Ticaret A.Ş." },
  { key: "company.address", group: "company", label: "Merkez adresi", type: "textarea", public: true, required: true, max: 500, templateVar: "firma.adres" },
  { key: "company.tax_office", group: "company", label: "Vergi dairesi", type: "text", public: true, max: 80, templateVar: "firma.vergi_dairesi" },
  { key: "company.tax_number", group: "company", label: "Vergi kimlik no (VKN)", type: "digits", lengths: [10, 11], public: true, templateVar: "firma.vergi_no", help: "Şahıs şirketlerinde 11 haneli TCKN." },
  { key: "company.mersis_no", group: "company", label: "MERSİS no", type: "digits", lengths: [16], public: true, templateVar: "firma.mersis_no" },
  { key: "company.trade_registry_no", group: "company", label: "Ticaret sicil no", type: "text", public: true, max: 40, templateVar: "firma.ticaret_sicil_no" },
  { key: "company.kep_address", group: "company", label: "KEP adresi", type: "email", public: true, max: 120, templateVar: "firma.kep" },
  { key: "company.data_controller_contact", group: "company", label: "KVKK başvuru e-postası", type: "email", public: true, max: 120, templateVar: "firma.kvkk_eposta", help: "Aydınlatma metninde veri sahibi başvuruları için." },

  // contact
  { key: "contact.email", group: "contact", label: "Destek e-postası", type: "email", public: true, required: true, max: 120, templateVar: "iletisim.eposta" },
  { key: "contact.phone", group: "contact", label: "Destek telefonu", type: "phone", public: true, max: 30, templateVar: "iletisim.telefon", placeholder: "+90 212 000 00 00" },
  { key: "contact.whatsapp", group: "contact", label: "WhatsApp hattı", type: "phone", public: true, max: 30 },
  { key: "contact.hours", group: "contact", label: "Çalışma saatleri", type: "text", public: true, max: 120, templateVar: "iletisim.calisma_saatleri", placeholder: "Hafta içi 09:00–18:00" },

  // branding
  { key: "branding.logo_media_id", group: "branding", label: "Logo", type: "image", public: true, help: "Yatay logo; şeffaf PNG veya WebP önerilir. Boşsa mağaza adı yazı olarak gösterilir." },
  { key: "branding.favicon_media_id", group: "branding", label: "Favicon", type: "image", public: true, help: "Kare, en az 192×192 piksel." },
  { key: "branding.accent_color", group: "branding", label: "Vurgu rengi", type: "color", public: true, help: "Butonlar, fiyat vurguları ve bağlantılar." },

  // seo
  { key: "seo.default_title", group: "seo", label: "Ana sayfa başlığı", type: "text", public: true, required: true, max: 70 },
  { key: "seo.title_template", group: "seo", label: "Sayfa başlığı şablonu", type: "text", public: true, max: 70, help: "%s sayfanın adıyla değiştirilir. Örnek: %s | nova." },
  { key: "seo.default_description", group: "seo", label: "Varsayılan açıklama", type: "textarea", public: true, max: 160 },
  { key: "seo.og_image_media_id", group: "seo", label: "Paylaşım görseli", type: "image", public: true, help: "Sosyal medyada link paylaşılınca görünen görsel (1200×630 önerilir)." },
  { key: "seo.allow_indexing", group: "seo", label: "Arama motorları siteyi dizinleyebilir", type: "boolean", public: true, help: "Kapalıyken tüm sayfalar noindex olur (yayın öncesi için)." },
  { key: "seo.google_verification", group: "seo", label: "Google Search Console doğrulama kodu", type: "text", public: true, max: 100 },

  // social
  { key: "social.instagram", group: "social", label: "Instagram", type: "url", public: true, max: 300 },
  { key: "social.facebook", group: "social", label: "Facebook", type: "url", public: true, max: 300 },
  { key: "social.x", group: "social", label: "X (Twitter)", type: "url", public: true, max: 300 },
  { key: "social.youtube", group: "social", label: "YouTube", type: "url", public: true, max: 300 },
  { key: "social.tiktok", group: "social", label: "TikTok", type: "url", public: true, max: 300 },
  { key: "social.linkedin", group: "social", label: "LinkedIn", type: "url", public: true, max: 300 },

  // footer
  { key: "footer.copyright", group: "footer", label: "Telif satırı", type: "text", public: true, max: 160, help: "{{yil}} içinde bulunulan yılla değiştirilir." },
  { key: "footer.trust_badges", group: "footer", label: "Güven rozetleri", type: "list", public: true, max: 40, help: "Footer'ın üst şeridindeki kısa vaatler (en fazla 4)." },
  { key: "footer.payment_note", group: "footer", label: "Ödeme notu", type: "text", public: true, max: 120, placeholder: "iyzico · Havale / EFT · TL" },
] as const;

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDef> = new Map(SETTINGS.map((s) => [s.key, s]));
export const settingsOfGroup = (group: SettingGroup) => SETTINGS.filter((s) => s.group === group);
export const MAX_LIST_ITEMS = 4;

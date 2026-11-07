import { ConflictError, NotFoundError, ValidationError } from "@/core";

/** Catalog error catalogue: one place for codes and Turkish messages. */
export const CatalogErrors = {
  categoryNotFound: () => new NotFoundError("category_not_found", "Kategori bulunamadı."),
  invalidParent: (message = "Üst kategori bulunamadı.") => ValidationError.field("parentId", message, "invalid_parent"),
  categoryCycle: () => ValidationError.field("parentId", "Alt kategorilerden biri üst kategori olamaz.", "category_cycle"),
  categoryHasChildren: () => new ConflictError("category_has_children", "Önce alt kategorileri taşıyın veya silin."),
  categoryHasProducts: () => new ConflictError("category_has_products", "Bu kategoriye bağlı ürünler var, önce ilişkiyi kaldırın."),
  categoryChanged: () => new ConflictError("category_changed", "Kategori bu sırada değişti. Sayfayı yenileyip tekrar deneyin."),

  brandNotFound: () => new NotFoundError("brand_not_found", "Marka bulunamadı."),
  brandHasProducts: (n: number) => new ConflictError("brand_has_products", `Bu markaya bağlı ${n} ürün var. Önce ürünleri başka markaya taşıyın.`),
  brandHasStories: () => new ConflictError("brand_has_stories", "Bu marka ana sayfa hikayelerinde kullanılıyor. Önce hikayeleri kaldırın."),
  brandChanged: () => new ConflictError("brand_changed", "Marka bu sırada değişti. Sayfayı yenileyip tekrar deneyin."),

  slugTaken: (entity: "kategoride" | "markada") =>
    new ConflictError("slug_taken", `Bu slug başka bir ${entity} kullanılıyor.`, { fieldErrors: { slug: ["Bu slug zaten kullanılıyor."] } }),
};

export const ProductErrors = {
  notFound: () => new NotFoundError("product_not_found", "Ürün bulunamadı."),
  hasHistory: () => new ConflictError("product_has_history", "Bu ürünün sipariş veya stok geçmişi var; silinemez. Durumunu “Arşivlendi” yapın."),
  changedMeanwhile: () => new ConflictError("product_changed", "Ürün siz düzenlerken başka biri tarafından güncellendi. Sayfayı yenileyip değişikliklerinizi tekrar yapın."),
  stockChangedMeanwhile: (sku: string) =>
    new ConflictError("stock_changed", `${sku} stoğu bu sırada değişti (satış veya başka bir güncelleme). Sayfayı yenileyip güncel stokla tekrar deneyin.`),
  variantGainedHistory: (sku: string) =>
    new ConflictError("variant_has_history", `${sku} varyantı bu sırada sipariş/stok geçmişi kazandı ve silinemez. Sayfayı yenileyin.`),
};

export const AttributeErrors = {
  notFound: () => new NotFoundError("attribute_not_found", "Özellik bulunamadı."),
  optionNotFound: () => new NotFoundError("attribute_option_not_found", "Değer bulunamadı."),
  invalid: (fieldErrors: Record<string, string>) =>
    new ValidationError("invalid_attribute", Object.values(fieldErrors)[0] ?? "Özellik geçersiz.", { fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, [v]])) }),
  codeTaken: (code: string) => new ConflictError("attribute_code_taken", `“${code}” kodlu bir özellik zaten var.`, { fieldErrors: { code: ["Bu kod kullanılıyor."] } }),
  valueTaken: (label: string) => new ConflictError("attribute_value_taken", `“${label}” değeri bu özellikte zaten var.`, { fieldErrors: { label: ["Bu değer zaten var."] } }),
  inUse: (n: number) => new ConflictError("attribute_in_use", `Bu özellik ${n} üründe kullanılıyor; silinemez. Ürünlerden kaldırın veya filtreden gizleyin.`),
  typeLocked: () => ValidationError.field("dataType", "Ürünlerde kullanılan bir özelliğin tipi veya varyant ekseni değiştirilemez.", "attribute_type_locked"),
  optionInUse: () => new ConflictError("attribute_option_in_use", "Bu değer ürünlerde kullanılıyor; silinemez. Pasif yapabilirsiniz (yeni varyantlarda çıkmaz)."),
  unknownCategory: () => ValidationError.field("categories", "Seçilen kategorilerden biri bulunamadı.", "unknown_category"),
  barcodePrefix: () => ValidationError.field("prefix", "Önek 3–10 haneli bir sayı olmalı.", "invalid_barcode_prefix"),
};


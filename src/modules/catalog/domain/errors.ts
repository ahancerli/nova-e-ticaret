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

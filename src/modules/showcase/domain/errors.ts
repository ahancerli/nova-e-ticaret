import { ConflictError, NotFoundError, ValidationError } from "@/core";

/** Showcase error catalogue. */
export const ShowcaseErrors = {
  invalid: (fieldErrors: Record<string, string>) =>
    new ValidationError("invalid_section", Object.values(fieldErrors)[0] ?? "Geçersiz.", { fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, [v]])) }),
  sectionNotFound: () => new NotFoundError("section_not_found", "Bölüm bulunamadı."),
  typeLocked: () => ValidationError.field("type", "Bölüm türü değiştirilemez; yeni bölüm ekleyin.", "section_type_locked"),
  orderMismatch: () => new ConflictError("order_changed", "Liste bu sırada değişti. Sayfayı yenileyip tekrar sıralayın."),
  changedMeanwhile: () => new ConflictError("section_changed", "Bu kayıt siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  unknownRef: (field: string) => ValidationError.field(field, "Seçilen kayıtlardan biri bulunamadı.", "unknown_reference"),
  sliderNotFound: () => new NotFoundError("slider_not_found", "Slider bulunamadı."),
  slideNotFound: () => new NotFoundError("slide_not_found", "Slayt bulunamadı."),
  inUse: (what: string, n: number) => new ConflictError("in_use", `Bu ${what} ${n} ana sayfa bölümünde kullanılıyor. Önce bölümü kaldırın veya başka ${what} seçin.`),
  collectionNotFound: () => new NotFoundError("collection_not_found", "Hikaye koleksiyonu bulunamadı."),
  storyNotFound: () => new NotFoundError("story_not_found", "Hikaye bulunamadı."),
  framesRequired: () => ValidationError.field("frames", "Hikayeye en az bir görsel ekleyin.", "frames_required"),
};

import { ConflictError, NotFoundError, ValidationError } from "@/core";

/** Content error catalogue. */
export const ContentErrors = {
  notFound: () => new NotFoundError("page_not_found", "Sayfa bulunamadı."),
  slugTaken: () => new ConflictError("slug_taken", "Bu adres başka bir sayfada kullanılıyor.", { fieldErrors: { slug: ["Bu adres zaten kullanılıyor."] } }),
  legalTypeTaken: (label: string) =>
    new ConflictError("legal_type_taken", `“${label}” için zaten bir sayfa var. Aynı türden yalnız bir aktif sayfa olabilir.`, { fieldErrors: { legalType: ["Bu türde aktif bir sayfa zaten var."] } }),
  legalTypeRequired: () => ValidationError.field("legalType", "Yasal metin türünü seçin.", "legal_type_required"),
  legalTypeOnlyForLegal: () => ValidationError.field("legalType", "Yasal metin türü yalnız “Yasal metin” sayfalarında seçilir.", "legal_type_not_allowed"),
  emptyBody: () => ValidationError.field("bodyHtml", "Sayfa içeriği boş olamaz.", "empty_body"),
  changedMeanwhile: () => new ConflictError("page_changed", "Sayfa siz düzenlerken başka biri tarafından güncellendi. Sayfayı yenileyip değişikliklerinizi tekrar yapın."),
  publishedLegalCannotBeDeleted: () =>
    new ConflictError("legal_page_published", "Yayınlanmış bir yasal metin silinemez (müşteri onayları bu sürüme bağlı). Durumunu “Arşivde” yapın."),
};

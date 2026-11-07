import { ConflictError, NotFoundError, ValidationError } from "@/core";

/** Campaign / coupon error catalogue. */
export const CampaignErrors = {
  notFound: () => new NotFoundError("campaign_not_found", "Kampanya bulunamadı."),
  invalid: (fieldErrors: Record<string, string>) =>
    new ValidationError("invalid_campaign", Object.values(fieldErrors)[0] ?? "Kampanya geçersiz.", { fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, [v]])) }),
  changedMeanwhile: () => new ConflictError("campaign_changed", "Kampanya siz düzenlerken başka biri tarafından güncellendi. Sayfayı yenileyip tekrar deneyin."),
  hasOrders: () => new ConflictError("campaign_has_orders", "Bu kampanya siparişlerde kullanıldı; silinemez. Pasif yapın ya da bitiş tarihi verin."),
  unknownTarget: () => ValidationError.field("targets", "Seçilen ürün, marka veya kategorilerden biri bulunamadı.", "unknown_target"),
  unknownCondition: () => ValidationError.field("conditions", "Koşuldaki ürün, marka veya kategorilerden biri bulunamadı.", "unknown_condition"),
  policyChanged: () => new ConflictError("pricing_policy_changed", "Kampanya kuralları siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  couponNotFound: () => new NotFoundError("coupon_not_found", "Kupon bulunamadı."),
  couponCodeInvalid: () => ValidationError.field("code", "Kupon kodu 3–40 karakter; harf, rakam ve tire içerebilir.", "coupon_code_invalid"),
  couponCodeTaken: (code: string) => new ConflictError("coupon_code_taken", `“${code}” kodu zaten kullanılıyor.`, { fieldErrors: { code: ["Bu kod kullanılıyor."] } }),
  couponUsed: () => new ConflictError("coupon_used", "Bu kupon kullanıldı; silinemez. Pasif yapabilirsiniz."),
};

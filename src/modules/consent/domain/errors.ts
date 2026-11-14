import { ConflictError, NotFoundError, ValidationError } from "@/core";

export const ConsentErrors = {
  changedMeanwhile: () => new ConflictError("consent_settings_changed", "Çerez onayı ayarları siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  tagChangedMeanwhile: () => new ConflictError("tracking_tag_changed", "Etiket siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  providerNotIntegrated: (name: string) =>
    new ConflictError("provider_not_integrated", `${name} için entegrasyon henüz yapılmadı. Bu firmayla çalışmak için yazılım firmanıza (geliştirici ekibe) bilgi verin.`),
  tagNotFound: () => new NotFoundError("tracking_tag_not_found", "Etiket bulunamadı."),
  invalidConfig: (fieldErrors: Record<string, string[]>) => new ValidationError("validation_error", "Bilgileri kontrol edin.", { fieldErrors }),
};

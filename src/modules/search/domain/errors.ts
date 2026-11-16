import { ConflictError, ExternalServiceError, NotFoundError, ValidationError } from "@/core";

const field = (name: string, message: string) => new ValidationError("validation_error", message, { fieldErrors: { [name]: [message] } });

export const SearchErrors = {
  notConfigured: () => new ConflictError("search_engine_not_configured", "Arama motoru yapılandırılmamış. Sunucuda MEILI_URL tanımlı değil; arama şu an veritabanı üzerinden çalışıyor."),
  syncFailed: (reason: string) => new ExternalServiceError("search_sync_failed", "Arama dizini güncellenemedi. Arama motorunun çalıştığını kontrol edip tekrar deneyin.", { details: { reason } }),
  busy: () => new ConflictError("search_sync_busy", "Dizin şu anda zaten güncelleniyor. Birazdan tekrar bakın."),
  synonymNotFound: () => new NotFoundError("synonym_not_found", "Eş anlamlı kaydı bulunamadı."),
  termNotFound: () => new NotFoundError("search_term_not_found", "Arama terimi bulunamadı."),
  wordsRequired: (min: number) => field("words", min > 1 ? "En az iki kelime girin; birbirinin yerine geçecek kelimeleri virgülle ayırın." : "En az bir karşılık girin."),
  termRequired: () => field("term", "Aranan kelimeyi girin."),
  tooManyRules: (max: number) => new ConflictError("synonym_limit", `En fazla ${max} eş anlamlı kaydı tutulabilir. Kullanılmayanları silin.`),
};

import { ConflictError, NotFoundError, ValidationError } from "@/core";

/** Live support error catalogue. */
export const SupportErrors = {
  disabled: () => new ConflictError("support_disabled", "Canlı destek şu an kapalı."),
  notFound: () => new NotFoundError("support_conversation_not_found", "Konuşma bulunamadı."),
  closed: () => new ConflictError("support_conversation_closed", "Bu konuşma kapatıldı. Yeni mesajınız yeni bir konuşma başlatır."),
  empty: () => ValidationError.field("body", "Mesaj boş olamaz.", "support_message_empty"),
  customerHasOpen: () => new ConflictError("support_customer_has_open", "Müşterinin açık başka bir konuşması var; önce onu kapatın."),
  statusChanged: () => new ConflictError("support_conversation_changed", "Konuşma bu sırada güncellendi. Listeyi yenileyip tekrar deneyin."),
  changedMeanwhile: () => new ConflictError("support_settings_changed", "Ayarlar bu sırada güncellendi. Sayfayı yenileyip tekrar deneyin."),
};

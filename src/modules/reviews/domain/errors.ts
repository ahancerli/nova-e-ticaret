import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/core";

/** Review error catalogue. */
export const ReviewErrors = {
  notFound: () => new NotFoundError("review_not_found", "Yorum bulunamadı."),
  productNotFound: () => new NotFoundError("product_not_found", "Ürün bulunamadı."),
  purchaseRequired: () => new ForbiddenError("review_purchase_required", "Yalnızca bu ürünü satın alan müşteriler değerlendirme yapabilir."),
  anonymousNotAllowed: () => ValidationError.field("isAnonymous", "Bu mağazada isimsiz değerlendirme yapılamıyor.", "review_anonymous_not_allowed"),
  bodyTooShort: (min: number) => ValidationError.field("body", `Yorumunuz en az ${min} karakter olmalı.`, "review_body_too_short"),
  changedMeanwhile: () => new ConflictError("review_changed", "Yorum bu sırada güncellendi. Sayfayı yenileyip tekrar deneyin."),
  notAllowed: (action: string) => new ConflictError("review_action_not_allowed", `Bu yorum şu anki durumunda “${action}” yapılamaz.`),
  reasonRequired: () => ValidationError.field("reason", "Reddetme nedenini seçin.", "review_reason_required"),
  voteOwn: () => new ConflictError("review_vote_own", "Kendi yorumunuzu oylayamazsınız."),
  voteUnavailable: () => new NotFoundError("review_not_found", "Bu yorum artık yayında değil."),
  noEmail: () => new ConflictError("review_customer_no_email", "Müşterinin kayıtlı e-posta adresi yok; telefon notu ekleyin."),
};

import { NotFoundError } from "@/core";

/** Newsletter error catalogue. */
export const NewsletterErrors = {
  linkInvalid: () => new NotFoundError("newsletter_link_invalid", "Bu bağlantı geçersiz ya da süresi dolmuş. Site altındaki formdan yeniden kayıt olabilirsiniz."),
  notFound: () => new NotFoundError("subscriber_not_found", "Abone bulunamadı."),
};

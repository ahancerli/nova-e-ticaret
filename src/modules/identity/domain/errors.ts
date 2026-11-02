import { BadRequestError, UnauthorizedError } from "@/core";

export const IdentityErrors = {
  /** One message for unknown e-mail, wrong password, inactive, locked-for-this-IP and non-staff: no enumeration. */
  invalidCredentials: () => new UnauthorizedError("invalid_credentials", "E-posta veya parola hatalı."),
  linkInvalid: () => new BadRequestError("link_invalid", "Bağlantı geçersiz, kullanılmış ya da süresi dolmuş. Yeni bir bağlantı isteyin."),
};

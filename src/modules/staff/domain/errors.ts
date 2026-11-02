import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/core";

/** Staff / role error catalogue. */
export const StaffErrors = {
  notFound: () => new NotFoundError("staff_not_found", "Kullanıcı bulunamadı."),
  emailTaken: () => new ConflictError("email_taken", "Bu e-posta ile bir panel kullanıcısı zaten var.", { fieldErrors: { email: ["Bu e-posta zaten kayıtlı."] } }),
  emailIsCustomer: () =>
    new ConflictError("email_is_customer", "Bu e-posta bir müşteri hesabına ait. Personel için iş e-postası kullanın; müşteri ve panel hesapları ayrı tutulur.", { fieldErrors: { email: ["Müşteri hesabına ait e-posta."] } }),
  roleRequired: () => ValidationError.field("roleIds", "En az bir rol seçin.", "role_required"),
  invalidRole: () => ValidationError.field("roleIds", "Geçersiz rol.", "invalid_role"),
  notYourself: () => new ForbiddenError("not_on_yourself", "Bu işlemi kendi hesabınızda yapamazsınız."),
  lastManager: () =>
    new ConflictError("last_user_manager", "Bu değişiklikten sonra kullanıcıları yönetebilen aktif kimse kalmaz. Önce başka bir kullanıcıya “Kullanıcı ve rol yönetimi” yetkisi verin."),
  notInvited: () => new ConflictError("not_invited", "Bu kullanıcı daveti zaten kabul etmiş."),
  notActive: () => new ConflictError("not_active", "Bu işlem yalnız aktif kullanıcılar için yapılabilir."),
  changedMeanwhile: () => new ConflictError("staff_changed", "Kullanıcı bu sırada değişti. Sayfayı yenileyip tekrar deneyin."),

  roleNotFound: () => new NotFoundError("role_not_found", "Rol bulunamadı."),
  roleNameTaken: () => new ConflictError("role_name_taken", "Bu adda bir rol zaten var.", { fieldErrors: { name: ["Bu ad kullanılıyor."] } }),
  roleLocked: (why: string) => new ConflictError("role_locked", why),
  roleInUse: (n: number) => new ConflictError("role_in_use", `Bu rol ${n} kullanıcıya atanmış. Önce kullanıcıların rolünü değiştirin.`),
  unknownPermission: (code: string) => ValidationError.field("permissions", `Bilinmeyen yetki: ${code}`, "unknown_permission"),
};

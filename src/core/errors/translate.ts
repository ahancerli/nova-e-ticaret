import { ZodError } from "zod";
import { AppError, ConflictError, InternalError, ValidationError, type AppErrorOptions, type FieldErrors } from "./app-error";

type ErrorFactory = (options: AppErrorOptions) => AppError;

/**
 * Codes raised by schema triggers (`RAISE(ABORT, '<code>')`, see db/README.md §3) and the error the
 * client should see for each. A new trigger code = one entry here.
 */
const TRIGGER_ERRORS: Record<string, ErrorFactory> = {
  insufficient_stock: (o) => new ConflictError("insufficient_stock", "Stok yetersiz.", o),
  campaign_capacity_exceeded: (o) => new ConflictError("campaign_capacity_exceeded", "Kampanya kapasitesi doldu.", o),
  coupon_limit_reached: (o) => new ConflictError("coupon_limit_reached", "Kupon kullanım limiti doldu.", o),
  coupon_customer_limit_reached: (o) => new ConflictError("coupon_customer_limit_reached", "Bu kuponu daha önce kullandınız.", o),
  coupon_inactive: (o) => new ConflictError("coupon_inactive", "Kupon geçerli değil.", o),
  reservation_terminal: (o) => new ConflictError("reservation_terminal", "Stok rezervasyonu artık değiştirilemez.", o),
  payment_paid_terminal: (o) => new ConflictError("payment_paid_terminal", "Ödenmiş ödeme bu duruma geçemez.", o),
  order_snapshot_immutable: (o) => new ConflictError("order_snapshot_immutable", "Sipariş tutarları değiştirilemez.", o),
  category_cycle: (o) => new ValidationError("category_cycle", "Kategori hiyerarşisinde döngü oluşturulamaz.", o),
  campaign_without_targets: (o) => new ValidationError("campaign_without_targets", "Hedefi olmayan kampanya aktif edilemez.", o),
  attribute_type_mismatch: (o) => new ValidationError("attribute_type_mismatch", "Özellik değeri tipi uyuşmuyor.", o),
  variant_axis_not_assigned: (o) => new ValidationError("variant_axis_not_assigned", "Varyant seçeneği ürüne atanmamış bir eksenden.", o),
  append_only: (o) => new ConflictError("append_only", "Bu kayıt değiştirilemez.", o),
};

const CONSTRAINT_ERRORS: [RegExp, ErrorFactory][] = [
  [/UNIQUE constraint failed/, (o) => new ConflictError("conflict", "Kayıt çakışması.", o)],
  [/FOREIGN KEY constraint failed/, (o) => new ValidationError("invalid_reference", "Geçersiz referans.", o)],
  [/CHECK constraint failed/, (o) => new ValidationError("invalid_value", "Geçersiz değer.", o)],
];

/** Stable code for a D1/SQLite error message, or null when it is not a known database rule. */
export function databaseErrorCode(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  for (const code of Object.keys(TRIGGER_ERRORS)) if (msg.includes(code)) return code;
  if (/UNIQUE constraint failed/.test(msg)) return "conflict";
  if (/FOREIGN KEY constraint failed/.test(msg)) return "invalid_reference";
  if (/CHECK constraint failed/.test(msg)) return "invalid_value";
  return null;
}

function fromDatabase(err: unknown): AppError | null {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [code, make] of Object.entries(TRIGGER_ERRORS)) {
    if (msg.includes(code)) return make(databaseOptions(err));
  }
  for (const [pattern, make] of CONSTRAINT_ERRORS) {
    if (pattern.test(msg)) return make(databaseOptions(err));
  }
  return null;
}

function fromZod(err: ZodError): ValidationError {
  const fieldErrors: FieldErrors = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return new ValidationError("validation_error", "Girdi doğrulanamadı.", { fieldErrors, cause: err });
}

function databaseOptions(cause: unknown): AppErrorOptions {
  return { details: { dbMessage: cause instanceof Error ? cause.message : String(cause) }, cause };
}

/**
 * Normalizes anything thrown into an AppError (Chain of Responsibility: app → zod → database → internal).
 * Unknown errors become a non-exposed InternalError that keeps the original as `cause` for logging.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return fromZod(err);
  return fromDatabase(err) ?? new InternalError("internal_error", "Beklenmeyen bir hata oluştu.", { cause: err });
}

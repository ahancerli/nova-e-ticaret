/**
 * Typed error hierarchy shared by every server module.
 *
 * - `code` is a stable, machine readable identifier (clients branch on it, logs aggregate on it).
 * - `message` is the user-facing Turkish text; it is only sent to the client when `expose` is true.
 * - `fieldErrors` maps input paths ("shipping.city") to messages for form rendering.
 * - `details` is internal context for logs and is never serialized to the client.
 *
 * Services throw these; only the HTTP layer (core/http/error-response.ts) decides how they look on the wire.
 */
export type FieldErrors = Record<string, string[]>;

export interface AppErrorOptions {
  fieldErrors?: FieldErrors;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldErrors;
  readonly details: Record<string, unknown>;
  /** false → the client gets a generic message and the real one only goes to logs. */
  readonly expose: boolean;

  constructor(status: number, code: string, message: string, options: AppErrorOptions & { expose?: boolean } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.fieldErrors = options.fieldErrors ?? {};
    this.details = options.details ?? {};
    this.expose = options.expose ?? status < 500;
  }
}

/** 400 — malformed request (bad JSON, missing header). */
export class BadRequestError extends AppError {
  constructor(code = "bad_request", message = "İstek geçersiz.", options?: AppErrorOptions) {
    super(400, code, message, options);
  }
}

/** 401 — no valid session / signature. */
export class UnauthorizedError extends AppError {
  constructor(code = "unauthenticated", message = "Giriş yapmanız gerekiyor.", options?: AppErrorOptions) {
    super(401, code, message, options);
  }
}

/** 403 — authenticated but not allowed, or a failed origin check. */
export class ForbiddenError extends AppError {
  constructor(code = "forbidden", message = "Bu işlem için yetkiniz yok.", options?: AppErrorOptions) {
    super(403, code, message, options);
  }
}

/** 404 — the addressed resource does not exist (or is not visible to the caller). */
export class NotFoundError extends AppError {
  constructor(code = "not_found", message = "Kayıt bulunamadı.", options?: AppErrorOptions) {
    super(404, code, message, options);
  }
}

/** 409 — state conflict: race lost, duplicate key, stale version, business rule on current state. */
export class ConflictError extends AppError {
  constructor(code = "conflict", message = "Kayıt çakışması.", options?: AppErrorOptions) {
    super(409, code, message, options);
  }
}

/** 413 — body or file over the allowed size. */
export class PayloadTooLargeError extends AppError {
  constructor(code = "payload_too_large", message = "İstek çok büyük.", options?: AppErrorOptions) {
    super(413, code, message, options);
  }
}

/** 415 — wrong content type. */
export class UnsupportedMediaTypeError extends AppError {
  constructor(code = "unsupported_media_type", message = "Desteklenmeyen içerik türü.", options?: AppErrorOptions) {
    super(415, code, message, options);
  }
}

/** 422 — input is well-formed but violates validation or business rules. */
export class ValidationError extends AppError {
  constructor(code = "validation_error", message = "Girdi doğrulanamadı.", options?: AppErrorOptions) {
    super(422, code, message, options);
  }

  /** Single-field shortcut: `ValidationError.field("email", "Geçersiz e-posta.")`. */
  static field(path: string, message: string, code = "validation_error"): ValidationError {
    return new ValidationError(code, message, { fieldErrors: { [path]: [message] } });
  }
}

/** 429 — rate limit hit. */
export class RateLimitError extends AppError {
  constructor(code = "rate_limited", message = "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.", options?: AppErrorOptions) {
    super(429, code, message, options);
  }
}

/** 502 — a provider (iyzico, carrier, media storage) failed or answered something unusable. */
export class ExternalServiceError extends AppError {
  constructor(code = "external_service_error", message = "Dış servis yanıt vermedi. Lütfen tekrar deneyin.", options?: AppErrorOptions) {
    super(502, code, message, { ...options, expose: true });
  }
}

/** 500 — a bug or misconfiguration. The message is never shown to the client. */
export class InternalError extends AppError {
  constructor(code = "internal_error", message = "Beklenmeyen bir hata oluştu.", options?: AppErrorOptions) {
    super(500, code, message, { ...options, expose: false });
  }
}

export const isAppError = (err: unknown): err is AppError => err instanceof AppError;

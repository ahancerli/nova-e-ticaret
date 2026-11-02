import { toAppError } from "../errors";
import { serializeError, type Logger } from "../logging/logger";
import { jsonResponse, type ErrorBody } from "./reply";

const GENERIC_MESSAGE = "Beklenmeyen bir hata oluştu.";

/**
 * The single place where a thrown value becomes an HTTP error response.
 *  - AppError (and Zod / known DB errors via toAppError) → its status, code and user message.
 *  - Anything else → 500 with a generic message; the real error is logged with the request id.
 * 4xx are logged at "info" (client mistakes), 5xx at "error".
 */
export function errorResponse(err: unknown, ctx: { requestId: string; logger: Logger; exposeStack: boolean }): Response {
  const appErr = toAppError(err);
  const fields = {
    code: appErr.code,
    status: appErr.status,
    ...(Object.keys(appErr.details).length ? { details: appErr.details } : {}),
  };
  if (appErr.status >= 500) {
    ctx.logger.error("request failed", { ...fields, error: serializeError(appErr.cause ?? appErr, ctx.exposeStack) });
  } else {
    ctx.logger.info("request rejected", fields);
  }

  const body: ErrorBody = {
    error: {
      code: appErr.expose ? appErr.code : "internal_error",
      message: appErr.expose ? appErr.message : GENERIC_MESSAGE,
      fieldErrors: appErr.expose ? appErr.fieldErrors : {},
    },
    requestId: ctx.requestId,
  };
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (appErr.status === 429) headers["retry-after"] = "60";
  return jsonResponse(body, appErr.status, headers);
}

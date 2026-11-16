import { isAppError, type Logger } from "@/core";
import { SOCIAL_LOGIN_MESSAGES } from "@/modules/social-login";

/** Start and callback are browser navigations: they always answer with a redirect, never with a JSON envelope. */
export function redirectTo(path: string): Response {
  return new Response(null, { status: 302, headers: { location: path, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

/** Failure → the sign-in page with a known code (`socialLoginMessage` turns it into text); details stay in the log. */
export function redirectToLoginError(err: unknown, logger: Logger, provider: string): Response {
  const known = isAppError(err) && Object.hasOwn(SOCIAL_LOGIN_MESSAGES, err.code);
  const code = known ? (err as { code: string }).code : "social_failed";
  if (code === "social_failed") logger.error("social login failed", { provider, code: isAppError(err) ? err.code : "unexpected", ...(isAppError(err) ? err.details : { error: String(err) }) });
  else logger.info("social login refused", { provider, code });
  return redirectTo(`/giris?hata=${code}`);
}

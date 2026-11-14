import type { CaptchaVerifier } from "../application/ports";
import { CAPTCHA_PROVIDERS, type CaptchaProvider, type CaptchaVerdict } from "../domain/captcha";
import { CaptchaErrors } from "../domain/errors";

const TIMEOUT_MS = 8_000;

type SiteverifyBody = { success?: boolean; score?: number; action?: string; hostname?: string; "error-codes"?: string[] };

/** Turnstile and reCAPTCHA share the siteverify contract (form POST: secret, response, remoteip). */
export class HttpCaptchaVerifier implements CaptchaVerifier {
  async verify(provider: CaptchaProvider, input: { secret: string; token: string; remoteIp?: string | null }): Promise<CaptchaVerdict> {
    const form = new URLSearchParams({ secret: input.secret, response: input.token });
    if (input.remoteIp && input.remoteIp !== "0.0.0.0") form.set("remoteip", input.remoteIp);
    let res: Response;
    try {
      res = await fetch(CAPTCHA_PROVIDERS[provider].verifyUrl, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw CaptchaErrors.unreachable(err instanceof Error ? err.name : String(err)); // never the request: it holds the secret
    }
    if (res.status >= 500 || res.status === 429) throw CaptchaErrors.unreachable(`http_${res.status}`);
    const body = (await res.json().catch(() => ({}))) as SiteverifyBody;
    if (!body.success) return { ok: false, codes: Array.isArray(body["error-codes"]) ? body["error-codes"].slice(0, 5).map(String) : [`http_${res.status}`] };
    return { ok: true, score: typeof body.score === "number" ? body.score : null, action: body.action || null, hostname: body.hostname || null };
  }
}

"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ClientApiError } from "@/lib/api-client";
import { CAPTCHA_HEADER, CAPTCHA_PROVIDERS, type CaptchaForm, type CaptchaProvider, type PublicCaptchaConfig } from "@/modules/captcha/domain/captcha";

/**
 * Bot protection in the browser. The storefront layout provides the public config (null = off); a form calls
 * `useCaptcha("<form>")`, renders `slot`, sends `await headers()` with its request and calls `reset()` after every
 * attempt (tokens are single use). Screens never talk to Turnstile / reCAPTCHA directly.
 */

type TurnstileApi = {
  render(el: HTMLElement, o: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
type RecaptchaApi = { ready(cb: () => void): void; execute(siteKey: string, o: { action: string }): Promise<string> };
declare global {
  interface Window { turnstile?: TurnstileApi; grecaptcha?: RecaptchaApi }
}

const TOKEN_WAIT_MS = 15_000;
const LOAD_FAILED = "Güvenlik doğrulaması yüklenemedi. Reklam / içerik engelleyiciyi bu sitede kapatıp sayfayı yenileyin.";
const NOT_DONE = "Güvenlik doğrulaması henüz tamamlanmadı. Birkaç saniye bekleyip tekrar deneyin.";

/** Same error type as API failures, so forms show it through `errorMessage` like any other. */
const fail = (message: string) => new ClientApiError(400, "captcha_unavailable", message);

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      // inserted by our nonced bundle → allowed by CSP 'strict-dynamic'; frame hosts come from CAPTCHA_CSP
      const s = document.createElement("script");
      s.async = true;
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { scripts.delete(src); s.remove(); reject(fail(LOAD_FAILED)); };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

const CaptchaContext = createContext<PublicCaptchaConfig | null>(null);

export function CaptchaProvider({ config, children }: { config: PublicCaptchaConfig | null; children: React.ReactNode }) {
  return <CaptchaContext.Provider value={config}>{children}</CaptchaContext.Provider>;
}

export interface Captcha {
  /** Turnstile widget (stays invisible unless the visitor must interact); null for reCAPTCHA v3 / when off. */
  slot: React.ReactNode;
  /** Headers for the protected request; throws a ClientApiError (user-facing message) when no token is available. */
  headers(): Promise<Record<string, string>>;
  reset(): void;
  /** Widget failure (script blocked, wrong site key) to show next to the form. */
  error: string | null;
}

/** Storefront forms: active only when protection is on and this form is selected in the panel. */
export function useCaptcha(form: CaptchaForm): Captcha {
  const config = useContext(CaptchaContext);
  const on = !!config && config.forms.includes(form);
  return useCaptchaWidget(on ? config.provider : null, on ? config.siteKey : "", form);
}

/** Lower level: any provider / site key / action (the panel's key check uses it with keys not saved yet). */
export function useCaptchaWidget(provider: CaptchaProvider | null, siteKey: string, action: string, appearance: "always" | "interaction-only" = "interaction-only"): Captcha {
  // callback ref in state: the effect re-runs when the slot (re)mounts — forms show it only in some states
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiters = useRef<((t: string | null) => void)[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider || !siteKey) return;
    let live = true;
    const src = CAPTCHA_PROVIDERS[provider].scriptUrl(siteKey);
    const settle = (t: string | null) => { token.current = t; for (const w of waiters.current.splice(0)) w(t); };
    loadScript(src).then(() => {
      if (!live) return;
      setError(null);
      if (provider !== "turnstile" || !el || !window.turnstile) return;
      widget.current = window.turnstile.render(el, {
        sitekey: siteKey, action, appearance, language: "tr", "refresh-expired": "auto",
        callback: (t: string) => { setError(null); settle(t); },
        "expired-callback": () => { token.current = null; },
        "error-callback": () => { settle(null); setError("Güvenlik doğrulaması başarısız oldu. Sayfayı yenileyip tekrar deneyin."); },
      });
    }, () => { if (live) setError(LOAD_FAILED); });
    return () => {
      live = false;
      token.current = null;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [provider, siteKey, action, appearance, el]);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    if (!provider || !siteKey) return {};
    if (provider === "recaptcha_v3") {
      await loadScript(CAPTCHA_PROVIDERS.recaptcha_v3.scriptUrl(siteKey));
      const g = window.grecaptcha;
      if (!g) throw fail(LOAD_FAILED);
      await new Promise<void>((r) => g.ready(r));
      return { [CAPTCHA_HEADER]: await g.execute(siteKey, { action }) };
    }
    const t = token.current ?? await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), TOKEN_WAIT_MS);
      waiters.current.push((v) => { clearTimeout(timer); resolve(v); });
    });
    if (!t) throw fail(NOT_DONE);
    return { [CAPTCHA_HEADER]: t };
  }, [provider, siteKey, action]);

  const reset = useCallback(() => {
    token.current = null;
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, []);

  return { slot: provider === "turnstile" && siteKey ? <div ref={setEl} /> : null, headers, reset, error };
}

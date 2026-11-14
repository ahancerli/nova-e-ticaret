"use client";

import {
  CONSENT_COOKIE, NO_CONSENT, decodeConsent, encodeConsent, isConsentCurrent,
  type ConsentChoices, type ConsentSource, type PublicConsentConfig, type StoredConsent,
} from "@/modules/consent/domain/consent";
import { consentApi } from "./api";

/**
 * Browser consent state (useSyncExternalStore). The cookie is the source of truth on this device; the server copy
 * (POST /api/consent) is proof only, so a failed report never changes what the visitor chose.
 */
export interface ConsentSnapshot {
  /** false until the cookie was read in the browser (SSR / first render: no banner, no tags). */
  ready: boolean;
  /** The visitor answered the current revision. */
  decided: boolean;
  choices: ConsentChoices;
  visitorId: string | null;
}

const SERVER: ConsentSnapshot = { ready: false, decided: false, choices: NO_CONSENT, visitorId: null };
let snapshot: ConsentSnapshot = SERVER;
let config: PublicConsentConfig | null = null;
const listeners = new Set<() => void>();

const emit = (next: ConsentSnapshot) => {
  snapshot = next;
  for (const l of listeners) l();
};

function readCookie(): StoredConsent | null {
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${CONSENT_COOKIE}=`))?.slice(CONSENT_COOKIE.length + 1);
  return decodeConsent(raw ? decodeURIComponent(raw) : null);
}

function writeCookie(value: StoredConsent, maxAgeDays: number) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeConsent(value)}; Max-Age=${maxAgeDays * 86_400}; Path=/; SameSite=Lax${secure}`;
}

/** Called once by ConsentRoot with the SSR config; reads the cookie. */
export function initConsent(cfg: PublicConsentConfig) {
  config = cfg;
  const stored = readCookie();
  const current = isConsentCurrent(stored, cfg.revision, cfg.maxAgeDays, Date.now());
  emit({ ready: true, decided: current, choices: current ? stored.choices : NO_CONSENT, visitorId: stored?.visitorId ?? null });
}

export const subscribeConsent = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
export const getConsentSnapshot = () => snapshot;
export const getServerConsentSnapshot = () => SERVER;

/** Apply + remember a choice (banner, preferences dialog or an external CMP adapter). */
export function saveConsent(choices: ConsentChoices, source: ConsentSource) {
  if (!config) return;
  const visitorId = snapshot.visitorId ?? crypto.randomUUID();
  writeCookie({ visitorId, revision: config.revision, choices, at: Date.now() }, config.maxAgeDays);
  emit({ ready: true, decided: true, choices, visitorId });
  consentApi.record({ visitorId, revision: config.revision, choices, source }).catch(() => {
    // proof is best effort: the choice is already applied in this browser
  });
}

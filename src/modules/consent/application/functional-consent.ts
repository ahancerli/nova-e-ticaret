import type { Clock } from "@/core";
import { CONSENT_COOKIE, consentRevision, decodeConsent, isConsentCurrent } from "../domain/consent";
import { cookieValue } from "../domain/server-tracking";
import type { ConsentRepository, CookiePolicySource } from "./ports";

/**
 * Query: may the shop keep "functional" data for this browser (e.g. Son gezilenler)? Yes when the visitor's current
 * consent allows the functional category, or when the consent banner is switched off (no consent is collected then).
 */
export class HasFunctionalConsent {
  constructor(private readonly deps: { repo: ConsentRepository; policy: CookiePolicySource; clock: Clock }) {}

  async execute(cookieHeader: string | null): Promise<boolean> {
    const [s, policy] = await Promise.all([this.deps.repo.settings(), this.deps.policy()]);
    if (!s.bannerEnabled) return true;
    const stored = decodeConsent(cookieValue(cookieHeader, CONSENT_COOKIE));
    return isConsentCurrent(stored, consentRevision(s.revision, policy?.version ?? null), s.maxAgeDays, this.deps.clock.now().getTime()) && stored.choices.functional;
  }
}

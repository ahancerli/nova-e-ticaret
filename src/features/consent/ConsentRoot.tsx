"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { OPEN_PREFERENCES_EVENT, type PublicConsentConfig } from "@/modules/consent/domain/consent";
import { ConsentBanner } from "./ConsentBanner";
import { getConsentSnapshot, getServerConsentSnapshot, initConsent, subscribeConsent } from "./consent-store";
import { PreferencesDialog } from "./PreferencesDialog";
import { useTagManager } from "./useTagManager";

/**
 * Storefront consent island (one per page, in the storefront layout): reads the cookie, shows the banner when the
 * current revision is unanswered, opens the preferences dialog on `nova:consent-preferences`, runs the tag manager.
 * External CMPs (Cookiebot …) would plug in here as a source calling `saveConsent(…, "external")` instead of the
 * banner; none is integrated yet, so the server only ever sends `builtin`.
 */
export function ConsentRoot({ config }: { config: PublicConsentConfig }) {
  useEffect(() => initConsent(config), [config]);
  const snap = useSyncExternalStore(subscribeConsent, getConsentSnapshot, getServerConsentSnapshot);
  useTagManager(config, snap);

  const [prefsOpen, setPrefsOpen] = useState(false);
  useEffect(() => {
    const open = () => setPrefsOpen(true);
    window.addEventListener(OPEN_PREFERENCES_EVENT, open);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, open);
  }, []);

  if (!config.bannerEnabled || config.provider !== "builtin") return null;
  return (
    <>
      {snap.ready && !snap.decided && !prefsOpen && <ConsentBanner config={config} onCustomize={() => setPrefsOpen(true)} />}
      <PreferencesDialog open={prefsOpen} onClose={() => setPrefsOpen(false)} config={config} snap={snap} />
    </>
  );
}

"use client";

import { OPEN_PREFERENCES_EVENT } from "@/modules/consent/domain/consent";

/** Footer (or any page) link that reopens the cookie preferences dialog — withdrawing must be as easy as agreeing. */
export function CookiePreferencesLink({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT))}>
      Çerez tercihleri
    </button>
  );
}

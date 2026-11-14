"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { OPTIONAL_CATEGORIES, type ConsentChoices, type PublicConsentConfig } from "@/modules/consent/domain/consent";
import { TAG_ADAPTERS } from "./adapters";
import type { TagAdapter } from "./adapters/types";
import type { ConsentSnapshot } from "./consent-store";
import { setTrackSink } from "./track";

/** Expire a cookie on this host and every parent domain (vendors set theirs on the registrable domain). */
function removeCookies(patterns: RegExp[]) {
  const names = document.cookie.split("; ").map((c) => c.split("=")[0]!).filter((n) => patterns.some((p) => p.test(n)));
  const parts = location.hostname.split(".");
  const domains = ["", ...parts.slice(0, -1).map((_, i) => `; Domain=.${parts.slice(i).join(".")}`)];
  for (const n of names) for (const d of domains) document.cookie = `${n}=; Max-Age=0; Path=/${d}`;
}

const safely = (fn: () => void) => {
  try { fn(); } catch { /* a vendor script must never break the shop */ }
};

/**
 * Loads each configured tag once its category is allowed (Google tags up front in advanced consent mode), forwards
 * consent changes and commerce events, and sends page views on client navigation. Withdrawing a category whose tag
 * already ran removes that vendor's cookies and reloads the page: a loaded script cannot be unloaded.
 */
export function useTagManager(config: PublicConsentConfig, snap: ConsentSnapshot) {
  const loaded = useRef(new Map<string, { adapter: TagAdapter; config: Record<string, string> }>());
  const previous = useRef<ConsentChoices | null>(null);

  useEffect(() => {
    if (!snap.ready) return;
    const was = previous.current;
    previous.current = snap.choices;
    const revoked = was ? OPTIONAL_CATEGORIES.filter((k) => was[k] && !snap.choices[k]) : [];
    const ranRevoked = config.tags.filter((t) => revoked.includes(t.category) && loaded.current.has(t.code));
    if (ranRevoked.length) {
      for (const t of ranRevoked) {
        const { adapter } = loaded.current.get(t.code)!;
        safely(() => adapter.consent?.(t.config, snap.choices));
        removeCookies(adapter.cookies);
      }
      location.reload();
      return;
    }

    const env = { choices: snap.choices, googleConsentMode: config.googleConsentMode };
    for (const t of config.tags) {
      const adapter = TAG_ADAPTERS.get(t.code);
      if (!adapter) continue;
      if (loaded.current.has(t.code)) {
        safely(() => adapter.consent?.(t.config, snap.choices));
        continue;
      }
      const allowed = snap.choices[t.category] || (adapter.googleConsentMode && config.googleConsentMode === "advanced");
      if (!allowed) continue;
      safely(() => adapter.load(t.config, env));
      loaded.current.set(t.code, { adapter, config: t.config });
    }
    const tags = loaded.current;
    setTrackSink(tags.size ? (e) => { for (const { adapter, config: c } of tags.values()) safely(() => adapter.track(c, e)); } : null);
  }, [config, snap]);

  useEffect(() => () => setTrackSink(null), []);

  const pathname = usePathname();
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    for (const { adapter, config: c } of loaded.current.values()) safely(() => adapter.pageView?.(c));
  }, [pathname]);
}

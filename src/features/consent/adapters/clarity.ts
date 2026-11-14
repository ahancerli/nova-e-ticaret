import { injectScript, type TagAdapter } from "./types";

type Clarity = ((...args: unknown[]) => void) & { q?: unknown[] };
declare global {
  interface Window { clarity?: Clarity }
}

function clarity(): Clarity {
  if (!window.clarity) {
    const c: Clarity = (...args: unknown[]) => void (c.q = c.q ?? []).push(args);
    window.clarity = c;
  }
  return window.clarity;
}

/** Microsoft Clarity: consent API v2 tells it which storage the visitor allowed. */
export const microsoftClarity: TagAdapter = {
  code: "clarity",
  cookies: [/^_clck$/, /^_clsk$/, /^CLID$/],
  load: (cfg, env) => {
    const c = clarity();
    injectScript(`https://www.clarity.ms/tag/${encodeURIComponent(cfg.projectId!)}`);
    c("consentv2", { analytics_Storage: env.choices.analytics ? "granted" : "denied", ad_Storage: env.choices.marketing ? "granted" : "denied" });
  },
  consent: (_, choices) => window.clarity?.("consentv2", { analytics_Storage: choices.analytics ? "granted" : "denied", ad_Storage: choices.marketing ? "granted" : "denied" }),
  track: (_, e) => clarity()("event", e.name),
};

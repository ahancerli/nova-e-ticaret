"use client";

import { useRef } from "react";
import { useDialogFocus } from "@/lib/motion";
import { ALL_CONSENT, NO_CONSENT, type PublicConsentConfig } from "@/modules/consent/domain/consent";
import { saveConsent } from "./consent-store";

const noop = () => {};

/**
 * First-visit banner. KVKK Çerez Rehberi: "reject" is exactly as easy and as prominent as "accept" (same style, same
 * size, side by side), nothing is pre-selected, and no optional cookie is set before a choice.
 */
export function ConsentBanner({ config, onCustomize }: { config: PublicConsentConfig; onCustomize: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const isModal = config.layout === "modal";
  // the modal layout holds focus until a choice is made (Escape does not dismiss it: no choice = no consent anyway)
  useDialogFocus(ref, isModal, noop);
  const t = config.texts;

  const body = (
    <>
      <h2 id="consent-title" className="font-display text-lg font-bold leading-snug text-ink">{t.title}</h2>
      <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        {t.body}
        {config.policy && <> <a href={config.policy.href} className="font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink">{t.policyLink}</a></>}
      </p>
    </>
  );
  const choice = "h-11 rounded-pill bg-ink px-5 text-sm font-semibold text-white transition hover:bg-ink-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  const buttons = (
    <div className={config.layout === "bar" ? "flex shrink-0 flex-wrap items-center gap-2 sm:justify-end" : "grid gap-2"}>
      <div className="grid flex-1 grid-cols-2 gap-2 sm:flex-none">
        <button type="button" className={choice} onClick={() => saveConsent(NO_CONSENT, "banner")}>{t.reject}</button>
        <button type="button" className={choice} onClick={() => saveConsent(ALL_CONSENT, "banner")}>{t.accept}</button>
      </div>
      <button type="button" onClick={onCustomize}
        className="h-11 rounded-pill px-4 text-sm font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink">
        {t.customize}
      </button>
    </div>
  );

  if (config.layout === "bar") {
    return (
      <div ref={ref} role="region" aria-labelledby="consent-title" className="fixed inset-x-0 bottom-0 z-[55] animate-sheet-in border-t border-line bg-white shadow-[0_-12px_40px_-20px_rgb(25_22_64/0.35)]">
        <div className="spectrum h-1" aria-hidden />
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:gap-10">
          <div className="min-w-0 flex-1">{body}</div>
          {buttons}
        </div>
      </div>
    );
  }

  const card = (
    <div ref={ref} role={isModal ? "dialog" : "region"} aria-modal={isModal || undefined} aria-labelledby="consent-title"
      className={`overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-2xl ${isModal ? "w-full max-w-lg animate-scale-in" : "animate-sheet-in"}`}>
      <div className="spectrum h-1" aria-hidden />
      <div className="grid gap-4 p-5">
        <div>{body}</div>
        {buttons}
      </div>
    </div>
  );
  if (isModal) return <div className="fixed inset-0 z-[60] grid animate-fade-in place-items-end bg-ink/45 p-4 backdrop-blur-[2px] sm:place-items-center">{card}</div>;
  return <div className="fixed inset-x-4 bottom-4 z-[55] sm:inset-x-auto sm:left-4 sm:w-[400px]">{card}</div>;
}

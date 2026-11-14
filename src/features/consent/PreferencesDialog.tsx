"use client";

import { useState } from "react";
import {
  ALL_CONSENT, CATEGORY_INFO, CONSENT_CATEGORIES, NO_CONSENT,
  type ConsentCategory, type ConsentChoices, type OptionalCategory, type PublicConsentConfig,
} from "@/modules/consent/domain/consent";
import { TAG_PROVIDER_BY_CODE } from "@/modules/consent/domain/tags";
import { Modal } from "../shop/ui/Modal";
import { saveConsent, type ConsentSnapshot } from "./consent-store";

/** Category marker colours: the storefront's department spectrum, so the dialog reads as part of the shop. */
const DOT: Record<ConsentCategory, string> = { necessary: "bg-ink", functional: "bg-dept-1", analytics: "bg-dept-3", marketing: "bg-dept-2" };

const isOptional = (c: ConsentCategory): c is OptionalCategory => c !== "necessary";

/**
 * "Çerez tercihleri": one switch per category with the vendors actually running in it (from the active tags), so the
 * visitor sees who receives data before agreeing. Reachable any time from the footer link.
 */
export function PreferencesDialog({ open, onClose, config, snap }: { open: boolean; onClose: () => void; config: PublicConsentConfig; snap: ConsentSnapshot }) {
  const [draft, setDraft] = useState<ConsentChoices>(snap.choices);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(snap.choices);
  }
  const t = config.texts;
  const vendors = (c: OptionalCategory) => config.tags.filter((x) => x.category === c).map((x) => TAG_PROVIDER_BY_CODE.get(x.code)).filter((d) => !!d);
  const choose = (c: ConsentChoices) => {
    saveConsent(c, "preferences");
    onClose();
  };
  const button = "h-11 rounded-pill px-5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

  return (
    <Modal open={open} onClose={onClose} title="Çerez tercihleri" labelledBy="consent-prefs-title" size="lg">
      <p className="text-sm leading-relaxed text-ink-soft">
        Hangi çerezlere izin verdiğinizi seçin. Zorunlu çerezler dışındakiler yalnız izin verirseniz çalışır; tercihinizi istediğiniz zaman buradan değiştirebilirsiniz.
        {config.policy && <> <a href={config.policy.href} className="font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink">{t.policyLink}</a></>}
      </p>

      <ul className="mt-5 divide-y divide-line rounded-[var(--radius-card)] border border-line">
        {CONSENT_CATEGORIES.map((c) => {
          const info = CATEGORY_INFO[c];
          const list = isOptional(c) ? vendors(c) : [];
          const id = `consent-cat-${c}`;
          return (
            <li key={c} className="p-4">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${DOT[c]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p id={id} className="font-semibold text-ink">{info.label}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{info.description}</p>
                </div>
                {isOptional(c) ? (
                  <button type="button" role="switch" aria-checked={draft[c]} aria-labelledby={id} onClick={() => setDraft((d) => ({ ...d, [c]: !d[c] }))}
                    className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-pill transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${draft[c] ? "bg-ink" : "bg-line"}`}>
                    <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${draft[c] ? "left-6" : "left-1"}`} />
                  </button>
                ) : (
                  <span className="mt-1 shrink-0 text-xs font-semibold text-muted">Her zaman açık</span>
                )}
              </div>
              {list.length > 0 && (
                <details className="group mt-3 pl-5.5 text-sm">
                  <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">
                    Bu kategoride çalışan hizmetler: {list.map((d) => d.name).join(", ")}
                  </summary>
                  <table className="mt-2 w-full text-left text-xs text-ink-soft">
                    <thead><tr className="text-muted"><th className="py-1 pr-2 font-medium">Hizmet</th><th className="py-1 pr-2 font-medium">Çerez</th><th className="py-1 font-medium">Süre</th></tr></thead>
                    <tbody>
                      {list.flatMap((d) => d.cookies.map((k) => (
                        <tr key={`${d.code}-${k.name}`} className="border-t border-line align-top">
                          <td className="py-1.5 pr-2">{d.vendor}</td>
                          <td className="py-1.5 pr-2"><span className="font-medium text-ink">{k.name}</span> — {k.purpose}</td>
                          <td className="py-1.5">{k.duration}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </details>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <button type="button" onClick={() => choose(draft)} className={`${button} text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-ink sm:mr-auto`}>
          {t.save}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => choose({ ...NO_CONSENT })} className={`${button} bg-ink text-white hover:bg-ink-soft`}>{t.reject}</button>
          <button type="button" onClick={() => choose({ ...ALL_CONSENT })} className={`${button} bg-ink text-white hover:bg-ink-soft`}>{t.accept}</button>
        </div>
      </div>
      {snap.visitorId && (
        <p className="mt-4 text-xs text-muted">
          Tercih kaydı kimliğiniz: <span className="select-all font-medium text-ink-soft">{snap.visitorId}</span> — KVKK başvurularınızda bu kimliği belirtebilirsiniz.
        </p>
      )}
    </Modal>
  );
}

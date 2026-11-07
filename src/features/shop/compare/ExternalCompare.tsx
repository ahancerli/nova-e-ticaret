"use client";

import { useState } from "react";
import { Modal } from "../ui/Modal";

/**
 * "Diğer sitelerle karşılaştır": price comparison against other shops. The search pipeline (external_search_jobs /
 * external_offers tables) is not live yet, so the dialog announces it.
 */
export function ExternalCompare({ productName, className = "" }: { productName?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`inline-flex h-11 items-center gap-2 rounded-lg border border-dashed border-line bg-white px-4 text-sm font-semibold text-ink-soft transition hover:border-brand hover:text-brand ${className}`}>
        <span aria-hidden>🌐</span> Diğer sitelerle karşılaştır
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Diğer sitelerle karşılaştır" size="sm" labelledBy="external-compare-title">
        <div className="flex flex-col items-center text-center">
          <span className="relative grid size-20 place-items-center rounded-full bg-brand-soft text-4xl" aria-hidden>
            🔎<span className="absolute -right-1 -top-1 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Yakında</span>
          </span>
          <p className="mt-5 text-lg font-bold">Bu modül çok yakında hizmete girecek</p>
          <p className="mt-2 text-sm text-ink-soft">
            {productName ? <>“{productName}” ürününün </> : "Ürünlerin "}fiyatını diğer mağaza ve pazaryerleriyle tek ekranda karşılaştırabileceksiniz. Fiyat, kargo ücreti ve stok durumu yan yana görünecek.
          </p>
          <ul className="mt-5 w-full space-y-2 text-left text-sm">
            {["Güncel fiyat ve kargo ücreti", "Stok ve teslimat bilgisi", "En uygun teklifin vurgulanması"].map((t) => (
              <li key={t} className="flex items-center gap-2 rounded-xl bg-ground px-3 py-2"><span className="text-success" aria-hidden>✓</span>{t}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setOpen(false)} className="btn btn-primary mt-6 w-full">Anladım</button>
        </div>
      </Modal>
    </>
  );
}

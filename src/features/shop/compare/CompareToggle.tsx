"use client";

import { useRouter } from "next/navigation";
import { notify } from "@/lib/toast";
import { COMPARE_LIMIT, compareHref, useCompare, type CompareItem } from "./store";

const ScaleIcon = ({ className = "size-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a4 4 0 0 0 6 0L5 7Zm14 0-3 7a4 4 0 0 0 6 0l-3-7Z" />
  </svg>
);
export { ScaleIcon };

/** Add / remove a product from the comparison list. `icon` = round button on product cards. */
export function CompareToggle({ item, variant = "button" }: { item: CompareItem; variant?: "button" | "icon" }) {
  const router = useRouter();
  const compare = useCompare();
  const on = compare.has(item.id);
  const toggle = () => {
    if (on) { compare.remove(item.id); return; }
    if (!compare.add(item)) {
      notify.warning(`En fazla ${COMPARE_LIMIT} ürün karşılaştırılabilir`, { description: "Listeden bir ürünü çıkarıp tekrar deneyin." });
      return;
    }
    const count = compare.items.length + 1;
    notify.success("Karşılaştırmaya eklendi", count > 1
      ? { description: `${count} ürün listede.`, action: { label: "Karşılaştır", onClick: () => router.push(compareHref([...compare.items, item])) } }
      : { description: "Bir ürün daha ekleyip yan yana görün." });
  };
  if (variant === "icon") {
    return (
      <button type="button" onClick={toggle} aria-pressed={on} aria-label={on ? `${item.name} karşılaştırmadan çıkar` : `${item.name} karşılaştırmaya ekle`} title={on ? "Karşılaştırmadan çıkar" : "Karşılaştır"}
        className={`grid size-9 place-items-center rounded-full border shadow-sm backdrop-blur transition ${on ? "border-brand bg-brand text-white" : "border-line bg-white/90 text-ink-soft hover:border-brand hover:text-brand"}`}>
        <ScaleIcon />
      </button>
    );
  }
  return (
    <button type="button" onClick={toggle} aria-pressed={on}
      className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition ${on ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white hover:border-ink-soft"}`}>
      <ScaleIcon /> {on ? "Karşılaştırmada" : "Karşılaştır"}
    </button>
  );
}

import type { PromotionBadge } from "@/lib/types";

/**
 * A campaign as shoppers see it ("🔥 3 Al 2 Öde"): uploaded icon, else emoji, plus the badge text.
 * Same component on product cards, the product page, cart rows and order summaries. Server-renderable.
 */
export function PromoBadge({ badge, size = "sm", className = "" }: { badge: Pick<PromotionBadge, "label" | "emoji" | "imageUrl">; size?: "xs" | "sm" | "md"; className?: string }) {
  const text = size === "xs" ? "text-[10px] px-1.5 py-px" : size === "md" ? "text-sm px-2.5 py-1" : "text-[11px] px-1.5 py-0.5";
  const icon = size === "md" ? "size-4" : "size-3.5";
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-md bg-brand font-bold leading-tight text-white ${text} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- uploaded asset */}
      {badge.imageUrl ? <img src={badge.imageUrl} alt="" className={`${icon} flex-none rounded-sm object-contain`} /> : badge.emoji ? <span aria-hidden>{badge.emoji}</span> : null}
      <span className="truncate">{badge.label}</span>
    </span>
  );
}

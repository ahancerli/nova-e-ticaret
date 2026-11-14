import Link from "next/link";
import { ChevronIcon } from "@/components/icons";

/** Title row of a storefront section: heading (id for aria-labelledby), optional line under it, "Tümünü gör" link. */
export function SectionHeader({ id, title, subtitle, moreHref, moreLabel = "Tümünü gör" }: {
  id: string; title: string; subtitle?: string | null; moreHref?: string; moreLabel?: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 md:mb-6">
      <div className="min-w-0">
        <h2 id={id} className="font-display text-[22px] font-extrabold leading-tight tracking-[-0.02em] text-ink md:text-[28px]">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {moreHref && (
        <Link href={moreHref} className="group flex h-10 flex-none items-center gap-1 rounded-full pl-3 pr-2 text-sm font-semibold text-ink transition hover:bg-ink/5">
          {moreLabel}<ChevronIcon className="size-4 transition group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

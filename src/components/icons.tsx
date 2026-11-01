// Minimal inline icon set (no extra dependency). All icons are decorative unless given a title.
type P = { className?: string; title?: string };
const base = (title?: string) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": title ? undefined : true,
  role: title ? "img" : undefined,
});

export const SearchIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const CartIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" /><circle cx="10" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></svg>
);
export const UserIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
export const HeartIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
);
export const CloseIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const MenuIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const PlusIcon = ({ className = "h-4 w-4", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M12 5v14M5 12h14" /></svg>
);
export const MinusIcon = ({ className = "h-4 w-4", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M5 12h14" /></svg>
);
export const TrashIcon = ({ className = "h-4 w-4", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
);
export const ChevronIcon = ({ className = "h-4 w-4", title, dir = "right" }: P & { dir?: "left" | "right" }) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d={dir === "right" ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} /></svg>
);
export const CheckIcon = ({ className = "h-4 w-4", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="m5 12 5 5 9-10" /></svg>
);
export const StarIcon = ({ className = "h-3.5 w-3.5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z" /></svg>
);
export const FilterIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M4 6h16M7 12h10M10 18h4" /></svg>
);
export const PauseIcon = ({ className = "h-4 w-4", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M9 6v12M15 6v12" /></svg>
);
export const PlayIcon = ({ className = "h-4 w-4", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="m8 5 11 7-11 7Z" /></svg>
);
export const BellIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M6 9a6 6 0 1 1 12 0v5l2 2H4l2-2Z" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
);
export const SettingsIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="m12 3 1.3 2.7 3 .4-2.1 2 0.5 3-2.7-1.4-2.7 1.4 0.5-3-2.1-2 3-.4Z" /><circle cx="12" cy="12" r="3.3" /><path d="m12 15.3 1.2 2.4 2.8.4-2 1.9.4 2.8-2.4-1.2-2.4 1.2.4-2.8-2-1.9 2.8-.4z" /></svg>
);
export const ChartIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M4 19h16" /><path d="M7 16v-4" /><path d="M12 16V8" /><path d="M17 16v-7" /></svg>
);
export const PackageIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="m12 3 8 4.5v9L12 21 4 16.5v-9Z" /><path d="m12 3 8 4.5-8 4.5-8-4.5Z" /><path d="M12 12v9" /></svg>
);
export const ShieldIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M12 3 5 6v6c0 5 3.4 8 7 9 3.6-1 7-4 7-9V6Z" /><path d="m9.5 12 1.8 1.8 3.2-3.2" /></svg>
);
export const LogoutIcon = ({ className = "h-5 w-5", title }: P) => (
  <svg {...base(title)} className={className}>{title && <title>{title}</title>}<path d="M9 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
);

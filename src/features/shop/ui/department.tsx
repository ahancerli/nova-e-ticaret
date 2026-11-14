import { Baby, BookOpen, Car, Dumbbell, Gamepad2, LayoutGrid, Percent, Shirt, ShoppingBasket, Smartphone, Sofa, Sparkles, Watch, type LucideIcon } from "lucide-react";

/**
 * Department spectrum: a top-level category's colour comes from its position in the menu / section, so the
 * same department keeps the same colour across the header, the home tiles and the mobile menu.
 */
const COLORS = ["var(--color-dept-1)", "var(--color-dept-2)", "var(--color-dept-3)", "var(--color-dept-4)", "var(--color-dept-5)", "var(--color-dept-6)"];

export const deptColor = (index: number) => COLORS[index % COLORS.length]!;

/** Background + text colour of a coloured band; the yellow department needs dark text to stay readable. */
export type Tone = { bg: string; fg: string };
export const BRAND_TONE: Tone = { bg: "var(--color-brand)", fg: "#fff" };
export const INK_TONE: Tone = { bg: "var(--color-ink)", fg: "#fff" };
export const deptTone = (index: number | null): Tone =>
  index == null ? BRAND_TONE : { bg: deptColor(index), fg: index % COLORS.length === 3 ? "var(--color-ink)" : "#fff" };

// Fallback when a category has no uploaded image: an icon guessed from its Turkish name.
const ICONS: [RegExp, LucideIcon][] = [
  [/elektronik|telefon|bilgisayar|tablet|teknoloji/, Smartphone],
  [/moda|giyim|kadın|erkek|ayakkabı/, Shirt],
  [/aksesuar|saat|takı|çanta/, Watch],
  [/ev|yaşam|mobilya|dekorasyon|mutfak/, Sofa],
  [/kitap|kırtasiye|hobi|müzik/, BookOpen],
  [/kozmetik|güzellik|bakım|parfüm/, Sparkles],
  [/anne|bebek|çocuk|oyuncak/, Baby],
  [/spor|outdoor|fitness/, Dumbbell],
  [/oyun|konsol/, Gamepad2],
  [/market|gıda|süpermarket/, ShoppingBasket],
  [/oto|araç|motosiklet/, Car],
  [/fırsat|indirim|kampanya/, Percent],
];

export function DeptIcon({ name, className = "size-6" }: { name: string; className?: string }) {
  const n = name.toLocaleLowerCase("tr-TR");
  const Icon = ICONS.find(([re]) => re.test(n))?.[1] ?? LayoutGrid;
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}

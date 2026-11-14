// Product rules shared by the admin editor (step validation) and the server (authoritative check).

type CategoryRef = { id: string; parentId: string | null };
type CategoryAttribute = { categoryId: string; attributeId: string; isRequired: boolean };

/** Attribute ids required by the selected categories (own or inherited from any ancestor). */
export function requiredAttributeIds(meta: { categories: CategoryRef[]; categoryAttributes: CategoryAttribute[] }, categoryIds: string[]): Set<string> {
  const parent = new Map(meta.categories.map((c) => [c.id, c.parentId]));
  const lineage = new Set<string>();
  for (const id of categoryIds) for (let cur: string | null | undefined = id; cur && !lineage.has(cur); cur = parent.get(cur)) lineage.add(cur);
  return new Set(meta.categoryAttributes.filter((ca) => ca.isRequired && lineage.has(ca.categoryId)).map((ca) => ca.attributeId));
}

/**
 * Struck-through price the shop really shows (Ticaret Bakanlığı 30-day rule): the seller's old price capped by the
 * lowest price of the 30 days before the current price; null when no real reduction remains. Mirrors `shownCompareAtSql`.
 */
export function shownCompareAt(priceMinor: number, compareAtMinor: number | null, lowestPriorMinor: number | null): number | null {
  if (compareAtMinor == null || lowestPriorMinor == null || compareAtMinor <= priceMinor || lowestPriorMinor <= priceMinor) return null;
  return Math.min(compareAtMinor, lowestPriorMinor);
}

export const SKU_PATTERN = /^[A-Za-z0-9._-]+$/;

export type ProductStatus = "draft" | "in_review" | "published" | "paused" | "archived";
export const PRODUCT_STATUSES: { value: ProductStatus; label: string; tone: "slate" | "amber" | "green" | "blue" | "red" }[] = [
  { value: "draft", label: "Taslak", tone: "slate" },
  { value: "in_review", label: "İncelemede", tone: "amber" },
  { value: "published", label: "Yayında", tone: "green" },
  { value: "paused", label: "Durduruldu", tone: "blue" },
  { value: "archived", label: "Arşivlendi", tone: "red" },
];
export const statusMeta = (s: string) => PRODUCT_STATUSES.find((x) => x.value === s) ?? { value: s as ProductStatus, label: s, tone: "slate" as const };

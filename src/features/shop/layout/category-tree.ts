import type { CategoryNode } from "@/lib/types";

/** Depth-first lookup by slug (trees are small: tens of categories). */
export function findCategory(nodes: CategoryNode[], slug: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.slug === slug) return n;
    const hit = findCategory(n.children, slug);
    if (hit) return hit;
  }
  return null;
}

/** Slugs from the root down to `slug` (inclusive), or null when it is not in the tree. */
export function pathTo(nodes: CategoryNode[], slug: string): string[] | null {
  for (const n of nodes) {
    if (n.slug === slug) return [n.slug];
    const rest = pathTo(n.children, slug);
    if (rest) return [n.slug, ...rest];
  }
  return null;
}

/**
 * Header menu position that owns a category (any menu item on its root path) or a page (`href`); it picks the
 * department colour, so a category page wears the colour of its menu item.
 */
export function menuIndexOf(nav: { categorySlug: string | null; href: string }[], categories: CategoryNode[], q: { categorySlug?: string; href?: string }): number | null {
  const path = q.categorySlug ? pathTo(categories, q.categorySlug) ?? [] : [];
  const i = nav.findIndex((n) => (n.categorySlug != null && path.includes(n.categorySlug)) || (q.href != null && n.href === q.href));
  return i < 0 ? null : i;
}

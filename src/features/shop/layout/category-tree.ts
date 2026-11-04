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

import type { ProductCard as Card } from "@/lib/types";
import { ProductCard, ProductCardSkeleton } from "./ProductCard";

const COLS = {
  wide: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  listing: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4",
} as const;

/** Responsive product grid shared by home sections, listings and related products. */
export function ProductGrid({ products, variant = "wide", priorityCount = 0 }: { products: Card[]; variant?: keyof typeof COLS; priorityCount?: number }) {
  return (
    <ul className={`grid gap-3 ${COLS[variant]}`}>
      {products.map((p, i) => <li key={p.id}><ProductCard p={p} priority={i < priorityCount} /></li>)}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 8, variant = "wide" }: { count?: number; variant?: keyof typeof COLS }) {
  return (
    <div className={`grid gap-3 ${COLS[variant]}`} aria-busy="true" aria-label="Ürünler yükleniyor">
      {Array.from({ length: count }, (_, i) => <ProductCardSkeleton key={i} />)}
    </div>
  );
}

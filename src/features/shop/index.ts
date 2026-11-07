/**
 * Storefront ("shop") micro-frontend — the public surface the `(storefront)` routes import. Everything else
 * under src/features/shop is internal: `layout/` (SSR header, mega menu, footer), `home/` (SSR home sections),
 * `listing/` (SSR first page + GraphQL updates), `product/` (variant picker, info tabs, similar products), `reviews/` (product reviews + write dialog), `compare/`
 * (comparison list, dock, /karsilastir table), `ui/` (shared card / price / grid / rail / modal),
 * `data/` (GraphQL client). Server-only entry: client code inside the shop imports relative paths.
 */
export { Header } from "./layout/Header";
export { Footer } from "./layout/Footer";
export { HomeView, HomeSkeleton } from "./home/HomeView";
export { Listing } from "./listing/Listing";
export { loadListing, type PageSearchParams } from "./listing/load";
export { VariantPicker } from "./product/VariantPicker";
export { ProductInfoTabs } from "./product/ProductInfoTabs";
export { SimilarProducts } from "./product/SimilarProducts";
export { ProductGrid } from "./ui/ProductGrid";
export { ProductReviews } from "./reviews/ProductReviews";
export { CompareBar } from "./compare/CompareBar";
export { CompareTable } from "./compare/CompareTable";

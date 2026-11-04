/**
 * Storefront ("shop") micro-frontend — the public surface the `(storefront)` routes import. Everything else
 * under src/features/shop is internal: `layout/` (SSR header, mega menu, footer), `home/` (SSR home sections),
 * `listing/` (SSR first page + GraphQL updates), `product/`, `ui/` (shared card / price / grid / rail),
 * `data/` (GraphQL client). Server-only entry: client code inside the shop imports relative paths.
 */
export { Header } from "./layout/Header";
export { Footer } from "./layout/Footer";
export { HomeView, HomeSkeleton } from "./home/HomeView";
export { Listing } from "./listing/Listing";
export { loadListing, type PageSearchParams } from "./listing/load";
export { VariantPicker } from "./product/VariantPicker";
export { ProductGrid } from "./ui/ProductGrid";

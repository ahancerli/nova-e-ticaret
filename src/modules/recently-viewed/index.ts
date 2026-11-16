/** Public surface of the recently-viewed module: Son gezilenler (product page rail, home section), functional consent only. */
export * from "./domain/recently-viewed";
export { recentListQuery, recentViewSchema } from "./http/schemas";
export { ClearRecentlyViewedToken, ListRecentlyViewedToken, RecordRecentViewToken, registerRecentlyViewed } from "./module";

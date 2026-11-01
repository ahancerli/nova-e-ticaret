import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Incremental cache is intentionally left default. To enable ISR caching later,
// add an R2 bucket binding (NEXT_INC_CACHE_R2_BUCKET) in wrangler.jsonc and use:
//   import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
//   export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
export default defineCloudflareConfig({});

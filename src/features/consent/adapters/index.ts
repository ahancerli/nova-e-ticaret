import { microsoftClarity } from "./clarity";
import { ga4, googleAds, gtm } from "./google";
import { metaPixel } from "./meta";
import { tiktokPixel } from "./tiktok";
import type { TagAdapter } from "./types";
import { yandexMetrica } from "./yandex";

/**
 * Browser adapters by catalog code (consent/domain/tags.ts). A catalog entry marked `ready` must have one here —
 * tests/integration/consent.test.ts checks both lists match.
 */
export const TAG_ADAPTERS: ReadonlyMap<string, TagAdapter> = new Map(
  [ga4, gtm, googleAds, metaPixel, tiktokPixel, microsoftClarity, yandexMetrica].map((a) => [a.code, a]),
);

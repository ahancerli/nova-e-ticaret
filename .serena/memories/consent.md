# Consent (çerez onayı) + tracking tags — module `src/modules/consent`, browser side `src/features/consent`
Panel: Entegrasyonlar › Çerez onayı & izleme `/admin/entegrasyonlar/cerez-onayi` (perm `integrations.write`; tabs Onay banner'ı / İzleme etiketleri / Onay kayıtları).

## Decisions (why it is built this way)
- Own banner instead of Google/3rd-party CMP: Google has no free CMP for shops (its own is AdSense/Ad Manager only); paid CMPs cost per domain, have weak Turkish KVKK texts, add an external script (CSP + speed). Google needs only Consent Mode v2 signals, which our banner sends. Certified-CMP rule applies to EEA traffic only.
- Generic for future firms: (1) consent source pluggable — `consent_settings.consent_provider` builtin | cookiebot | onetrust | usercentrics; only `builtin` is `ready` (`CONSENT_PROVIDERS`), others refused with `provider_not_integrated` until an adapter calls `saveConsent(…, "external")` from `ConsentRoot`. (2) tag vendors = code catalog `domain/tags.ts` `TAG_PROVIDERS` + browser adapter `features/consent/adapters` (`TAG_ADAPTERS`); `tests/integration/consent.test.ts` asserts ready catalog == adapters. Not a DB catalog (unlike `integration_providers`): a vendor needs browser code anyway. (3) one event vocabulary `domain/events.ts` `CommerceEvent` (GA4 names, TL decimals) translated per vendor.
- KVKK rules baked in: nothing optional before a choice; accept and reject identical style/size side by side; no pre-ticked switches; footer “Çerez tercihleri” (`CookiePreferencesLink` → `OPEN_PREFERENCES_EVENT`) reopens the dialog; withdrawal of a category whose tag already ran deletes the vendor cookies (`adapter.cookies`) + `location.reload()` (scripts can't be unloaded).
- Banner off (`banner_enabled = 0`) ⇒ `GetConsentConfig` returns no tags (nobody can consent).
- Google Consent Mode: `basic` (default) = Google tags load only after consent; `advanced` = load up front with all-denied default (cookieless pings). Default `consent default` set once in `adapters/google.ts` before any Google script.

## Revision / cookie
- Cookie `nova_consent` = `1.<revision>.<fam bits>.<visitorId>.<at base36>` (`encodeConsent`/`decodeConsent`). Valid only for same revision and `< consent_max_age_days` (`isConsentCurrent`).
- Revision string `r<consent_settings.revision>-cp<published cookie policy version>` (content `GetCookiePolicy`). Bumped by: panel “Onayı yeniden iste” (`RenewConsent`), activating a vendor that was not active (`SaveTrackingTag`: consent is per vendor list), any cookie-policy page update. Pausing/removing a vendor does not bump.
- Proof: browser POSTs `/api/consent` (public, 20/min/IP, `ip_hash` = rate limiter HMAC, best effort — the cookie is the truth). `cookie_consents` is update-protected (`append_only` trigger) but deletable for retention. Visitor id shown in the preferences dialog; panel searches by it.

## Browser flow
- Storefront layout SSR `GetConsentConfigToken` → `<ConsentRoot config>` (banner + `PreferencesDialog` + `useTagManager`). Store = `consent-store.ts` (useSyncExternalStore; server snapshot `ready:false` → no banner/tags in SSR, no hydration mismatch).
- Screens call only `track(event)` (`features/consent/track.ts`); events queue (≤30) until a tag loads; screens never check consent. Wired: view_item_list (`Listing`, per shown result set), view_item (product page `TrackEvent`), add_to_cart / remove_from_cart (`CartProvider`), view_cart (`CartPage`), begin_checkout (`CheckoutClient`), purchase (`rememberPurchase` in sessionStorage at confirm → `TrackPurchase` on `/siparis/sonuc`, once per order: card payments leave the site), search (`/ara`), sign_up (`SignupForm`), login (`LoginForm`, storefront audience only). SPA page views via `adapter.pageView` on pathname change.
- Adapters write vendor loader stubs in TS (no inline `<script>`); scripts injected by our nonced bundle pass CSP via `'strict-dynamic'`. Beacon/iframe hosts must be in the vendor's `connectSrc`/`frameSrc` (merged into storefront CSP by `TRACKING_CSP` in `src/proxy.ts`; admin unaffected). GTM-loaded third parties outside the catalog hosts get blocked by connect-src.
- GTM gets GA4-format `{event, ecommerce}` + `nova_consent_update`; Yandex uses its own `yandexDataLayer` container (format differs from GA4).

## Add a vendor
Entry in `TAG_PROVIDERS` (fields with regex, category, cookies, connect/frame hosts) + adapter implementing `TagAdapter` in `features/consent/adapters` registered in `TAG_ADAPTERS`. `tracking_tags.config_json` holds public ids only; server keys are `TagProviderDef.secrets` (write-only in the panel, sealed in `tracking_tag_secrets`).

## Server-side purchase (`application/server-tracking.ts`, pure parts `domain/server-tracking.ts`)
- Keys: GA4 `apiSecret` (Measurement Protocol), Meta `accessToken` (Conversions API, Graph `META_GRAPH_VERSION`) + optional public `testEventCode`. `SaveTrackingTag` `secrets`: value = replace, null/"" = remove, missing = keep; needs SECRETS_MASTER_KEY; audit records only set/removed.
- Checkout confirm route → `CaptureOrderTracking` (after the order commit, errors only logged): current `nova_consent` + `_ga`/`_ga_<stream>`/`_fbp`/`_fbc` → `order_tracking_contexts`, only if an allowed vendor has a server key (data minimisation); IP/UA only with marketing consent.
- Outbox `order.paid` (card settle + havale reconcile) → `SendServerPurchase`: GA4 if analytics, Meta if marketing; once per vendor (`ga4_sent_at`/`meta_sent_at`); 5xx/429/network → throw (outbox retry), other 4xx → logged `rejected_<status>`, not retried. Key is in the URL → never logged. Missing `_ga` → client id derived from visitor id hash.
- Dedupe: Meta via `event_id` = order number (same as pixel `eventID`). GA4 has no dedupe → when `apiSecret` is stored `GetConsentConfig` adds `serverPurchase: "1"` to the ga4 browser config and the ga4 adapter skips `purchase` (GTM / Google Ads unaffected). Tests swap HTTP via `TrackingHttpToken`.

## Open / not verified
- Adapters not tested against real vendor accounts (no browser e2e yet); Cookiebot/OneTrust/Usercentrics adapters not written; no retention job pruning old `cookie_consents`; cookie policy text does not yet list vendor cookies automatically (dialog shows them).

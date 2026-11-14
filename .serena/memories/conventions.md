# Conventions
## Backend
- Module layout: `domain/` pure (no I/O) · `application/` one class per use case with `execute()`, deps via constructor (`ports.ts` interfaces) · `infrastructure/` SQL / storage impls, SQL only here · `http/schemas.ts` Zod · `module.ts` `XToken = token<T>()` + `registerX(c)` (`c.scoped(...)`) · `index.ts` exports. New module → also call `registerX(container)` in `src/server/app.ts`.
- Cross-module dependency only through interfaces/`index.ts` (e.g. catalog → `MediaLibrary`).
- Writes: `new UnitOfWork(db).add(stmt)...commit()` (one batch = one transaction). State/existence conditions: `WHERE status = ?` / `AND NOT EXISTS` + `uow.expectChanges(1, () => new ConflictError(...))` inside the batch; never check `changes` after commit. External calls (iyzico, shipping, media file delete) after commit or via outbox (`addOutboxHandler`, handlers idempotent).
- Admin writes add `audit.recordStatement({ actor, action: "<area>.<verb>", entityType, entityId, diff })` to the same UoW. Action labels: `src/modules/audit/domain/audit.ts`.
- Queries return `null` for missing; route throws `NotFoundError("x_not_found", "<Türkçe mesaj>")`.
- Errors: throw `AppError` subclasses from `@/core` (`code` stable snake_case, `message` Turkish). DB trigger codes mapped in `src/core/errors/translate.ts`.
- SQL: parameterized `?`; sort/column names from allowlists; `IN` lists chunked via `placeholders()` (≤100 params/stmt).
- IDs `crypto.randomUUID()` via `IdGenerator`; time via `Clock.nowIso()` (UTC ISO ms). Slugs via `slugify` (Turkish chars folded).
- Optimistic concurrency: editors send `expectedUpdatedAt` / `expectedVersion` → 409 `<entity>_changed`.
## Routes (`src/app/api/**/route.ts`)
- `export const dynamic = "force-dynamic"`; `export const GET = route({ auth: { audience: "admin", permission: "catalog.read" }, params: idParams, body, idempotency?, rateLimit?, csrf?, handle: (ctx) => ctx.resolve(Token).execute(..., actorOf(ctx)) })`. Return plain data (200) or `reply.created`. Response envelope `{data, meta, requestId}` handled by router.
- Admin pages: `await requireAdminPage("<perm>")`, services via `resolveService(Token)`. Permission catalog `src/modules/staff/domain/permissions.ts`; admin nav `NAV` in `src/app/(admin)/admin/layout.tsx`.
## Frontend
- `"use client"` files import only `import type` from `@/modules/<m>`; runtime values from pure `domain/*` files (index pulls server code → 500).
- Components never write raw `fetch`/URLs: use `features/<area>/api.ts` on top of `lib/api-client.ts` (`ClientApiError`, `errorMessage`). Field errors `useFieldErrors()`.
- Lists = `DataGrid`; feedback = `notify.*`; confirm = `AdminConfirmDialog` (no `window.confirm`); edit panel = `AdminDrawer`; overlays via `<Portal>`; each admin route has a `loading.tsx` skeleton.
- UI copy: create → "Oluştur/Ekle", existing → "Güncelle" (never "Kaydet"). Admin accent `#7367f0`, cards `rounded-2xl border-slate-200 shadow-sm`.
- Order actions: `src/lib/order-rules.ts` (`ORDER_ACTIONS`) + `OrderAction` class in `modules/orders/application/actions` + list in `orders/module.ts` + schema.
- No inline `<script>`; CSP sources added in `src/proxy.ts`. Rich HTML rendered only through `sanitizeRichHtml`.
## Storefront (features/shop)
- SSR by default (header, mega menu = CSS group-hover/focus-within, footer, home sections); client islands only for interaction. One `ui/ProductCard` everywhere. Inside shop, client files import relative paths, never the shop `index.ts` (it pulls server code).
- Hybrid data: server components call query services via `resolveService`; browser reads go through `/api/graphql` (read-only, one request per screen). Writes stay REST. New graph field = SDL + `rootValue` in `src/server/graphql/schema.ts` + document in `features/shop/data/graph.ts`; filters reuse `parseListQuery`.
- Brand look: tokens in `globals.css` `@theme` (ink `#191640`, `--color-dept-1..6` department spectrum, `.spectrum` strip, `font-display` Bricolage Grotesque + body Onest via next/font on the storefront layout wrapper only; admin keeps system fonts). Storefront ground is white. Inner pages open with `ui/PageHero` (coloured band + breadcrumb + h1); colour = `deptTone(menuIndexOf(shell.header, shell.categories, { categorySlug | href }))` so a page matches its header-menu dot, else `BRAND_TONE` / `INK_TONE` (brand, search, cart, compare). Auth pages use `ui/AuthShell`. No all-caps eyebrows or `→` in link text.
- Listing: first page SSR (`loadListing`), URL changes via `window.history.pushState` (no server round trip) → one GraphQL refetch; pages pass `key` per scope (slug / search term).
## Tracking
- Screens report shop actions only via `track()` from `features/consent/track` (or `TrackEvent` / `TrackPurchase` from `features/consent/commerce` on SSR pages); never load vendor scripts or check consent in a screen. New vendor = catalog + adapter (`mem:consent`).
## Style
- Dense code, few comments (comments explain why). Comments/identifiers English.

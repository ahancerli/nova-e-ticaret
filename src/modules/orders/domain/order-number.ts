/**
 * Order number as a customer types or pastes it ("#nv261113ssnzuz", "NV 2611 13SS NZUZ", Turkish keyboard "İ",
 * dashes from a mail client) → the stored form (upper-case A-Z, 0-9, "-"). Pure: used by the lookup use case and
 * the storefront form.
 */
export function normalizeOrderNumber(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-")
    .replace(/[İı]/g, "I")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

export const ORDER_NUMBER_PATTERN = /^[A-Z0-9-]{4,40}$/;

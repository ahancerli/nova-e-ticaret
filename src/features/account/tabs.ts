/**
 * Hesabım sections (`/hesabim?sekme=<key>`), shared by the page, the header account menu and e-mail links. Each
 * section wears one department colour, so the tab list reads like the header's category dots.
 */
export const ACCOUNT_TABS = [
  { key: "siparisler", label: "Siparişlerim", tone: "var(--color-dept-1)" },
  { key: "bilgiler", label: "Kişisel bilgilerim", tone: "var(--color-dept-5)" },
  { key: "adresler", label: "Adreslerim", tone: "var(--color-dept-3)" },
  { key: "degerlendirmeler", label: "Değerlendirmelerim", tone: "var(--color-dept-4)" },
  { key: "haber-ver", label: "Haber ver listem", tone: "var(--color-dept-2)" },
  { key: "sifre", label: "Şifre ve güvenlik", tone: "var(--color-brand)" },
] as const;

export type AccountTab = (typeof ACCOUNT_TABS)[number]["key"];

export const accountTabOf = (v: string | undefined): AccountTab => ACCOUNT_TABS.find((t) => t.key === v)?.key ?? "siparisler";
export const accountHref = (tab: AccountTab) => (tab === "siparisler" ? "/hesabim" : `/hesabim?sekme=${tab}`);

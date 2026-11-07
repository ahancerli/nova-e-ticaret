import type { ComponentType } from "react";
import { Boxes, FileText, FolderTree, Images, Search, SlidersHorizontal } from "lucide-react";
import { slugify } from "@/lib/slug";
import { requiredAttributeIds, SKU_PATTERN } from "@/lib/product-rules";
import type { ProductMeta } from "@/modules/catalog";
import { type FormState, type Errors, strToMinor, strToInt } from "./form-state";

// ---------------------------------------------------------------------------
// Steps + client-side validation (mirrors the server rules; the server stays authoritative)
// ---------------------------------------------------------------------------
export type SectionId = "general" | "relations" | "media" | "variants" | "attributes" | "seo";
export const SECTIONS: { id: SectionId; label: string; hint: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "general", label: "Genel bilgiler", hint: "Ad, durum, açıklama", icon: FileText },
  { id: "relations", label: "Marka & Kategori", hint: "Nerede listelenecek", icon: FolderTree },
  { id: "media", label: "Görseller", hint: "Galeri ve vitrin", icon: Images },
  { id: "variants", label: "Varyant & Stok", hint: "Seçenek, fiyat, stok", icon: Boxes },
  { id: "attributes", label: "Özellikler", hint: "Teknik bilgiler", icon: SlidersHorizontal },
  { id: "seo", label: "SEO", hint: "Arama görünümü", icon: Search },
];

export const SECTION_OF = (key: string): SectionId => {
  if (key.startsWith("variants") || key === "axes") return "variants";
  if (key.startsWith("attributes")) return "attributes";
  if (key.startsWith("seo")) return "seo";
  if (key.startsWith("media") || key === "primaryMediaId") return "media";
  if (key === "brandId" || key.startsWith("categories")) return "relations";
  return "general";
};

export type Ctx = { meta: ProductMeta; canPublish: boolean; wasPublished: boolean };

export function validate(f: FormState, ctx: Ctx): Errors {
  const e: Errors = {};
  const add = (k: string, m: string) => void (e[k] ??= []).push(m);

  // general
  if (f.name.trim().length < 2) add("name", "Ürün adı en az 2 karakter olmalı.");
  if (f.slug.trim() && slugify(f.slug).length < 2) add("slug", "Geçerli bir slug girin.");
  if (f.countryOfOrigin && !/^[A-Z]{2}$/.test(f.countryOfOrigin)) add("countryOfOrigin", "İki harfli ülke kodu girin (örn. TR).");
  if (Number.isNaN(strToInt(f.warrantyMonths))) add("warrantyMonths", "Tam sayı girin.");
  if (f.modelCode.trim() && !SKU_PATTERN.test(f.modelCode.trim())) add("modelCode", "Harf, rakam, nokta, tire ve alt çizgi kullanın.");
  if (f.status === "published" && !ctx.canPublish && !ctx.wasPublished) add("status", "Yayına alma yetkiniz yok.");
  // relations
  if (!f.categories.length) add("categories", "En az bir kategori seçin.");
  // media
  if (f.status === "published" && !f.media.length && !f.variants.some((v) => v.isActive && v.media.length)) add("media", "Yayındaki bir ürün için en az bir görsel ekleyin (galeri veya varyant görseli).");
  // variants
  if (!f.axes.length && f.variants.length > 1) add("axes", "Birden fazla varyant için en az bir eksen (Renk, Beden…) seçin.");
  const skus = new Map<string, number>(), combos = new Map<string, number>();
  f.variants.forEach((v, i) => {
    const k = (x: string) => `variants.${i}.${x}`;
    const sku = v.sku.trim().toUpperCase();
    if (!sku) add(k("sku"), "SKU gerekli.");
    else if (!SKU_PATTERN.test(sku)) add(k("sku"), "Harf, rakam, nokta, tire ve alt çizgi kullanın.");
    else if (skus.has(sku)) add(k("sku"), `SKU ${skus.get(sku)! + 1}. varyantta da var.`);
    skus.set(sku, i);
    const price = strToMinor(v.price), compare = strToMinor(v.compareAt);
    if (price == null) add(k("priceMinor"), "Satış fiyatı gerekli.");
    else if (Number.isNaN(price)) add(k("priceMinor"), "Geçerli bir tutar girin (örn. 1.299,90).");
    if (compare != null && (Number.isNaN(compare) || (price != null && !Number.isNaN(price) && compare <= price))) add(k("compareAtMinor"), "Eski fiyat, satış fiyatından büyük olmalı.");
    const floor = strToMinor(v.minPrice);
    if (floor != null && (Number.isNaN(floor) || (price != null && !Number.isNaN(price) && floor > price))) add(k("minPriceMinor"), "Taban fiyat, satış fiyatından büyük olamaz.");
    const stock = strToInt(v.stock);
    if (stock == null || Number.isNaN(stock)) add(k("stock"), "Stok adedi girin.");
    else if (stock < v.reserved) add(k("stock"), `Rezerve ${v.reserved} adetin altına inemez.`);
    for (const x of ["weightGrams", "widthMm", "heightMm", "depthMm"] as const) if (Number.isNaN(strToInt(v[x]))) add(k(x), "Tam sayı girin.");
    if (f.axes.length) {
      const missing = f.axes.filter((a) => !v.options[a]);
      missing.forEach((a) => add(k(`options.${a}`), "Seçim yapın."));
      if (!missing.length) {
        const key = f.axes.map((a) => v.options[a]).join("|");
        if (combos.has(key)) add(k("options"), `Bu kombinasyon ${combos.get(key)! + 1}. varyantta da var.`);
        combos.set(key, i);
      }
    }
  });
  // attributes required by the chosen categories
  const attrById = new Map(ctx.meta.attributes.map((a) => [a.id, a]));
  for (const id of requiredAttributeIds(ctx.meta, f.categories.map((c) => c.id))) {
    if (f.axes.includes(id)) continue;
    if (!(f.attributes[id] ?? []).some((v) => v !== "")) add(`attributes.${id}`, `${attrById.get(id)?.label ?? "Bu özellik"} bu kategori için zorunlu.`);
  }
  for (const [id, vals] of Object.entries(f.attributes)) {
    if (attrById.get(id)?.dataType === "number" && vals.some((v) => v !== "" && !Number.isFinite(Number(String(v).replace(",", "."))))) add(`attributes.${id}`, "Sayı girin.");
  }
  // seo
  if (f.seo.metaTitle.length > 120) add("seo.metaTitle", "En fazla 120 karakter.");
  if (f.seo.metaDescription.length > 320) add("seo.metaDescription", "En fazla 320 karakter.");
  if (f.seo.canonicalUrl && !/^(https:\/\/|\/)/.test(f.seo.canonicalUrl)) add("seo.canonicalUrl", "https:// veya / ile başlamalı.");
  return e;
}

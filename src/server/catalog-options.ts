import "server-only";
import { ListBrandsToken, ListCategoryTreeToken, ListProductsToken } from "@/modules/catalog";
import type { TargetOption } from "@/features/campaigns/TargetPicker";
import { resolveService } from "@/server/app";

/** Picker options for admin editors (campaign scope, home sections): categories with path, brands, products with brand. */
export async function catalogPickerOptions(): Promise<{ products: TargetOption[]; brands: TargetOption[]; categories: TargetOption[] }> {
  const [products, brands, tree] = await Promise.all([
    resolveService(ListProductsToken).then((q) => q.execute()),
    resolveService(ListBrandsToken).then((q) => q.execute()),
    resolveService(ListCategoryTreeToken).then((q) => q.execute()),
  ]);
  const byId = new Map(tree.flat.map((c) => [c.id, c]));
  const path = (id: string | null): string[] => {
    const c = id ? byId.get(id) : undefined;
    return c ? [...path(c.parentId), c.name] : [];
  };
  return {
    categories: tree.flat.map((c) => ({ id: c.id, label: c.name, hint: c.parentId ? path(c.parentId).join(" › ") : undefined })),
    brands: brands.map((b) => ({ id: b.id, label: b.name })),
    products: products.filter((p) => p.status !== "archived").map((p) => ({ id: p.id, label: p.name, hint: [p.brandName, p.categoryName].filter(Boolean).join(" · ") || undefined })),
  };
}

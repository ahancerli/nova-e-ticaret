import { requirePermission } from "@/server/auth";
import { getProductMeta } from "@/server/services/admin-products";
import { ProductEditor } from "@/components/admin/ProductEditor";

export const metadata = { title: "Yeni ürün" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const user = await requirePermission("catalog.write");
  const meta = await getProductMeta();
  return <ProductEditor initial={null} meta={meta} canPublish={user.permissions.has("catalog.publish")} />;
}

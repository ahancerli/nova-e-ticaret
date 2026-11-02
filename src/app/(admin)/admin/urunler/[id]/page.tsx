import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth";
import { getProductEditor, getProductMeta } from "@/server/services/admin-products";
import { ProductEditor } from "@/components/admin/ProductEditor";

export const metadata = { title: "Ürünü düzenle" };
export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("catalog.write");
  const { id } = await params;
  const [product, meta] = await Promise.all([getProductEditor(id), getProductMeta()]);
  if (!product) notFound();
  // key: navigating between two products must not reuse the previous form state.
  return <ProductEditor key={product.id} initial={product} meta={meta} canPublish={user.permissions.has("catalog.publish")} />;
}

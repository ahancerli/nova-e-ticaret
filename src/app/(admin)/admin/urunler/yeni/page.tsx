import { GetProductMetaToken } from "@/modules/catalog";
import { requireAdminPage, resolveService } from "@/server/app";
import { ProductEditor } from "@/features/catalog/products/ProductEditor";

export const metadata = { title: "Yeni ürün" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const user = await requireAdminPage("catalog.write");
  const meta = await (await resolveService(GetProductMetaToken)).execute();
  return <ProductEditor initial={null} meta={meta} canPublish={user.permissions.has("catalog.publish")} />;
}

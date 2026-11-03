import { GetAiIntegrationToken } from "@/modules/ai";
import { GetProductMetaToken } from "@/modules/catalog";
import { requireAdminPage, resolveService } from "@/server/app";
import { ProductEditor } from "@/features/catalog/products/ProductEditor";

export const metadata = { title: "Yeni ürün" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const user = await requireAdminPage("catalog.write");
  const [meta, ai] = await Promise.all([
    resolveService(GetProductMetaToken).then((q) => q.execute()),
    resolveService(GetAiIntegrationToken).then((q) => q.execute()),
  ]);
  return <ProductEditor initial={null} meta={meta} canPublish={user.permissions.has("catalog.publish")} ai={ai ? { providerLabel: ai.providerLabel } : null} />;
}

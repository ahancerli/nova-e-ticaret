import { ListProductsToken } from "@/modules/catalog";
import { requireAdminPage, resolveService } from "@/server/app";
import { ProductsManager } from "@/components/admin/ProductsManager";

export const metadata = { title: "Ürünler" };
export const dynamic = "force-dynamic";

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ vurgula?: string }> }) {
  const user = await requireAdminPage("catalog.read");
  const [rows, { vurgula }] = await Promise.all([resolveService(ListProductsToken).then((q) => q.execute()), searchParams]);
  const highlightId = vurgula && rows.some((r) => r.id === vurgula) ? vurgula : null;
  return <ProductsManager key={highlightId ?? "list"} rows={rows} canWrite={user.permissions.has("catalog.write")} highlightId={highlightId} />;
}

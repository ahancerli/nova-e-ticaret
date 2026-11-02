import { requirePermission } from "@/server/auth";
import { listAdminProducts } from "@/server/services/admin-products";
import { ProductsManager } from "@/components/admin/ProductsManager";

export const metadata = { title: "Ürünler" };
export const dynamic = "force-dynamic";

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<{ vurgula?: string }> }) {
  const user = await requirePermission("catalog.read");
  const [rows, { vurgula }] = await Promise.all([listAdminProducts(), searchParams]);
  const highlightId = vurgula && rows.some((r) => r.id === vurgula) ? vurgula : null;
  return <ProductsManager key={highlightId ?? "list"} rows={rows} canWrite={user.permissions.has("catalog.write")} highlightId={highlightId} />;
}

import { requirePermission } from "@/server/auth";
import { listBrands } from "@/server/services/admin-brands";
import { BrandsManager } from "@/components/admin/BrandsManager";

export const metadata = { title: "Markalar" };
export const dynamic = "force-dynamic";

export default async function AdminBrandsPage({ searchParams }: { searchParams: Promise<{ eklendi?: string }> }) {
  await requirePermission("catalog.write");
  const [brands, { eklendi }] = await Promise.all([listBrands(), searchParams]);
  const createdId = eklendi && brands.some((b) => b.id === eklendi) ? eklendi : null;
  return <BrandsManager key={createdId ?? "list"} initial={brands} createdId={createdId} />;
}

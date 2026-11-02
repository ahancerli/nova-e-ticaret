import { ListBrandsToken } from "@/modules/catalog";
import { requireAdminPage, resolveService } from "@/server/app";
import { BrandsManager } from "@/components/admin/BrandsManager";

export const metadata = { title: "Markalar" };
export const dynamic = "force-dynamic";

export default async function AdminBrandsPage({ searchParams }: { searchParams: Promise<{ eklendi?: string }> }) {
  await requireAdminPage("catalog.write");
  const [brands, { eklendi }] = await Promise.all([resolveService(ListBrandsToken).then((q) => q.execute()), searchParams]);
  const createdId = eklendi && brands.some((b) => b.id === eklendi) ? eklendi : null;
  return <BrandsManager key={createdId ?? "list"} initial={brands} createdId={createdId} />;
}

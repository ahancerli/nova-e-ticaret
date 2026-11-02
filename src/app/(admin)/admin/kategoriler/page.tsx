import { requirePermission } from "@/server/auth";
import { listCategoryTree } from "@/server/services/admin-categories";
import { CategoriesManager } from "@/components/admin/CategoriesManager";

export const metadata = { title: "Kategoriler" };
export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage({ searchParams }: { searchParams: Promise<{ eklendi?: string }> }) {
  await requirePermission("catalog.write");
  const [initial, { eklendi }] = await Promise.all([listCategoryTree(), searchParams]);
  const createdId = eklendi && initial.flat.some((n) => n.id === eklendi) ? eklendi : null;
  return <CategoriesManager key={createdId ?? "list"} initial={initial} createdId={createdId} />;
}

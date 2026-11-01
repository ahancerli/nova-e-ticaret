import { requirePermission } from "@/server/auth";
import { listCategoryTree } from "@/server/services/admin-categories";
import { CategoriesManager } from "@/components/admin/CategoriesManager";

export const metadata = { title: "Kategoriler" };
export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  await requirePermission("catalog.write");
  const initial = await listCategoryTree();
  return <CategoriesManager initial={initial} />;
}


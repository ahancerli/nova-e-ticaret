import { ListCategoryTreeToken } from "@/modules/catalog";
import { requireAdminPage, resolveService } from "@/server/app";
import { CategoriesManager } from "@/components/admin/CategoriesManager";

export const metadata = { title: "Kategoriler" };
export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage({ searchParams }: { searchParams: Promise<{ eklendi?: string }> }) {
  await requireAdminPage("catalog.write");
  const [initial, { eklendi }] = await Promise.all([resolveService(ListCategoryTreeToken).then((q) => q.execute()), searchParams]);
  const createdId = eklendi && initial.flat.some((n) => n.id === eklendi) ? eklendi : null;
  return <CategoriesManager key={createdId ?? "list"} initial={initial} createdId={createdId} />;
}

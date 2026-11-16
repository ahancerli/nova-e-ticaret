import { SearchManager } from "@/features/search/SearchManager";
import { GetSearchAdminToken } from "@/modules/search";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Arama" };
export const dynamic = "force-dynamic";

export default async function SearchAdminPage() {
  await requireAdminPage("catalog.write");
  const view = await resolveService(GetSearchAdminToken).then((q) => q.execute());
  return <SearchManager view={view} />;
}

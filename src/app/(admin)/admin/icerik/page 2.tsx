import { ContentManager } from "@/features/content/ContentManager";
import { ListPagesToken } from "@/modules/content";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "İçerik yönetimi" };
export const dynamic = "force-dynamic";

export default async function AdminContentPage({ searchParams }: { searchParams: Promise<{ vurgula?: string }> }) {
  await requireAdminPage("content.write");
  const [pages, { vurgula }] = await Promise.all([resolveService(ListPagesToken).then((q) => q.execute()), searchParams]);
  const highlightId = vurgula && pages.some((p) => p.id === vurgula) ? vurgula : null;
  return <ContentManager pages={pages} highlightId={highlightId} />;
}

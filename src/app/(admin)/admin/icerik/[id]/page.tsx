import { notFound } from "next/navigation";
import { PageEditor } from "@/features/content/PageEditor";
import { GetPageToken } from "@/modules/content";
import { GetTemplateVariablesToken, TEMPLATE_VARIABLES } from "@/modules/settings";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Sayfa düzenle" };
export const dynamic = "force-dynamic";

export default async function EditContentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("content.write");
  const { id } = await params;
  const [page, values] = await Promise.all([
    resolveService(GetPageToken).then((q) => q.execute(id)),
    resolveService(GetTemplateVariablesToken).then((q) => q.execute()),
  ]);
  if (!page) notFound();
  const { revisions, ...detail } = page;
  return <PageEditor key={`${page.id}-${page.version}`} page={detail} revisions={revisions} variables={TEMPLATE_VARIABLES} values={values} />;
}

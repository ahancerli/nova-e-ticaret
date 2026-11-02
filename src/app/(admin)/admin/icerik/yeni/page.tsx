import { PageEditor } from "@/features/content/PageEditor";
import { LEGAL_TEMPLATES, LEGAL_TYPES, isLegalType } from "@/modules/content";
import { GetTemplateVariablesToken, TEMPLATE_VARIABLES } from "@/modules/settings";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Yeni sayfa" };
export const dynamic = "force-dynamic";

/** New content page; ?tur=<legal type> starts from that legal template. */
export default async function NewContentPage({ searchParams }: { searchParams: Promise<{ tur?: string }> }) {
  await requireAdminPage("content.write");
  const [{ tur }, values] = await Promise.all([searchParams, resolveService(GetTemplateVariablesToken).then((q) => q.execute())]);
  const seed = isLegalType(tur)
    ? {
      kind: "legal" as const, legalType: tur, title: LEGAL_TEMPLATES[tur].title, slug: LEGAL_TYPES[tur].slug, summary: LEGAL_TEMPLATES[tur].summary,
      bodyHtml: LEGAL_TEMPLATES[tur].bodyHtml, footerColumn: LEGAL_TYPES[tur].footer,
    }
    : undefined;
  return <PageEditor key={tur ?? "blank"} page={null} seed={seed} variables={TEMPLATE_VARIABLES} values={values} />;
}

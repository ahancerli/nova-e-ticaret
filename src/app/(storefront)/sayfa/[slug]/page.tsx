import { notFound } from "next/navigation";
import { sanitizeRichHtml } from "@/core";
import { GetContentPageToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

type Props = { params: Promise<{ slug: string }> };

export default async function ContentPage({ params }: Props) {
  const page = await (await resolveService(GetContentPageToken)).execute((await params).slug);
  if (!page) notFound();
  return (
    <article className="container-page max-w-3xl py-10">
      <h1 className="mb-6 text-3xl font-bold">{page.title}</h1>
      <div className="space-y-4 text-ink-soft" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(page.bodyHtml) }} />
    </article>
  );
}

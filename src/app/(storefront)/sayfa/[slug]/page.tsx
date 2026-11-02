import { notFound } from "next/navigation";
import { queryFirst } from "@/server/db";
import { sanitizeRichHtml } from "@/core";

type Props = { params: Promise<{ slug: string }> };

export default async function ContentPage({ params }: Props) {
  const page = await queryFirst<{ title: string; body_html: string }>(
    "SELECT title, body_html FROM content_pages WHERE slug = ? AND is_published = 1", (await params).slug);
  if (!page) notFound();
  return (
    <article className="container-page max-w-3xl py-10">
      <h1 className="mb-6 text-3xl font-bold">{page.title}</h1>
      <div className="space-y-4 text-ink-soft" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(page.body_html) }} />
    </article>
  );
}

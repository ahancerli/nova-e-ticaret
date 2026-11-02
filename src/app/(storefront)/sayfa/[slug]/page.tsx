import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { GetPublishedPageToken } from "@/modules/content";
import { resolveService } from "@/server/app";

type Props = { params: Promise<{ slug: string }> };

const updatedFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });

// One read per request for both generateMetadata and the page.
const loadPage = cache(async (slug: string) => (await resolveService(GetPublishedPageToken)).execute(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadPage((await params).slug);
  if (!page) return {};
  return {
    title: page.seo.metaTitle ?? page.title,
    description: page.seo.metaDescription ?? page.summary ?? undefined,
    robots: page.seo.noindex ? { index: false, follow: true } : undefined,
    alternates: { canonical: `/sayfa/${page.slug}` },
  };
}

/** Published content page (legal texts, corporate, help): placeholders already filled from Site ayarları. */
export default async function ContentPage({ params }: Props) {
  const page = await loadPage((await params).slug);
  if (!page) notFound();
  return (
    <article className="container-page max-w-3xl py-10">
      <nav aria-label="Konum" className="mb-6 text-sm text-muted">
        <Link href="/" className="hover:text-ink">Ana sayfa</Link> <span aria-hidden>/</span> <span className="text-ink-soft">{page.title}</span>
      </nav>
      <header className="mb-8 border-b border-line pb-6">
        <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
        {page.summary && <p className="mt-3 text-ink-soft">{page.summary}</p>}
        <p className="mt-3 text-xs text-muted">
          Son güncelleme: {updatedFmt.format(new Date(page.updatedAt))}
          {page.legalType ? ` · Sürüm ${page.version}` : ""}
        </p>
      </header>
      <div className="rich-text text-ink-soft" dangerouslySetInnerHTML={{ __html: page.html }} />
    </article>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { INK_TONE, Listing, loadListing, type PageSearchParams } from "@/features/shop";
import { GetBrandPageToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<PageSearchParams> };

const load = (slug: string) =>
  resolveService(GetBrandPageToken).then((q) => q.execute(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const b = await load((await params).slug);
  return b ? { title: b.name, description: b.description ?? undefined } : {};
}

export default async function BrandPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const b = await load(slug);
  if (!b) notFound();
  const scope = { brand: slug };
  const initial = await loadListing(await searchParams, scope);
  return <Listing key={slug} title={b.name} subtitle={b.description ?? undefined} tone={INK_TONE} scope={scope} initial={initial} breadcrumb={[{ name: "Markalar", href: "/markalar" }]} />;
}

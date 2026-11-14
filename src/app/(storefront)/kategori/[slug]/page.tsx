import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing, deptTone, loadListing, menuIndexOf, type PageSearchParams } from "@/features/shop";
import { GetCategoryPageToken, GetShellToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<PageSearchParams> };

const load = async (slug: string) => (await resolveService(GetCategoryPageToken)).execute(slug);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await load((await params).slug);
  if (!c) return {};
  return { title: c.metaTitle ?? c.name, description: c.metaDescription ?? undefined, robots: c.noindex ? { index: false } : undefined };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const c = await load(slug);
  if (!c) notFound();
  const scope = { category: slug };
  const [initial, shell] = await Promise.all([loadListing(await searchParams, scope), resolveService(GetShellToken).then((q) => q.execute())]);
  // The band wears the colour of the menu item this category sits under (same as its dot in the header).
  const tone = deptTone(menuIndexOf(shell.header, shell.categories, { categorySlug: slug }));
  return <Listing key={slug} title={c.name} scope={scope} initial={initial} tone={tone} breadcrumb={[{ name: "Kategoriler", href: "/kategoriler" }]} />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ListingClient } from "@/components/storefront/ListingClient";
import { GetCategoryPageToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

type Props = { params: Promise<{ slug: string }> };

const load = async (slug: string) => (await resolveService(GetCategoryPageToken)).execute(slug);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await load((await params).slug);
  if (!c) return {};
  return { title: c.metaTitle ?? c.name, description: c.metaDescription ?? undefined, robots: c.noindex ? { index: false } : undefined };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const c = await load(slug);
  if (!c) notFound();
  return <Suspense><ListingClient title={c.name} scope={{ category: slug }} /></Suspense>;
}

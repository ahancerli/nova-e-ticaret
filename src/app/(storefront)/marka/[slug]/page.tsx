import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ListingClient } from "@/components/storefront/ListingClient";
import { queryFirst } from "@/server/db";

type Props = { params: Promise<{ slug: string }> };

const load = (slug: string) =>
  queryFirst<{ name: string; description: string | null }>("SELECT name, description FROM brands WHERE slug = ? AND is_active = 1", slug);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const b = await load((await params).slug);
  return b ? { title: b.name, description: b.description ?? undefined } : {};
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const b = await load(slug);
  if (!b) notFound();
  return <Suspense><ListingClient title={b.name} scope={{ brand: slug }} /></Suspense>;
}

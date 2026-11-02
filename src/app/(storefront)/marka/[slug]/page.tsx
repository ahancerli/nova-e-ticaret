import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ListingClient } from "@/features/storefront/ListingClient";
import { GetBrandPageToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

type Props = { params: Promise<{ slug: string }> };

const load = (slug: string) =>
  resolveService(GetBrandPageToken).then((q) => q.execute(slug));

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

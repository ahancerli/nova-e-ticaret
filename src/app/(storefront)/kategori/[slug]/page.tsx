import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ListingClient } from "@/components/storefront/ListingClient";
import { queryFirst } from "@/server/db";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  return queryFirst<{ name: string; meta_title: string | null; meta_description: string | null; noindex: number | null }>(
    `SELECT c.name, s.meta_title, s.meta_description, s.noindex FROM categories c
       LEFT JOIN seo_documents s ON s.category_id = c.id WHERE c.slug = ? AND c.is_active = 1`, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await load((await params).slug);
  if (!c) return {};
  return { title: c.meta_title ?? c.name, description: c.meta_description ?? undefined, robots: c.noindex ? { index: false } : undefined };
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const c = await load(slug);
  if (!c) notFound();
  return <Suspense><ListingClient title={c.name} scope={{ category: slug }} /></Suspense>;
}

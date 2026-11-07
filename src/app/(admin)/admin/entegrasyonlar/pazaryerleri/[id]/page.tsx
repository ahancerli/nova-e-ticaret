import { notFound } from "next/navigation";
import { MarketplaceDetail } from "@/features/marketplaces/MarketplaceDetail";
import { ListAttributesToken } from "@/modules/catalog";
import { GetMarketplaceConnectionToken } from "@/modules/marketplaces";
import { requireAdminPage, resolveService } from "@/server/app";
import { catalogPickerOptions } from "@/server/catalog-options";

export const metadata = { title: "Pazaryeri bağlantısı" };
export const dynamic = "force-dynamic";

export default async function MarketplaceConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("integrations.write");
  const { id } = await params;
  const [detail, options, attributes] = await Promise.all([
    resolveService(GetMarketplaceConnectionToken).then((q) => q.execute(id)),
    catalogPickerOptions(),
    resolveService(ListAttributesToken).then((q) => q.execute()),
  ]);
  if (!detail) notFound();
  return <MarketplaceDetail key={detail.connection.updatedAt} detail={detail} refs={{ ...options, attributes }} />;
}

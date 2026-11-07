import { MarketplacesList } from "@/features/marketplaces/MarketplacesList";
import { ListMarketplaceConnectionsToken } from "@/modules/marketplaces";
import { MessageBusToken } from "@/modules/messaging";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Pazaryerleri" };
export const dynamic = "force-dynamic";

export default async function MarketplacesPage() {
  await requireAdminPage("integrations.write");
  const [connections, bus] = await Promise.all([
    resolveService(ListMarketplaceConnectionsToken).then((q) => q.execute()),
    resolveService(MessageBusToken).then(async (b) => ({ kind: b.kind, ...(await b.status()) })),
  ]);
  return <MarketplacesList connections={connections} bus={bus} />;
}

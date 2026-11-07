import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MessageBusToken, RelayCatalogChangesToken, TopicPrefixToken } from "@/modules/messaging";
import {
  DeleteMarketplaceConnection, GetMarketplaceConnection, ListMarketplaceConnections, MarketplaceListings, MarketplaceReference, RunIntegrations, RunMarketplaceSync,
  SaveMarketplaceConnection, SaveMarketplaceMappings, TestMarketplaceConnection, clientFor, type ConnectionDeps,
} from "./application/connection-use-cases";
import { ImportMarketplacePackage } from "./application/order-import";
import type { ClientFactory, MarketplaceOrderWriter, MarketplaceRepository } from "./application/ports";
import { MarketplaceSync } from "./application/sync";
import { MarketplaceErrors } from "./domain/errors";
import { D1MarketplaceOrderWriter } from "./infrastructure/d1-marketplace-orders";
import { D1MarketplaceRepository } from "./infrastructure/d1-marketplace.repository";
import { TrendyolClient } from "./infrastructure/trendyol-client";

export const MarketplaceRepositoryToken = token<MarketplaceRepository>("MarketplaceRepository");
export const MarketplaceOrderWriterToken = token<MarketplaceOrderWriter>("MarketplaceOrderWriter");
/** Builds a marketplace API client (tests swap it for a fake). */
export const MarketplaceClientFactoryToken = token<ClientFactory>("MarketplaceClientFactory");
export const ImportMarketplacePackageToken = token<ImportMarketplacePackage>("ImportMarketplacePackage");
export const MarketplaceSyncToken = token<MarketplaceSync>("MarketplaceSync");
export const ListMarketplaceConnectionsToken = token<ListMarketplaceConnections>("ListMarketplaceConnections");
export const GetMarketplaceConnectionToken = token<GetMarketplaceConnection>("GetMarketplaceConnection");
export const SaveMarketplaceConnectionToken = token<SaveMarketplaceConnection>("SaveMarketplaceConnection");
export const DeleteMarketplaceConnectionToken = token<DeleteMarketplaceConnection>("DeleteMarketplaceConnection");
export const TestMarketplaceConnectionToken = token<TestMarketplaceConnection>("TestMarketplaceConnection");
export const MarketplaceReferenceToken = token<MarketplaceReference>("MarketplaceReference");
export const SaveMarketplaceMappingsToken = token<SaveMarketplaceMappings>("SaveMarketplaceMappings");
export const MarketplaceListingsToken = token<MarketplaceListings>("MarketplaceListings");
export const RunMarketplaceSyncToken = token<RunMarketplaceSync>("RunMarketplaceSync");
export const RunIntegrationsToken = token<RunIntegrations>("RunIntegrations");

const defaultFactory: ClientFactory = (c, creds) => {
  if (c.provider === "trendyol") return new TrendyolClient({ environment: c.environment, sellerId: c.sellerId }, creds);
  throw MarketplaceErrors.notReady();
};

export function registerMarketplaces(c: Container): void {
  c.scoped(MarketplaceRepositoryToken, (r) => new D1MarketplaceRepository(r.resolve(DatabaseToken)));
  c.scoped(MarketplaceOrderWriterToken, (r) => new D1MarketplaceOrderWriter(r.resolve(DatabaseToken)));
  c.singleton(MarketplaceClientFactoryToken, () => defaultFactory);
  const deps = (r: Resolver): ConnectionDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(MarketplaceRepositoryToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken),
    ids: r.resolve(IdGeneratorToken), masterKey: r.resolve(ConfigToken).secretsMasterKey, factory: r.resolve(MarketplaceClientFactoryToken),
  });
  c.scoped(ImportMarketplacePackageToken, (r) => new ImportMarketplacePackage({
    db: r.resolve(DatabaseToken), repo: r.resolve(MarketplaceRepositoryToken), writer: r.resolve(MarketplaceOrderWriterToken),
    ids: r.resolve(IdGeneratorToken), clock: r.resolve(ClockToken), logger: r.resolve(LoggerToken),
  }));
  c.scoped(MarketplaceSyncToken, (r) => new MarketplaceSync({
    repo: r.resolve(MarketplaceRepositoryToken), bus: r.resolve(MessageBusToken), prefix: r.resolve(TopicPrefixToken), clientFor: (conn) => clientFor(deps(r), conn),
    importer: r.resolve(ImportMarketplacePackageToken), clock: r.resolve(ClockToken), logger: r.resolve(LoggerToken), siteUrl: r.resolve(ConfigToken).publicSiteUrl,
  }));
  c.scoped(ListMarketplaceConnectionsToken, (r) => new ListMarketplaceConnections(r.resolve(MarketplaceRepositoryToken)));
  c.scoped(GetMarketplaceConnectionToken, (r) => new GetMarketplaceConnection(r.resolve(MarketplaceRepositoryToken), r.resolve(MessageBusToken)));
  c.scoped(SaveMarketplaceConnectionToken, (r) => new SaveMarketplaceConnection(deps(r)));
  c.scoped(DeleteMarketplaceConnectionToken, (r) => new DeleteMarketplaceConnection(deps(r)));
  c.scoped(TestMarketplaceConnectionToken, (r) => new TestMarketplaceConnection(deps(r)));
  c.scoped(MarketplaceReferenceToken, (r) => new MarketplaceReference(deps(r)));
  c.scoped(SaveMarketplaceMappingsToken, (r) => new SaveMarketplaceMappings(deps(r)));
  c.scoped(MarketplaceListingsToken, (r) => new MarketplaceListings(deps(r)));
  c.scoped(RunMarketplaceSyncToken, (r) => new RunMarketplaceSync(r.resolve(MarketplaceSyncToken), r.resolve(RelayCatalogChangesToken)));
  c.scoped(RunIntegrationsToken, (r) => new RunIntegrations(r.resolve(MarketplaceSyncToken), r.resolve(RelayCatalogChangesToken)));
}

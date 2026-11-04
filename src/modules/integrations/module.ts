import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { SecretVaultToken } from "@/modules/platform/secrets";
import { GetPublicSettingsToken } from "@/modules/settings";
import {
  GetIntegrationPage, IntegrationRuntime, RemoveIntegration, SaveIntegration, TestIntegration, type IntegrationDeps,
} from "./application/integration-use-cases";
import type { ConnectorRegistry, IntegrationRepository } from "./application/ports";
import { defaultConnectors } from "./infrastructure/connectors";
import { D1IntegrationRepository } from "./infrastructure/d1-integration.repository";

/** Adapters by provider code; tests replace this token with fakes. */
export const ConnectorRegistryToken = token<ConnectorRegistry>("ConnectorRegistry");
export const IntegrationRepositoryToken = token<IntegrationRepository>("IntegrationRepository");
/** Port for shipping (carrier) and notifications (SMS). */
export const IntegrationRuntimeToken = token<IntegrationRuntime>("IntegrationRuntime");
export const GetIntegrationPageToken = token<GetIntegrationPage>("GetIntegrationPage");
export const SaveIntegrationToken = token<SaveIntegration>("SaveIntegration");
export const RemoveIntegrationToken = token<RemoveIntegration>("RemoveIntegration");
export const TestIntegrationToken = token<TestIntegration>("TestIntegration");

export function registerIntegrations(c: Container): void {
  const deps = (r: Resolver): IntegrationDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(IntegrationRepositoryToken), vault: r.resolve(SecretVaultToken), audit: r.resolve(AuditLogToken),
    clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken), registry: r.resolve(ConnectorRegistryToken), masterKey: r.resolve(ConfigToken).secretsMasterKey,
  });
  c.singleton(ConnectorRegistryToken, () => defaultConnectors());
  c.scoped(IntegrationRepositoryToken, (r) => new D1IntegrationRepository(r.resolve(DatabaseToken)));
  c.scoped(IntegrationRuntimeToken, (r) => new IntegrationRuntime(r.resolve(IntegrationRepositoryToken), r.resolve(SecretVaultToken), r.resolve(ConnectorRegistryToken)));
  c.scoped(GetIntegrationPageToken, (r) => new GetIntegrationPage(r.resolve(IntegrationRepositoryToken), r.resolve(ConnectorRegistryToken)));
  c.scoped(SaveIntegrationToken, (r) => new SaveIntegration(deps(r)));
  c.scoped(RemoveIntegrationToken, (r) => new RemoveIntegration(deps(r)));
  c.scoped(TestIntegrationToken, (r) => new TestIntegration(
    r.resolve(IntegrationRuntimeToken), async () => (await r.resolve(GetPublicSettingsToken).execute()).siteName,
  ));
}

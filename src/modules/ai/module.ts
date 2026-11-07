import { ClockToken, ConfigToken, DatabaseToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MediaLibraryToken } from "@/modules/media";
import { GenerateProductContent, GetAiIntegration, ListAiModels, RemoveAiIntegration, SaveAiIntegration, TestAiIntegration, type AiDeps } from "./application/ai-use-cases";
import type { AiClientFactory, AiIntegrationRepository, AiModelRepository } from "./application/ports";
import { httpAiClients } from "./infrastructure/ai-clients";
import { D1AiIntegrationRepository } from "./infrastructure/d1-ai-integration.repository";
import { D1AiModelRepository } from "./infrastructure/d1-ai-model.repository";

export const AiIntegrationRepositoryToken = token<AiIntegrationRepository>("AiIntegrationRepository");
export const AiModelRepositoryToken = token<AiModelRepository>("AiModelRepository");
/** Provider HTTP clients; tests replace this token with a fake. */
export const AiClientFactoryToken = token<AiClientFactory>("AiClientFactory");
export const GetAiIntegrationToken = token<GetAiIntegration>("GetAiIntegration");
export const ListAiModelsToken = token<ListAiModels>("ListAiModels");
export const SaveAiIntegrationToken = token<SaveAiIntegration>("SaveAiIntegration");
export const RemoveAiIntegrationToken = token<RemoveAiIntegration>("RemoveAiIntegration");
export const TestAiIntegrationToken = token<TestAiIntegration>("TestAiIntegration");
export const GenerateProductContentToken = token<GenerateProductContent>("GenerateProductContent");

export function registerAi(c: Container): void {
  const deps = (r: Resolver): AiDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(AiIntegrationRepositoryToken), models: r.resolve(AiModelRepositoryToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken),
    masterKey: r.resolve(ConfigToken).secretsMasterKey, clients: r.resolve(AiClientFactoryToken),
  });
  c.singleton(AiClientFactoryToken, () => httpAiClients());
  c.scoped(AiIntegrationRepositoryToken, (r) => new D1AiIntegrationRepository(r.resolve(DatabaseToken)));
  c.scoped(AiModelRepositoryToken, (r) => new D1AiModelRepository(r.resolve(DatabaseToken)));
  c.scoped(GetAiIntegrationToken, (r) => new GetAiIntegration(r.resolve(AiIntegrationRepositoryToken)));
  c.scoped(ListAiModelsToken, (r) => new ListAiModels(r.resolve(AiModelRepositoryToken)));
  c.scoped(SaveAiIntegrationToken, (r) => new SaveAiIntegration(deps(r)));
  c.scoped(RemoveAiIntegrationToken, (r) => new RemoveAiIntegration(deps(r)));
  c.scoped(TestAiIntegrationToken, (r) => new TestAiIntegration(deps(r)));
  c.scoped(GenerateProductContentToken, (r) => new GenerateProductContent(deps(r), r.resolve(MediaLibraryToken)));
}

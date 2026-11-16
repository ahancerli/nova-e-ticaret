/** Public surface of the integrations module: SMS / cargo firm catalog, settings and the runtime port for adapters. */
export * from "./domain/providers";
export type { ActiveIntegration, IntegrationRuntime, SaveIntegrationInput } from "./application/integration-use-cases";
export type {
  AccountingConnector, CarrierBooking, CarrierConnector, CarrierStatus, CarrierTracking, Connector, ConnectorContext, ConnectorRegistry, IntegrationRefs,
  InvoiceLineInput, InvoiceProgressState, InvoiceRequest, InvoiceStepResult, SmsConnector,
} from "./application/ports";
export { integrationDeleteSchema, integrationKindParams, integrationSaveSchema, integrationTestSchema } from "./http/schemas";
export {
  ConnectorRegistryToken, GetIntegrationPageToken, IntegrationRuntimeToken, RemoveIntegrationToken, SaveIntegrationToken, TestIntegrationToken,
  registerIntegrations,
} from "./module";

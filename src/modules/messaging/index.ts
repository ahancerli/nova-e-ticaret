/** Public surface of the messaging module (integration message bus: Kafka REST or D1, catalog change relay). */
export * from "./domain/topics";
export type { BusMessage, ConsumedBatch, MessageBus } from "./application/ports";
export { ChangeLogRepositoryToken, MessageBusToken, RelayCatalogChangesToken, TopicPrefixToken, registerMessaging } from "./module";

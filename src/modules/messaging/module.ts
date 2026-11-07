import { ClockToken, ConfigToken, DatabaseToken, LoggerToken, token, type Container } from "@/core";
import type { ChangeLogRepository, MessageBus } from "./application/ports";
import { RelayCatalogChanges } from "./application/relay";
import { D1ChangeLogRepository, D1MessageBus } from "./infrastructure/d1-message-bus";
import { KafkaRestBus } from "./infrastructure/kafka-rest-bus";

export const MessageBusToken = token<MessageBus>("MessageBus");
export const ChangeLogRepositoryToken = token<ChangeLogRepository>("ChangeLogRepository");
export const RelayCatalogChangesToken = token<RelayCatalogChanges>("RelayCatalogChanges");
/** Topic prefix (KAFKA_TOPIC_PREFIX, default "nova"). */
export const TopicPrefixToken = token<string>("TopicPrefix");

export function registerMessaging(c: Container): void {
  c.scoped(MessageBusToken, (r) => {
    const cfg = r.resolve(ConfigToken);
    return cfg.integrationBus === "kafka" ? new KafkaRestBus(cfg.kafka) : new D1MessageBus(r.resolve(DatabaseToken));
  });
  c.scoped(TopicPrefixToken, (r) => r.resolve(ConfigToken).kafka?.topicPrefix || "nova");
  c.scoped(ChangeLogRepositoryToken, (r) => new D1ChangeLogRepository(r.resolve(DatabaseToken)));
  c.scoped(RelayCatalogChangesToken, (r) => new RelayCatalogChanges(r.resolve(ChangeLogRepositoryToken), r.resolve(MessageBusToken), r.resolve(TopicPrefixToken), r.resolve(ClockToken), r.resolve(LoggerToken)));
}

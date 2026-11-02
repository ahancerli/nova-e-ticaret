/** Public surface of the outbox module (worker + handler registry). */
export { MAX_ATTEMPTS, ProcessOutboxToken, addOutboxHandler, registerOutbox, type HandlerOutcome, type OutboxEvent, type OutboxHandler, type OutboxSummary } from "./outbox";

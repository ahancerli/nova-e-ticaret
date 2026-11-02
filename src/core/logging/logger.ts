/**
 * Structured JSON logger (one line per event → Workers observability / any log collector).
 * `child()` adds bindings such as requestId and route so every line of a request can be correlated.
 * Values under sensitive keys are redacted before they are written.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|api[_-]?key|card|iban|tckn|identity/i;
const MAX_DEPTH = 4;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

/** Error → loggable shape (stack only when allowed; it can reveal paths). */
export function serializeError(err: unknown, withStack: boolean): LogFields {
  if (!(err instanceof Error)) return { value: String(err) };
  const out: LogFields = { name: err.name, message: err.message };
  if (withStack && err.stack) out.stack = err.stack.split("\n").slice(0, 8).join(" | ");
  if (err.cause !== undefined) out.cause = serializeError(err.cause, withStack);
  return out;
}

export interface JsonLoggerOptions {
  level?: LogLevel;
  bindings?: LogFields;
  /** Defaults to console; injectable for tests. */
  sink?: (level: LogLevel, line: string) => void;
}

const consoleSink = (level: LogLevel, line: string) => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

export class JsonLogger implements Logger {
  private readonly min: number;
  private readonly bindings: LogFields;
  private readonly sink: (level: LogLevel, line: string) => void;

  constructor(private readonly options: JsonLoggerOptions = {}) {
    this.min = LEVELS[options.level ?? "info"];
    this.bindings = options.bindings ?? {};
    this.sink = options.sink ?? consoleSink;
  }

  debug(message: string, fields?: LogFields) { this.write("debug", message, fields); }
  info(message: string, fields?: LogFields) { this.write("info", message, fields); }
  warn(message: string, fields?: LogFields) { this.write("warn", message, fields); }
  error(message: string, fields?: LogFields) { this.write("error", message, fields); }

  child(bindings: LogFields): Logger {
    return new JsonLogger({ ...this.options, bindings: { ...this.bindings, ...bindings } });
  }

  private write(level: LogLevel, message: string, fields?: LogFields) {
    if (LEVELS[level] < this.min) return;
    const entry = { level, time: new Date().toISOString(), message, ...this.bindings, ...(fields ? (redact(fields) as LogFields) : {}) };
    try {
      this.sink(level, JSON.stringify(entry));
    } catch {
      this.sink(level, JSON.stringify({ level, message, note: "unserializable log fields" }));
    }
  }
}

/**
 * Typed runtime configuration, built once from the Worker env (bindings + secrets + vars).
 * Fails fast in production when a required secret is missing instead of failing on first use.
 */
export interface AppConfig {
  appEnv: "development" | "preview" | "production";
  isProduction: boolean;
  publicSiteUrl: string;
  sessionSecret: string;
  secretsMasterKey: string;
  secretsKeyVersion: string;
  cronSecret: string;
  logLevel: "debug" | "info" | "warn" | "error";
  /**
   * Message bus of the integrations (marketplaces): "kafka" = a Kafka cluster through its REST proxy (Confluent REST
   * Proxy, Redpanda HTTP Proxy, Aiven Karapace — API v2); "database" = the same topics stored in D1 (local, tests).
   */
  integrationBus: "kafka" | "database";
  kafka: { restUrl: string; username: string; password: string; topicPrefix: string };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function buildConfig(env: Partial<CloudflareEnv>, processEnv: Record<string, string | undefined> = {}): AppConfig {
  const pick = (key: string): string => {
    const fromEnv = (env as Record<string, unknown>)[key];
    return (typeof fromEnv === "string" && fromEnv) || processEnv[key] || "";
  };
  // wrangler.jsonc `vars` (APP_ENV, PUBLIC_SITE_URL) ship production values that local `next dev` also sees,
  // so for these the process env (.env.local) wins. In production both sources carry the same value.
  const pickVar = (key: string): string => processEnv[key] || pick(key);
  const appEnvRaw = pickVar("APP_ENV") || "development";
  const appEnv = (["development", "preview", "production"].includes(appEnvRaw) ? appEnvRaw : "development") as AppConfig["appEnv"];
  const config: AppConfig = {
    appEnv,
    isProduction: appEnv === "production",
    publicSiteUrl: (pickVar("PUBLIC_SITE_URL") || "http://localhost:3000").replace(/\/$/, ""),
    sessionSecret: pick("SESSION_SECRET"),
    secretsMasterKey: pick("SECRETS_MASTER_KEY"),
    secretsKeyVersion: pick("SECRETS_KEY_VERSION") || "v1",
    cronSecret: pick("CRON_SECRET"),
    logLevel: appEnv === "production" ? "info" : "debug",
    integrationBus: pickVar("INTEGRATION_BUS") === "kafka" ? "kafka" : "database",
    kafka: {
      restUrl: pickVar("KAFKA_REST_URL").replace(/\/$/, ""),
      username: pick("KAFKA_REST_USERNAME"),
      password: pick("KAFKA_REST_PASSWORD"),
      topicPrefix: (pickVar("KAFKA_TOPIC_PREFIX") || "nova").replace(/[^A-Za-z0-9._-]/g, ""),
    },
  };
  if (config.integrationBus === "kafka" && !/^https?:\/\//.test(config.kafka.restUrl)) {
    throw new ConfigError("INTEGRATION_BUS=kafka needs KAFKA_REST_URL (the Kafka REST proxy, e.g. https://kafka-rest.example.com)");
  }
  if (config.isProduction) {
    const missing = (["sessionSecret", "secretsMasterKey", "cronSecret"] as const).filter((k) => !config[k]);
    if (missing.length) throw new ConfigError(`Missing required secrets: ${missing.join(", ")}`);
    if (config.sessionSecret.length < 32) throw new ConfigError("SESSION_SECRET must be at least 32 characters");
  }
  return config;
}

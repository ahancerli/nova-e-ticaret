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
  // APP_ENV: the process env (.env.local in dev) wins over the Worker var, because wrangler.jsonc ships
  // APP_ENV=production as a var that local `next dev` also sees. In production both say "production".
  const appEnvRaw = processEnv.APP_ENV || pick("APP_ENV") || "development";
  const appEnv = (["development", "preview", "production"].includes(appEnvRaw) ? appEnvRaw : "development") as AppConfig["appEnv"];
  const config: AppConfig = {
    appEnv,
    isProduction: appEnv === "production",
    publicSiteUrl: (pick("PUBLIC_SITE_URL") || "http://localhost:3000").replace(/\/$/, ""),
    sessionSecret: pick("SESSION_SECRET"),
    secretsMasterKey: pick("SECRETS_MASTER_KEY"),
    secretsKeyVersion: pick("SECRETS_KEY_VERSION") || "v1",
    cronSecret: pick("CRON_SECRET"),
    logLevel: appEnv === "production" ? "info" : "debug",
  };
  if (config.isProduction) {
    const missing = (["sessionSecret", "secretsMasterKey", "cronSecret"] as const).filter((k) => !config[k]);
    if (missing.length) throw new ConfigError(`Missing required secrets: ${missing.join(", ")}`);
    if (config.sessionSecret.length < 32) throw new ConfigError("SESSION_SECRET must be at least 32 characters");
  }
  return config;
}

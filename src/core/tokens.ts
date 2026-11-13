import { token } from "./di/container";
import type { Database } from "./db/database";
import type { AppConfig } from "./runtime/config";
import type { Clock } from "./runtime/clock";
import type { IdGenerator } from "./runtime/ids";

/** Infrastructure tokens shared by every module. Module-specific tokens live next to their module. */
export const EnvToken = token<RuntimeEnv>("Env");
export const ConfigToken = token<AppConfig>("Config");
export const DatabaseToken = token<Database>("Database");
export const ClockToken = token<Clock>("Clock");
export const IdGeneratorToken = token<IdGenerator>("IdGenerator");

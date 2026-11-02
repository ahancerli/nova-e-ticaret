import { z } from "zod";
import "@/modules/shared/schemas";
import { SETTING_GROUP_KEYS } from "../domain/registry";

export const settingsGroupParams = z.object({ group: z.enum(SETTING_GROUP_KEYS as [string, ...string[]]) });

/** Values are validated per key against the registry in UpdateSettings (types differ per key). */
export const settingsUpdateSchema = z.object({
  values: z.record(z.string().max(80), z.unknown()).refine((v) => Object.keys(v).length <= 40, "Çok fazla alan."),
  expectedVersion: z.string().regex(/^[0-9a-f]{8}$/, "Geçersiz sürüm."),
}).strict();

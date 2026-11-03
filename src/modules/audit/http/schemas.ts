import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { AUDIT_AREAS, type AuditArea } from "../domain/audit";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG").optional();

export const auditQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  area: z.enum(Object.keys(AUDIT_AREAS) as [AuditArea, ...AuditArea[]]).default("all"),
  actorId: entityId.optional(),
  entityType: z.string().max(40).regex(/^[a-z_]+$/, "Geçersiz kayıt türü").optional(),
  entityId: entityId.optional(),
  from: day,
  to: day,
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

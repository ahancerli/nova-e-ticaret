import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";

const phone = z.string().trim().max(20).regex(/^\+?[1-9][0-9 ]{6,18}$/, "Telefonu +90 5xx… biçiminde girin.").transform((v) => v.replace(/\s/g, ""));
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const staffInviteSchema = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().min(2).max(120),
  phone: phone.nullable().optional().or(z.literal("").transform(() => null)),
  department: optionalText(80),
  jobTitle: optionalText(80),
  roleIds: z.array(entityId).min(1, "En az bir rol seçin.").max(10),
}).strict();

export const staffUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  phone: phone.nullable().optional().or(z.literal("").transform(() => null)),
  department: optionalText(80),
  jobTitle: optionalText(80),
  roleIds: z.array(entityId).min(1, "En az bir rol seçin.").max(10).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "En az bir alan güncellenmelidir.");

export const staffActionSchema = z.object({
  action: z.enum(["suspend", "reactivate", "resend_invite", "password_reset", "revoke_sessions", "cancel_invite"]),
}).strict();

const roleFields = {
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(z.string().max(60)).max(60),
};
export const roleCreateSchema = z.object(roleFields).strict();
export const roleUpdateSchema = z.object({ ...roleFields, expectedUpdatedAt: z.string().max(40) }).strict();

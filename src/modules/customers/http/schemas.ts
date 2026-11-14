import { z } from "zod";
import "@/modules/shared/schemas";
import { COUNTRY_CODE } from "@/modules/geo/domain/geo";
import { CUSTOMER_SEGMENTS, CUSTOMER_SORTS, type CustomerSegment } from "../domain/customer";

const phone = z.string().trim().max(20).regex(/^\+?[1-9][0-9 ]{6,18}$/, "Telefonu +90 5xx… biçiminde girin.").transform((v) => v.replace(/\s/g, ""));
const optionalPhone = z.union([z.literal("").transform(() => null), phone]).nullable().optional();

export const customerQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  segment: z.enum(Object.keys(CUSTOMER_SEGMENTS) as [CustomerSegment, ...CustomerSegment[]]).default("all"),
  sort: z.enum(CUSTOMER_SORTS).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const customerUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  phone: optionalPhone,
  companyName: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "En az bir alan güncellenmelidir.");

export const customerActionSchema = z.object({ action: z.enum(["suspend", "reactivate", "password_reset", "revoke_sessions"]) }).strict();

export const signupSchema = z.object({
  firstName: z.string().trim().min(1, "Adınızı girin.").max(80),
  lastName: z.string().trim().min(1, "Soyadınızı girin.").max(80),
  email: z.email("Geçerli bir e-posta girin.").max(254),
  // checked against the chosen country's mobile rules by RegisterCustomer (geo_countries)
  phone: z.string().trim().max(24).optional().transform((v) => v || null),
  phoneCountry: z.string().regex(COUNTRY_CODE).optional(),
  password: z.string().min(1, "Parola girin.").max(200),
  kvkkAccepted: z.literal(true, { error: "Aydınlatma metnini okuduğunuzu onaylayın." }),
  marketingEmail: z.boolean().default(false),
  marketingSms: z.boolean().default(false),
}).strict();

import { z } from "zod";
import { COUNTRY_CODE, DEFAULT_COUNTRY } from "@/modules/geo/domain/geo";

const text = (max: number, msg = "Bu alan zorunlu.") => z.string().trim().min(1, msg).max(max, `En fazla ${max} karakter.`);

/** Same field rules as checkout's address, so a saved address always passes order confirmation. */
export const addressInputSchema = z.object({
  label: text(40, "Adrese bir ad verin (Ev, İş …)."),
  recipientName: text(120),
  // phone / province / district are checked against geo_* by the use case (country rules, Turkish lists)
  phone: text(24, "Cep telefonunu girin."),
  phoneCountry: z.string().regex(COUNTRY_CODE).optional(),
  countryCode: z.string().regex(COUNTRY_CODE).default(DEFAULT_COUNTRY),
  province: text(60),
  district: text(60),
  line1: text(250),
  line2: z.string().trim().max(250).nullish(),
  postalCode: z.string().trim().max(10).nullish(),
  isDefaultShipping: z.boolean().default(false),
  isDefaultBilling: z.boolean().default(false),
}).strict();
export type AddressInput = z.infer<typeof addressInputSchema>;

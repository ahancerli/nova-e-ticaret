import { z } from "zod";
import { COUNTRY_CODE, DEFAULT_COUNTRY } from "@/modules/geo/domain/geo";
import { cleanTaxNumber, isTaxNumber } from "@/lib/tax-number";
import { entityId } from "@/modules/shared/schemas";
import { PAYMENT_METHODS } from "../domain/checkout";

// checked against the chosen country's mobile rules by ConfirmCheckout (geo_countries)
const phone = z.string().trim().min(1, "Cep telefonunu girin.").max(24);
const country = z.string().regex(COUNTRY_CODE);
const text = (max: number) => z.string().trim().min(1).max(max);

const address = z.object({
  recipientName: text(120),
  phone,
  countryCode: country.default(DEFAULT_COUNTRY),
  province: text(60),
  district: text(60),
  line1: text(250),
  line2: z.string().trim().max(250).optional(),
  postalCode: z.string().trim().max(10).optional(),
  companyName: z.string().trim().max(160).optional(),
  taxOffice: z.string().trim().max(80).optional(),
  /** Corporate invoice: VKN (10) or, for a sole proprietor, TCKN (11) — checked by its check digits, stored encrypted. */
  taxNumber: z.string().trim().max(20).transform(cleanTaxNumber).refine((v) => !v || isTaxNumber(v), "Geçerli bir vergi numarası (10 hane) veya T.C. kimlik numarası (11 hane) girin.").optional(),
}).strict().superRefine((a, ctx) => {
  if (a.companyName && !a.taxNumber) ctx.addIssue({ code: "custom", path: ["taxNumber"], message: "Kurumsal fatura için vergi numarasını girin." });
  if (a.companyName && !a.taxOffice) ctx.addIssue({ code: "custom", path: ["taxOffice"], message: "Vergi dairesini girin." });
});

export const confirmSchema = z.object({
  checkoutId: entityId,
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentFeeMinor: z.number().int().min(0).max(100_000).optional(),
  email: z.email().max(254),
  phone,
  phoneCountry: country.optional(),
  shipping: address,
  billing: address.optional(),
  note: z.string().trim().max(1000).optional(),
  acceptedTermsVersion: text(32),
}).strict();

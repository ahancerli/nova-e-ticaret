import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";

const phone = z.string().trim().regex(/^\+?[1-9]\d{9,14}$/, "Telefon +905xxxxxxxxx biçiminde olmalı");
const text = (max: number) => z.string().trim().min(1).max(max);

const address = z.object({
  recipientName: text(120),
  phone,
  province: text(60),
  district: text(60),
  line1: text(250),
  line2: z.string().trim().max(250).optional(),
  postalCode: z.string().trim().max(10).optional(),
  companyName: z.string().trim().max(160).optional(),
  taxOffice: z.string().trim().max(80).optional(),
}).strict();

export const confirmSchema = z.object({
  checkoutId: entityId,
  paymentMethod: z.enum(["iyzico", "bank_transfer"]),
  email: z.email().max(254),
  phone,
  shipping: address,
  billing: address.optional(),
  note: z.string().trim().max(1000).optional(),
  acceptedTermsVersion: text(32),
}).strict();

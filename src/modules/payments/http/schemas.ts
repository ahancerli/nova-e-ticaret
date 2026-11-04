import { z } from "zod";
import "@/modules/shared/schemas";
import { IYZICO_ENVIRONMENTS, isValidIban, normalizeIban, type IyzicoEnvironment } from "../domain/payment-settings";

const environment = z.enum(IYZICO_ENVIRONMENTS as unknown as [IyzicoEnvironment, ...IyzicoEnvironment[]], { error: "Ortamı seçin." });
const key = (label: string) => z.string().trim().max(200).optional().transform((v) => v || undefined)
  .refine((v) => v === undefined || /^[\x21-\x7e]{8,200}$/.test(v), `${label} geçersiz görünüyor; boşluksuz ve eksiksiz yapıştırın.`);

export const iyzicoKeysSchema = z.object({
  environment,
  apiKey: key("API anahtarı"),
  secretKey: key("Güvenlik anahtarı"),
  expectedUpdatedAt: z.string().max(40).nullable(),
}).strict();

/** `environment: null` turns card payments off. */
export const cardPaymentsSchema = z.object({ environment: environment.nullable() }).strict();
export const iyzicoTestSchema = z.object({ environment }).strict();
export const bankTransferSchema = z.object({ active: z.boolean() }).strict();

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(2, "Banka adını girin.").max(80),
  accountHolder: z.string().trim().min(2, "Hesap sahibini girin (ünvan veya ad soyad).").max(120),
  iban: z.string().max(42).transform(normalizeIban).refine(isValidIban, "Geçerli bir IBAN girin (TR ile başlayan 26 karakter)."),
  instructions: z.string().trim().max(300).nullish().transform((v) => v || null),
  isActive: z.boolean(),
}).strict();

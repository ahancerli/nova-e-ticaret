import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { AI_MAX_IMAGES, AI_PRODUCT_FIELD_KEYS, AI_PROMPT_MAX, AI_PROMPT_MIN, AI_PROVIDER_KEYS, type AiProductField, type AiProvider } from "../domain/providers";

export const aiIntegrationSchema = z.object({
  provider: z.enum(AI_PROVIDER_KEYS as [AiProvider, ...AiProvider[]], { error: "Bir sağlayıcı seçin." }),
  model: z.string().trim().min(2, "Model adını girin.").max(100).regex(/^[A-Za-z0-9._:/-]+$/, "Model adı yalnız harf, rakam ve . _ - : / içerebilir."),
  apiKey: z.string().trim().max(400).regex(/^\S*$/, "API anahtarında boşluk olamaz.").optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || v.length >= 20, "API anahtarı çok kısa görünüyor."),
  expectedUpdatedAt: z.string().max(40).nullable(),
}).strict();

export const aiIntegrationDeleteSchema = z.object({ expectedUpdatedAt: z.string().min(1).max(40) }).strict();

export const aiProductGenerateSchema = z.object({
  fields: z.array(z.enum(AI_PRODUCT_FIELD_KEYS as [AiProductField, ...AiProductField[]])).min(1, "En az bir alan seçin.").max(AI_PRODUCT_FIELD_KEYS.length)
    .transform((v) => [...new Set(v)]),
  prompt: z.string().trim().min(AI_PROMPT_MIN, `Ürünü en az ${AI_PROMPT_MIN} karakterle anlatın.`).max(AI_PROMPT_MAX),
  mediaIds: z.array(entityId).min(1, "En az bir ürün görseli yükleyin.").max(AI_MAX_IMAGES, `En fazla ${AI_MAX_IMAGES} görsel yükleyebilirsiniz.`),
}).strict();

import { z } from "zod";
import { AT_LEAST_ONE_FIELD, atLeastOneField, entityId, slugInput } from "@/modules/shared/schemas";

const sortOrder = z.coerce.number().int().min(-100000).max(100000);

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: slugInput.optional(),
  parentId: entityId.optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  imageMediaId: entityId.optional().nullable(),
  menuMediaId: entityId.optional().nullable(),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
}).strict();

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    slug: slugInput.optional(),
    parentId: entityId.optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
    imageMediaId: entityId.optional().nullable(),
    menuMediaId: entityId.optional().nullable(),
    sortOrder: sortOrder.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);

// brands.website_url CHECK: GLOB 'http*://*' → only absolute http(s) URLs.
const websiteUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Geçerli bir web adresi girin (https://…).");

const brandFields = {
  name: z.string().trim().min(1).max(160),
  slug: slugInput.optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  logoMediaId: entityId.optional().nullable(),
  bannerMediaId: entityId.optional().nullable(),
  websiteUrl: websiteUrl.optional().nullable(),
  isActive: z.boolean(),
};

export const brandCreateSchema = z.object({ ...brandFields, isActive: brandFields.isActive.default(true) }).strict();

export const brandUpdateSchema = z
  .object({ ...brandFields, name: brandFields.name.optional(), isActive: brandFields.isActive.optional() })
  .strict()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);

import { z } from "zod";
import { AT_LEAST_ONE_FIELD, atLeastOneField, entityId, slugInput } from "@/modules/shared/schemas";
import { ATTRIBUTE_TEMPLATE_KEYS, type AttributeTemplateKey } from "../domain/attribute";

const sortOrder = z.coerce.number().int().min(-100000).max(100000);

const optionInput = z.object({
  label: z.string().trim().min(1).max(60),
  value: z.string().trim().max(60).nullable().optional(),
  colorHex: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Renk kodu #RRGGBB olmalı.").nullable().optional().or(z.literal("").transform(() => null)),
  numericValue: z.number().finite().nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();
const attributeFields = {
  label: z.string().trim().min(2).max(60),
  code: z.string().trim().max(40).nullable().optional(),
  dataType: z.enum(["select", "multiselect", "text", "number", "boolean"]),
  unit: z.string().trim().max(12).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  isVariantAxis: z.boolean(),
  isFilterable: z.boolean(),
  displayStyle: z.enum(["button", "swatch", "dropdown"]),
  variesMedia: z.boolean().default(false),
};
export const attributeCreateSchema = z.object({ ...attributeFields, options: z.array(optionInput).max(200).optional() }).strict();
export const attributeUpdateSchema = z.object(attributeFields).strict();
export const attributeOptionsAddSchema = z.object({ options: z.array(optionInput).min(1).max(200) }).strict();
export const attributeOptionUpdateSchema = optionInput;
export const attributeOptionsOrderSchema = z.object({ order: z.array(entityId).min(1).max(500) }).strict();
export const attributeCategoriesSchema = z.object({ categories: z.array(z.object({ categoryId: entityId, isRequired: z.boolean() }).strict()).max(500) }).strict();
export const attributeTemplateSchema = z.object({ template: z.enum(ATTRIBUTE_TEMPLATE_KEYS as [AttributeTemplateKey, ...AttributeTemplateKey[]]) }).strict();
export const barcodeGenerateSchema = z.object({ count: z.number().int().min(1).max(500) }).strict();
export const barcodePrefixSchema = z.object({ prefix: z.string().trim().regex(/^\d{3,10}$/, "Önek 3–10 haneli bir sayı olmalı.") }).strict();

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

export { productSaveSchema } from "../application/products/product-input";

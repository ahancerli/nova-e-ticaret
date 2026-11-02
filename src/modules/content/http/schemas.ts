import { z } from "zod";
import { entityId, slugInput } from "@/modules/shared/schemas";
import { FOOTER_COLUMNS, LEGAL_TYPES, PAGE_KINDS, PAGE_STATUSES } from "../domain/page";

const keys = <T extends object>(o: T) => Object.keys(o) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]];

const seo = z.object({
  metaTitle: z.string().trim().max(120).nullable().optional(),
  metaDescription: z.string().trim().max(320).nullable().optional(),
  noindex: z.boolean().optional(),
}).strict();

const fields = {
  title: z.string().trim().min(2).max(200),
  slug: slugInput.max(120).optional(),
  kind: z.enum(keys(PAGE_KINDS)),
  legalType: z.enum(keys(LEGAL_TYPES)).nullable().optional(),
  summary: z.string().trim().max(500).nullable().optional(),
  bodyHtml: z.string().max(200_000, "İçerik çok uzun."),
  status: z.enum(keys(PAGE_STATUSES)),
  footerColumn: z.enum(keys(FOOTER_COLUMNS)).nullable().optional(),
  footerOrder: z.coerce.number().int().min(-1000).max(1000).optional(),
  seo: seo.optional(),
};

export const pageCreateSchema = z.object(fields).strict();

export const pageUpdateSchema = z.object({
  ...fields,
  title: fields.title.optional(),
  kind: fields.kind.optional(),
  bodyHtml: fields.bodyHtml.optional(),
  status: fields.status.optional(),
  expectedVersion: z.number().int().min(1),
}).strict();

export const revisionParams = z.object({ id: entityId, version: z.coerce.number().int().min(1).max(1_000_000) });

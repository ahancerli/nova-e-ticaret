import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { SECTION_TYPE_KEYS, SELECTION_MODES, type SectionType, type SelectionMode } from "../domain/showcase";

const iso = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());
const link = z.string().trim().max(500).nullable().optional();
const opt = (max: number) => z.string().trim().max(max).nullable().optional();

export const sectionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  subtitle: opt(160),
  type: z.enum(SECTION_TYPE_KEYS as [SectionType, ...SectionType[]]),
  sliderId: entityId.nullable().optional(),
  storyCollectionId: entityId.nullable().optional(),
  selectionMode: z.enum(Object.keys(SELECTION_MODES) as [SelectionMode, ...SelectionMode[]]).optional(),
  itemLimit: z.number().int().min(1).max(48).optional(),
  mediaId: entityId.nullable().optional(),
  mobileMediaId: entityId.nullable().optional(),
  targetUrl: link,
  ctaLabel: opt(40),
  productIds: z.array(entityId).max(48).optional(),
  categoryIds: z.array(entityId).max(24).optional(),
  brandIds: z.array(entityId).max(48).optional(),
  isActive: z.boolean(),
  startsAt: iso.nullable().optional(),
  endsAt: iso.nullable().optional(),
  expectedUpdatedAt: z.string().max(40).optional(),
}).strict();

export const orderSchema = z.object({ order: z.array(entityId).min(1).max(200) }).strict();
export const toggleSchema = z.object({ isActive: z.boolean() }).strict();
export const nameSchema = z.object({ name: z.string().trim().min(2).max(80) }).strict();

export const slideSchema = z.object({
  title: z.string().trim().min(1).max(160),
  subtitle: opt(300),
  ctaLabel: opt(40),
  targetUrl: link,
  desktopMediaId: entityId,
  mobileMediaId: entityId.nullable().optional(),
  isActive: z.boolean(),
  startsAt: iso.nullable().optional(),
  endsAt: iso.nullable().optional(),
}).strict();

export const storySchema = z.object({
  brandId: entityId,
  title: z.string().trim().min(1).max(60),
  coverMediaId: entityId.nullable().optional(),
  frames: z.array(z.object({ mediaId: entityId, targetUrl: link, durationMs: z.number().int().min(1000).max(60_000) }).strict()).min(1).max(20),
  isActive: z.boolean(),
  startsAt: iso.nullable().optional(),
  endsAt: iso.nullable().optional(),
}).strict();

export const childParams = z.object({ id: entityId, childId: entityId });

import { z } from "zod";

// Field errors reach the admin forms verbatim, so Zod's built-in messages are Turkish app-wide.
// Every schema module imports this file, which makes the setting apply before any parse.
z.config(z.locales.tr());

/** Reusable Zod building blocks for module input schemas. */
export const entityId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Geçersiz kimlik");

/** Free text; services run normalizeSlug() ("Bahçe Ürünleri" → "bahce-urunleri") and validate the result. */
export const slugInput = z.string().trim().min(1).max(160);

export const idParams = z.object({ id: entityId });

/** For PATCH-like bodies: at least one field must be present. */
export const atLeastOneField = (v: object) => Object.keys(v).length > 0;
export const AT_LEAST_ONE_FIELD = "En az bir alan güncellenmelidir.";

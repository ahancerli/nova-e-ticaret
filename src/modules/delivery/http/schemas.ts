import { z } from "zod";
import { MAX_HOLIDAYS, isDay } from "../domain/delivery";

const days = (min: number, max: number, label: string) => z.coerce.number().int().min(min, `${label} ${min}–${max} gün olmalı.`).max(max, `${label} ${min}–${max} gün olmalı.`);

export const deliverySettingsSchema = z.object({
  enabled: z.boolean(),
  cutoffMinutes: z.coerce.number().int().min(0, "Saati 00:00–23:59 arasında girin.").max(1439, "Saati 00:00–23:59 arasında girin."),
  shipDays: z.array(z.number().int().min(1).max(7)).max(7),
  handlingDays: days(0, 10, "Hazırlık süresi"),
  transitMinDays: days(1, 15, "En az kargo süresi"),
  transitMaxDays: days(1, 20, "En çok kargo süresi"),
  holidays: z.array(z.string().refine(isDay, "Tarihi YYYY-AA-GG biçiminde girin.")).max(MAX_HOLIDAYS, `En fazla ${MAX_HOLIDAYS} tatil günü.`),
  expectedUpdatedAt: z.string().min(1).max(40),
}).strict();

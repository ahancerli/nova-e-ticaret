import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { CELL_MAX, MAX_COLUMNS, MAX_LINKS, MAX_ROWS, NAME_MAX, NOTE_MAX } from "../domain/size-chart";

const cell = z.string().max(CELL_MAX, `Bir hücre en fazla ${CELL_MAX} karakter olabilir.`);

export const sizeChartSchema = z.object({
  name: z.string().trim().min(1, "Tablo adını yazın.").max(NAME_MAX, `Ad en fazla ${NAME_MAX} karakter.`),
  columns: z.array(cell).max(MAX_COLUMNS, `En fazla ${MAX_COLUMNS} sütun olabilir.`),
  rows: z.array(z.array(cell).max(MAX_COLUMNS)).max(MAX_ROWS, `En fazla ${MAX_ROWS} satır olabilir.`),
  note: z.string().trim().max(NOTE_MAX, `Not en fazla ${NOTE_MAX} karakter.`).nullable().optional(),
  isActive: z.boolean(),
  categoryIds: z.array(entityId).max(MAX_LINKS, `En fazla ${MAX_LINKS} kategori.`),
  productIds: z.array(entityId).max(MAX_LINKS, `En fazla ${MAX_LINKS} ürün.`),
  expectedUpdatedAt: z.string().max(40).nullable().optional(),
}).strict();

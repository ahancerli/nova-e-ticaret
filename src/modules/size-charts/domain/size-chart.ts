/** Beden tabloları — pure types and limits (no I/O). A chart is a small text grid: header row + body rows. */

export const MAX_COLUMNS = 8;
export const MAX_ROWS = 40;
export const CELL_MAX = 24;
export const NAME_MAX = 80;
export const NOTE_MAX = 500;
export const MAX_LINKS = 100;

/** What the product page shows in the "Beden tablosu" dialog. */
export interface PublicSizeChart {
  name: string;
  columns: string[];
  rows: string[][];
  note: string | null;
}

export interface SizeChart extends PublicSizeChart {
  id: string;
  isActive: boolean;
  categoryIds: string[];
  productIds: string[];
  updatedAt: string;
}

export interface SizeChartInput {
  name: string;
  columns: string[];
  rows: string[][];
  note?: string | null;
  isActive: boolean;
  categoryIds: string[];
  productIds: string[];
}

const clean = (v: string) => v.replace(/\s+/g, " ").trim();

/**
 * Trims every cell, drops fully empty rows and trailing empty columns. Problems come back as field messages
 * (Turkish) so the panel can point at the grid.
 */
export function normalizeChart(input: Pick<SizeChartInput, "columns" | "rows">): { columns: string[]; rows: string[][]; error: string | null } {
  let columns = input.columns.map(clean);
  let rows = input.rows.map((r) => columns.map((_, i) => clean(r[i] ?? ""))).filter((r) => r.some(Boolean));
  while (columns.length && !columns.at(-1) && rows.every((r) => !r.at(-1))) {
    columns = columns.slice(0, -1);
    rows = rows.map((r) => r.slice(0, -1));
  }
  const error =
    columns.length < 2 ? "En az iki sütun girin (ör. Beden ve Göğüs)." :
    columns.length > MAX_COLUMNS ? `En fazla ${MAX_COLUMNS} sütun olabilir.` :
    columns.some((c) => !c) ? "Her sütunun bir başlığı olmalı." :
    !rows.length ? "En az bir satır girin." :
    rows.length > MAX_ROWS ? `En fazla ${MAX_ROWS} satır olabilir.` :
    rows.some((r) => !r[0]) ? "Her satırın ilk hücresine bedeni yazın." :
    [...columns, ...rows.flat()].some((c) => c.length > CELL_MAX) ? `Bir hücre en fazla ${CELL_MAX} karakter olabilir.` :
    null;
  return { columns, rows, error };
}

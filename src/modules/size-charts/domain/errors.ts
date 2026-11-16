import { ConflictError, NotFoundError, ValidationError } from "@/core";

export const SizeChartErrors = {
  notFound: () => new NotFoundError("size_chart_not_found", "Beden tablosu bulunamadı."),
  changed: () => new ConflictError("size_chart_changed", "Beden tablosu bu sırada güncellendi. Sayfayı yenileyip tekrar deneyin."),
  invalidGrid: (message: string) => ValidationError.field("rows", message, "size_chart_invalid"),
  unknownTargets: (field: "categoryIds" | "productIds") =>
    ValidationError.field(field, field === "categoryIds" ? "Seçilen kategorilerden biri bulunamadı." : "Seçilen ürünlerden biri bulunamadı.", "size_chart_unknown_target"),
  taken: (field: "categoryIds" | "productIds", what: string, chart: string) =>
    ValidationError.field(field, `${what} zaten “${chart}” tablosuna bağlı. Önce oradan çıkarın.`, "size_chart_target_taken"),
};

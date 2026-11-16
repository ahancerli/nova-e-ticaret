import { ConflictError, NotFoundError, ValidationError } from "@/core";
import { MAX_OPEN_PER_PRODUCT, QUESTION_MIN } from "./question";

export const QuestionErrors = {
  notFound: () => new NotFoundError("question_not_found", "Soru bulunamadı."),
  productNotFound: () => new NotFoundError("product_not_found", "Ürün bulunamadı."),
  tooShort: () => ValidationError.field("body", `Sorunuz en az ${QUESTION_MIN} karakter olmalı.`, "question_too_short"),
  tooMany: () => new ConflictError("question_limit", `Bu üründe yanıt bekleyen ${MAX_OPEN_PER_PRODUCT} sorunuz var. Yanıtlandıktan sonra yeni soru sorabilirsiniz.`),
  duplicate: () => new ConflictError("question_duplicate", "Bu soruyu zaten sordunuz; yanıt gelince e-posta ile haber vereceğiz."),
  changed: () => new ConflictError("question_changed", "Soru bu sırada güncellendi. Sayfayı yenileyip tekrar deneyin."),
  answerRequired: () => ValidationError.field("answer", "Yanıtı yazın.", "question_answer_required"),
};

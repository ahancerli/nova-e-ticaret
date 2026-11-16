import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { ADMIN_QUESTION_SORTS, ANSWER_MAX, NOTE_MAX, QUESTION_MAX, QUESTION_TABS, type QuestionTab } from "../domain/question";

export const questionAskSchema = z.object({
  body: z.string().trim().min(1, "Sorunuzu yazın.").max(QUESTION_MAX, `Soru en fazla ${QUESTION_MAX} karakter.`),
  isAnonymous: z.boolean().optional(),
}).strict();

export const publicQuestionQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) });

export const adminQuestionQuerySchema = z.object({
  tab: z.enum(Object.keys(QUESTION_TABS) as [QuestionTab, ...QuestionTab[]]).default("pending"),
  productId: entityId.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(ADMIN_QUESTION_SORTS).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const questionAnswerSchema = z.object({
  answer: z.string().trim().min(1, "Yanıtı yazın.").max(ANSWER_MAX, `Yanıt en fazla ${ANSWER_MAX} karakter.`),
  expectedUpdatedAt: z.string().min(1).max(40),
}).strict();

export const questionRejectSchema = z.object({
  note: z.string().trim().max(NOTE_MAX, `Not en fazla ${NOTE_MAX} karakter.`).nullable().optional(),
  expectedUpdatedAt: z.string().min(1).max(40),
}).strict();

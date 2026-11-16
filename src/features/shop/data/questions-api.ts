"use client";

import { api } from "@/lib/api-client";
import type { QuestionInput, QuestionPage } from "@/modules/questions/domain/question";

const product = (slug: string) => `/api/products/${encodeURIComponent(slug)}/questions`;

export const questionsApi = {
  page: (slug: string, page: number) => api<QuestionPage>(`${product(slug)}?page=${page}`).then((r) => r.data),
  /** `headers` = CAPTCHA token from `useCaptcha("question")` (empty when protection is off). */
  ask: (slug: string, input: QuestionInput, headers?: Record<string, string>) =>
    api<{ id: string; status: "pending" }>(product(slug), { method: "POST", json: input, headers }).then((r) => r.data),
};

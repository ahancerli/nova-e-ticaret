"use client";

import { api } from "@/lib/api-client";
import type { ReviewEligibility, ReviewInput } from "@/modules/reviews/domain/review";

/** Review writes stay on REST (CSRF, rate limits); reads go through the graph (`shopGraph.reviews`). */
const product = (slug: string) => `/api/products/${encodeURIComponent(slug)}/reviews`;

export const reviewsApi = {
  eligibility: (slug: string) => api<ReviewEligibility>(`${product(slug)}/eligibility`).then((r) => r.data),
  submit: (slug: string, input: ReviewInput) => api<{ id: string; status: "pending" | "approved"; unchanged: boolean }>(product(slug), { method: "POST", json: input }).then((r) => r.data),
  vote: (id: string, helpful: boolean) => api<{ helpfulCount: number; voted: boolean }>(`/api/reviews/${encodeURIComponent(id)}/vote`, { method: "POST", json: { helpful } }).then((r) => r.data),
};

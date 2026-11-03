"use client";

import { api } from "@/lib/api-client";
import type { CampaignDetail, CampaignInput, CampaignSummary, CouponBatchInput } from "@/modules/campaigns";

const one = (id: string) => `/api/admin/campaigns/${encodeURIComponent(id)}`;

export const campaignsApi = {
  list: () => api<CampaignSummary[]>("/api/admin/campaigns"),
  get: (id: string) => api<CampaignDetail>(one(id)),
  create: (input: CampaignInput) => api<{ id: string }>("/api/admin/campaigns", { method: "POST", json: input }),
  update: (id: string, input: CampaignInput & { expectedUpdatedAt: string }) => api<{ updatedAt: string }>(one(id), { method: "PUT", json: input }),
  remove: (id: string) => api<{ deleted: true }>(one(id), { method: "DELETE" }),
  createCoupons: (id: string, input: CouponBatchInput) => api<{ codes: string[] }>(`${one(id)}/coupons`, { method: "POST", json: input }),
  changeCoupon: (id: string, couponId: string, action: "activate" | "deactivate" | "delete") =>
    api<{ done: true }>(`${one(id)}/coupons/${encodeURIComponent(couponId)}`, { method: "POST", json: { action } }),
};

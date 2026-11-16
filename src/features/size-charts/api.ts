"use client";

import { api } from "@/lib/api-client";
import type { SizeChart, SizeChartInput } from "@/modules/size-charts";

const BASE = "/api/admin/size-charts";
type Body = SizeChartInput & { expectedUpdatedAt?: string | null };

export const sizeChartsApi = {
  create: (body: Body) => api<SizeChart>(BASE, { method: "POST", json: body }).then((r) => r.data),
  update: (id: string, body: Body) => api<SizeChart>(`${BASE}/${encodeURIComponent(id)}`, { method: "PUT", json: body }).then((r) => r.data),
  remove: (id: string) => api<{ deleted: true }>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

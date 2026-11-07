"use client";

import { api } from "@/lib/api-client";
import type { BulkJob, BulkOp, FeedAnalysis, FeedField, FeedOptions, FeedRecord, MatchKey, RawRow, RowResult, SliceResult } from "@/modules/bulk";

export interface FeedConfigInput {
  name: string;
  format: "xml" | "json";
  url: string;
  itemPath: string;
  matchKey: MatchKey;
  keyPath: string;
  mapping: Partial<Record<FeedField, string>>;
  options: FeedOptions;
  scheduleMinutes: 60 | 180 | 360 | 720 | 1440 | null;
  isActive: boolean;
  headerName: string | null;
  headerValue: string | null;
}

/** Remote fetches and full product saves take longer than plain JSON calls. */
const SLOW = { timeoutMs: 90_000 };

export const bulkApi = {
  check: (input: { op: BulkOp; matchKey: MatchKey; imageMode: "replace" | "append"; rows: RawRow[] }, signal?: AbortSignal) =>
    api<RowResult[]>("/api/admin/bulk/check", { method: "POST", json: input, signal, ...SLOW }),
  apply: (input: { op: BulkOp; matchKey: MatchKey; imageMode: "replace" | "append"; rows: RawRow[]; jobId: string | null; source: string; totalRows: number; final: boolean;
    rejected?: { line: number; key: string | null; message: string }[]; rejectedCount?: number }, signal?: AbortSignal) =>
    api<{ jobId: string; results: RowResult[] }>("/api/admin/bulk/apply", { method: "POST", json: input, signal, ...SLOW }),
  jobs: () => api<BulkJob[]>("/api/admin/bulk/jobs"),
  feeds: () => api<FeedRecord[]>("/api/admin/bulk/feeds"),
  analyze: (input: { url: string; headerName?: string | null; headerValue?: string | null; feedId?: string | null; itemPath?: string | null }) =>
    api<FeedAnalysis>("/api/admin/bulk/feeds/analyze", { method: "POST", json: input, ...SLOW }),
  preview: (input: FeedConfigInput & { feedId?: string | null }) =>
    api<{ total: number; withoutKey: number; results: RowResult[] }>("/api/admin/bulk/feeds/preview", { method: "POST", json: input, ...SLOW }),
  createFeed: (input: FeedConfigInput) => api<{ id: string }>("/api/admin/bulk/feeds", { method: "POST", json: input }),
  updateFeed: (id: string, input: FeedConfigInput & { expectedUpdatedAt: string; removeHeader?: boolean }) =>
    api<{ id: string }>(`/api/admin/bulk/feeds/${encodeURIComponent(id)}`, { method: "PUT", json: input }),
  deleteFeed: (id: string) => api<{ deleted: true }>(`/api/admin/bulk/feeds/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runFeed: (id: string, signal?: AbortSignal) => api<SliceResult>(`/api/admin/bulk/feeds/${encodeURIComponent(id)}/run`, { method: "POST", signal, ...SLOW }),
};

import type { CSSProperties } from "react";
import { AdminCard } from "./ui";
import { TopProgress } from "./TopProgress";

/** Shimmering placeholder block. Size it with className (h-*, w-*, rounded-*). */
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`skeleton block ${className}`} style={style} />;
}

/** Wraps a skeleton with the accessible busy announcement and the top progress bar (loading.tsx files). */
export function LoadingShell({ label = "Yükleniyor", children }: { label?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-fade-in">
      <TopProgress />
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-[70vw]" />
      </div>
      {action ? <Skeleton className="h-10 w-36 rounded-lg" /> : null}
    </div>
  );
}

/** Generic admin page: header, KPI strip and a table. Used as the default admin loading state. */
export function AdminPageSkeleton() {
  return (
    <LoadingShell>
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <AdminCard key={i} className="flex items-center justify-between p-5">
              <div className="space-y-2">
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3.5 w-24" />
              </div>
              <Skeleton className="size-9 rounded-lg" />
            </AdminCard>
          ))}
        </div>
        <AdminCard>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <Skeleton className="h-10 w-64 max-w-[50vw] rounded-lg" />
            <Skeleton className="h-10 w-24 rounded-lg" />
          </div>
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <Skeleton className="size-8 flex-none rounded-full" />
                <Skeleton className="h-4 flex-1" style={{ maxWidth: `${60 - (i % 3) * 12}%` }} />
                <Skeleton className="hidden h-4 w-20 sm:block" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </AdminCard>
      </div>
    </LoadingShell>
  );
}

/** Mirrors <DataGrid />: toolbar, header row and data rows (thumb · text · badge). */
export function GridSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <AdminCard className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
        <Skeleton className="h-10 w-full rounded-lg sm:w-72" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-20 rounded-lg" />
        </div>
      </div>
      <div className="flex h-11 items-center gap-6 border-b border-slate-200 bg-slate-50 px-5">
        {[28, 16, 10, 10, 12].map((w, i) => <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />)}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-14 items-center gap-6 px-5">
            <span className="flex w-[28%] items-center gap-3">
              <Skeleton className="size-9 flex-none rounded-lg" />
              <span className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5" style={{ width: `${80 - (i % 3) * 15}%` }} />
                <Skeleton className="h-3 w-1/2" />
              </span>
            </span>
            <Skeleton className="h-3.5 w-[16%]" />
            <Skeleton className="h-3.5 w-[6%]" />
            <Skeleton className="h-6 w-14 rounded-full" />
            <Skeleton className="hidden h-3.5 w-[12%] sm:block" />
          </div>
        ))}
      </div>
    </AdminCard>
  );
}

/** Mirrors the category tree rows (chevron · thumb · name/slug · count) so nothing jumps on load. */
export function TreeSkeleton({ rows = 9 }: { rows?: number }) {
  const depth = [0, 1, 1, 2, 0, 1, 0, 1, 2];
  return (
    <AdminCard>
      <div className="space-y-1 p-2 sm:p-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-12 items-center gap-3 pr-2" style={{ paddingLeft: `${(depth[i % depth.length] ?? 0) * 22 + 10}px` }}>
            <Skeleton className="size-4 flex-none rounded" />
            <Skeleton className="size-9 flex-none rounded-lg" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5" style={{ width: `${46 - (i % 4) * 7}%` }} />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="hidden h-3.5 w-12 sm:block" />
          </div>
        ))}
      </div>
    </AdminCard>
  );
}

/** Mirrors the product editor page: header, sticky step tabs, section card, floating action bar. */
export function StepEditorSkeleton({ steps = 6 }: { steps?: number }) {
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-[80vw]" />
      </div>
      <AdminCard className="flex gap-2 overflow-hidden p-3">
        {Array.from({ length: steps }, (_, i) => (
          <div key={i} className="flex flex-1 items-center gap-3 px-2 py-1">
            <Skeleton className="size-8 flex-none rounded-full" />
            <div className="hidden flex-1 space-y-1.5 lg:block"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-3 w-16" /></div>
          </div>
        ))}
      </AdminCard>
      <FormSkeleton fields={8} />
    </div>
  );
}

export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <AdminCard className="space-y-5 p-4 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className={`space-y-2 ${i < 2 || i === fields - 1 ? "sm:col-span-2" : ""}`}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className={`${i === fields - 1 ? "h-24" : "h-11"} w-full rounded-[10px]`} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-5">
        <Skeleton className="h-10 w-24 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>
    </AdminCard>
  );
}

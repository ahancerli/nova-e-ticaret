import { LoadingShell, PageHeaderSkeleton } from "@/components/admin/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}
        </div>
      </div>
    </LoadingShell>
  );
}

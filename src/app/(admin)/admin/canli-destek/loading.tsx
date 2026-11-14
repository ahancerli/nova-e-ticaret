import { LoadingShell, PageHeaderSkeleton } from "@/components/admin/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <div className="h-[calc(100dvh-13rem)] min-h-[480px] animate-pulse rounded-2xl bg-slate-100" />
      </div>
    </LoadingShell>
  );
}

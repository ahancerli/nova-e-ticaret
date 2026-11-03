import { GridSkeleton, LoadingShell, PageHeaderSkeleton } from "@/components/admin/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <GridSkeleton rows={8} />
      </div>
    </LoadingShell>
  );
}

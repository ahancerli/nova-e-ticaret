import { GridSkeleton, LoadingShell, PageHeaderSkeleton, Skeleton } from "@/components/admin/Skeleton";

export default function ContentLoading() {
  return (
    <LoadingShell label="İçerik sayfaları yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <Skeleton className="h-56 w-full rounded-2xl" />
        <GridSkeleton rows={8} />
      </div>
    </LoadingShell>
  );
}

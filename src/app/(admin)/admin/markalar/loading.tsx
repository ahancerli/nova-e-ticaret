import { GridSkeleton, LoadingShell, PageHeaderSkeleton } from "@/components/admin/Skeleton";

export default function BrandsLoading() {
  return (
    <LoadingShell label="Markalar yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <GridSkeleton />
      </div>
    </LoadingShell>
  );
}

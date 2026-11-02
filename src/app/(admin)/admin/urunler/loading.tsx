import { GridSkeleton, LoadingShell, PageHeaderSkeleton } from "@/components/admin/Skeleton";

export default function ProductsLoading() {
  return (
    <LoadingShell label="Ürünler yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <GridSkeleton rows={10} />
      </div>
    </LoadingShell>
  );
}

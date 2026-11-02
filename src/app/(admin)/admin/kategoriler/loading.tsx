import { LoadingShell, PageHeaderSkeleton, TreeSkeleton } from "@/components/admin/Skeleton";

export default function CategoriesLoading() {
  return (
    <LoadingShell label="Kategoriler yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <TreeSkeleton />
      </div>
    </LoadingShell>
  );
}

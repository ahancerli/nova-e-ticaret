import { LoadingShell, PageHeaderSkeleton, Skeleton } from "@/components/admin/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Konuşmalar yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton action={false} />
        <Skeleton className="h-[calc(100vh-13rem)] min-h-[520px] rounded-2xl" />
      </div>
    </LoadingShell>
  );
}

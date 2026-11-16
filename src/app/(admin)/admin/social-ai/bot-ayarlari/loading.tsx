import { FormSkeleton, LoadingShell, PageHeaderSkeleton, Skeleton } from "@/components/admin/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton action={false} />
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <FormSkeleton fields={7} />
          <Skeleton className="h-[560px] rounded-2xl" />
        </div>
      </div>
    </LoadingShell>
  );
}

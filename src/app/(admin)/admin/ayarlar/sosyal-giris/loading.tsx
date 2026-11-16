import { FormSkeleton, LoadingShell, PageHeaderSkeleton } from "@/components/admin/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton action={false} />
        <FormSkeleton fields={4} />
      </div>
    </LoadingShell>
  );
}

import { FormSkeleton, LoadingShell, PageHeaderSkeleton } from "@/components/admin/Skeleton";

export default function NewCategoryLoading() {
  return (
    <LoadingShell label="Form hazırlanıyor">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeaderSkeleton />
        <FormSkeleton />
      </div>
    </LoadingShell>
  );
}

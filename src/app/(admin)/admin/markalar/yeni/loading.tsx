import { FormSkeleton, LoadingShell, PageHeaderSkeleton } from "@/components/admin/Skeleton";

export default function NewBrandLoading() {
  return (
    <LoadingShell label="Form hazırlanıyor">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeaderSkeleton />
        <FormSkeleton fields={5} />
      </div>
    </LoadingShell>
  );
}

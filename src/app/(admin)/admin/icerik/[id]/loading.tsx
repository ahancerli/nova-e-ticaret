import { FormSkeleton, LoadingShell } from "@/components/admin/Skeleton";

export default function NewContentLoading() {
  return (
    <LoadingShell label="Editör yükleniyor">
      <FormSkeleton fields={6} />
    </LoadingShell>
  );
}

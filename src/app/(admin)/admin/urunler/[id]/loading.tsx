import { LoadingShell, StepEditorSkeleton } from "@/components/admin/Skeleton";

export default function EditProductLoading() {
  return (
    <LoadingShell label="Ürün yükleniyor">
      <StepEditorSkeleton />
    </LoadingShell>
  );
}

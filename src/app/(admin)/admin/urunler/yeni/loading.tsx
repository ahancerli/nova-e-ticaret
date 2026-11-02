import { LoadingShell, StepEditorSkeleton } from "@/components/admin/Skeleton";

export default function NewProductLoading() {
  return (
    <LoadingShell label="Ürün formu hazırlanıyor">
      <StepEditorSkeleton />
    </LoadingShell>
  );
}

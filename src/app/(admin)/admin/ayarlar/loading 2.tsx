import { FormSkeleton, LoadingShell, PageHeaderSkeleton } from "@/components/admin/Skeleton";

export default function SettingsLoading() {
  return (
    <LoadingShell label="Site ayarları yükleniyor">
      <div className="space-y-6">
        <PageHeaderSkeleton />
        <FormSkeleton fields={8} />
      </div>
    </LoadingShell>
  );
}

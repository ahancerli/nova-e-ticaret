import { AdminCard } from "@/components/admin/ui";
import { GridSkeleton, LoadingShell, Skeleton } from "@/components/admin/Skeleton";

export default function OrdersLoading() {
  return (
    <LoadingShell label="Siparişler yükleniyor">
      <div className="space-y-4">
        <AdminCard className="grid gap-4 p-4 sm:grid-cols-2 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center justify-between px-1">
              <div className="space-y-2"><Skeleton className="h-7 w-20" /><Skeleton className="h-3.5 w-24" /></div>
              <Skeleton className="size-9 rounded-lg" />
            </div>
          ))}
        </AdminCard>
        <GridSkeleton rows={10} />
      </div>
    </LoadingShell>
  );
}

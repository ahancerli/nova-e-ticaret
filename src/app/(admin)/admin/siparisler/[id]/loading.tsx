import { AdminCard } from "@/components/admin/ui";
import { LoadingShell, Skeleton } from "@/components/admin/Skeleton";

/** Mirrors the order detail page: header, tracker, two columns of cards. */
export default function OrderDetailLoading() {
  return (
    <LoadingShell label="Sipariş yükleniyor">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-72" /><Skeleton className="h-4 w-96 max-w-[80vw]" /></div>
          <div className="flex gap-2"><Skeleton className="h-10 w-28 rounded-lg" /><Skeleton className="h-10 w-40 rounded-lg" /></div>
        </div>
        <AdminCard className="flex items-center gap-4 px-6 py-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-1 items-center gap-3"><Skeleton className="size-9 flex-none rounded-full" /><Skeleton className="h-1 flex-1 rounded-full" /></div>
          ))}
        </AdminCard>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <AdminCard className="divide-y divide-slate-100">
              <div className="px-5 py-4"><Skeleton className="h-5 w-32" /></div>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex gap-4 px-5 py-4">
                  <Skeleton className="size-16 flex-none rounded-xl" />
                  <div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/4" /></div>
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </AdminCard>
            <AdminCard className="space-y-3 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</AdminCard>
          </div>
          <div className="space-y-5">
            {Array.from({ length: 3 }, (_, i) => <AdminCard key={i} className="space-y-3 p-5"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></AdminCard>)}
          </div>
        </div>
      </div>
    </LoadingShell>
  );
}

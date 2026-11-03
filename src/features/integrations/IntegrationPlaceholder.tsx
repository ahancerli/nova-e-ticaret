import type { ComponentType } from "react";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";

/** Empty template for an integration screen that is planned but not built yet (SMS, shipping). */
export function IntegrationPlaceholder({ icon: Icon, title, subtitle, planned }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  planned: string[];
}) {
  return (
    <div className="space-y-6">
      <AdminPageHeader title={title} subtitle={subtitle} />
      <AdminCard className="max-w-3xl">
        <AdminCardTitle title="Henüz bağlı sağlayıcı yok" actions={<AdminBadge tone="amber">Yakında</AdminBadge>} />
        <div className="flex flex-col gap-5 px-5 py-6 sm:flex-row sm:items-start">
          <span className="grid size-12 flex-none place-items-center rounded-2xl bg-indigo-50 text-[#7367f0]"><Icon className="h-6 w-6" /></span>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Bu bölüm hazırlanıyor. Tamamlandığında burada şunları yapabileceksiniz:</p>
            <ul className="list-disc space-y-1 pl-5">
              {planned.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        </div>
      </AdminCard>
    </div>
  );
}

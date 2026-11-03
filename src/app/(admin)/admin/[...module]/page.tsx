import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { currentPrincipal } from "@/server/app";

const MODULES: Record<string, { title: string; tables: string; api: string }> = {
  odemeler: { title: "Ödeme sistemleri", tables: "payment_configs, bank_accounts, integration_secrets, bank_transfers", api: "/api/admin/payments" },
};

/** Placeholder for admin modules that are modelled in the schema but not built yet (see README roadmap). */
export default async function AdminModulePlaceholder({ params }: { params: Promise<{ module: string[] }> }) {
  const { module } = await params;
  const m = MODULES[module[0] ?? ""];
  const user = await currentPrincipal("admin");
  if (!m || !user?.isStaff) notFound();
  return (
    <div className="space-y-6">
      <AdminPageHeader title={m.title} subtitle="Bu bölüm için UI iskeleti hazırlandı, CRUD entegrasyonu sıradaki adımda tamamlanacak." />
      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="Modül özeti" actions={<AdminBadge tone="amber">Roadmap</AdminBadge>} />
        <div className="space-y-4 px-5 py-5 text-sm">
          <p className="text-slate-600">
            Bu modülün veri modeli hazır (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-700">{m.tables}</code>).
          </p>
          <p className="text-slate-600">
            API sözleşmesi: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-700">{m.api}</code>
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/siparisler" className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Siparişlere dön</Link>
            <Link href="/admin" className="inline-flex min-h-9 items-center rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700">Panele dön</Link>
          </div>
        </div>
      </AdminCard>
    </div>
  );
}

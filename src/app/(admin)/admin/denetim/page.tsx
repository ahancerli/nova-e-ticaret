import { AuditLogViewer } from "@/features/audit/AuditLogViewer";
import { GetAuditFilterOptionsToken } from "@/modules/audit";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Denetim kayıtları" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : "");

/** Deep links: `?kisi=<userId>`, `?tur=<entityType>&kayit=<entityId>` (e.g. "this record's history"). */
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("audit.read");
  const [sp, options] = await Promise.all([searchParams, (await resolveService(GetAuditFilterOptionsToken)).execute()]);
  return <AuditLogViewer options={options} initial={{ actorId: one(sp.kisi), entityType: one(sp.tur), entityId: one(sp.kayit) }} />;
}

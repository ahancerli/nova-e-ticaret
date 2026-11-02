import { DashboardView } from "@/features/dashboard/DashboardView";
import { DEFAULT_PERIOD, GetDashboardToken, PERIODS, PERIOD_KEYS, isPeriodKey } from "@/modules/reporting";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Gösterge paneli" };

const hourIn = new Intl.DateTimeFormat("tr-TR", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Istanbul" });

function greeting(nowIso: string, displayName: string): string {
  const h = Number(hourIn.format(new Date(nowIso)));
  const hello = h < 5 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
  const first = displayName.trim().split(/\s+/)[0];
  return first ? `${hello}, ${first}` : hello;
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const user = await requireAdminPage("orders.read");
  const { donem } = await searchParams;
  const period = isPeriodKey(donem) ? donem : DEFAULT_PERIOD;
  const data = await (await resolveService(GetDashboardToken)).execute(period, {
    canSeeCustomer: user.permissions.has("customers.read"),
    canSeeCatalog: user.permissions.has("catalog.read"),
  });

  return (
    <DashboardView
      data={data}
      greeting={greeting(data.period.to, user.displayName)}
      periods={PERIOD_KEYS.map((key) => ({ key, label: PERIODS[key].short, href: key === DEFAULT_PERIOD ? "/admin" : `/admin?donem=${key}` }))}
    />
  );
}

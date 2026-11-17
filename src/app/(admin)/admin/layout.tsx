import { Bricolage_Grotesque } from "next/font/google";
import { redirect } from "next/navigation";
import { AdminShell } from "@/features/admin-shell/AdminShell";
import type { SidebarGroup } from "@/features/admin-shell/AdminSidebar";
import { visibleNav } from "@/features/admin-shell/nav";
import { ConfigToken } from "@/core";
import { GetStaffRolesToken } from "@/modules/identity";
import { GetPublicSupportConfigToken } from "@/modules/support";
import { currentPrincipal, resolveService } from "@/server/app";

// Brand display face for page titles (same family as the storefront headings); body text stays on the system stack.
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], variable: "--nf-display", display: "swap" });

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Yönetim", template: "%s | nova. yönetim" }, robots: { index: false, follow: false } };

/** Every admin page is gated on the server. UI hiding below is convenience only; APIs re-check permissions. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentPrincipal("admin");
  if (!user) redirect("/admin/giris?next=/admin");
  if (!user.isStaff) redirect("/");

  const groups: SidebarGroup[] = visibleNav((p) => user.permissions.has(p));

  const can = (p: string) => user.permissions.has(p);
  const [roles, config, support] = await Promise.all([
    resolveService(GetStaffRolesToken).then((q) => q.execute(user.id)),
    resolveService(ConfigToken),
    can("support.chat") ? resolveService(GetPublicSupportConfigToken).then((q) => q.execute()) : null,
  ]);

  return (
    <AdminShell
      fontClassName={display.variable}
      user={{ displayName: user.displayName, email: user.email, roles }}
      groups={groups}
      quickCreate={{ product: can("catalog.write"), category: can("catalog.write"), brand: can("catalog.write"), page: can("content.write") }}
      env={config.isProduction ? "production" : "development"}
      support={Boolean(support?.enabled)}
    >
      {children}
    </AdminShell>
  );
}

import { Suspense } from "react";
import { NewsletterManager } from "@/features/newsletter/NewsletterManager";
import { requireAdminPage } from "@/server/app";

export const metadata = { title: "E-bülten" };
export const dynamic = "force-dynamic";

export default async function AdminNewsletterPage() {
  const user = await requireAdminPage("customers.read");
  return <Suspense><NewsletterManager canDelete={user.permissions.has("customers.write")} /></Suspense>;
}

import { redirect } from "next/navigation";

/** Entegrasyonlar has no page of its own: the menu opens AI, SMS and shipping integrations. */
export default function IntegrationsIndex() {
  redirect("/admin/entegrasyonlar/ai");
}

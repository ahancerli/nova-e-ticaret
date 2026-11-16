import { Suspense } from "react";
import { QuestionsManager } from "@/features/questions/QuestionsManager";
import { requireAdminPage } from "@/server/app";

export const metadata = { title: "Ürün soruları" };
export const dynamic = "force-dynamic";

export default async function AdminQuestionsPage() {
  await requireAdminPage("reviews.moderate");
  return <Suspense><QuestionsManager /></Suspense>;
}

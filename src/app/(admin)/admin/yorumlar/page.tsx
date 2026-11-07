import { Suspense } from "react";
import { ReviewsManager } from "@/features/reviews/ReviewsManager";
import { requireAdminPage } from "@/server/app";

export const metadata = { title: "Ürün yorumları" };
export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  await requireAdminPage("reviews.moderate");
  return <Suspense><ReviewsManager /></Suspense>;
}

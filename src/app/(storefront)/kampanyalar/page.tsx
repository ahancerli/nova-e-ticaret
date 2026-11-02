import { Suspense } from "react";
import { ListingClient } from "@/features/storefront/ListingClient";

export const metadata = { title: "Fırsatlar" };

// Lists all products; campaign-specific landing pages can be added per campaign later.
export default function DealsPage() {
  return <Suspense><ListingClient title="Fırsatlar" scope={{}} /></Suspense>;
}

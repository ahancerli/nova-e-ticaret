import { AdminPageSkeleton } from "@/components/admin/Skeleton";

// Instant fallback for every admin route while its server data streams in.
export default function AdminLoading() {
  return <AdminPageSkeleton />;
}

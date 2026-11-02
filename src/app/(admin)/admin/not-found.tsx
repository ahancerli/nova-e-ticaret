import { SearchX } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";

/** notFound() inside the admin (unknown order / product id…), rendered within the admin shell. */
export default function AdminNotFound() {
  return (
    <ErrorState
      tone="admin"
      icon={<SearchX className="size-10 text-slate-400" aria-hidden />}
      title="Kayıt bulunamadı"
      description="Aradığınız kayıt silinmiş, taşınmış ya da hiç var olmamış olabilir."
      home={{ href: "/admin", label: "Panele dön" }}
    />
  );
}

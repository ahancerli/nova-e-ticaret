"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { BrandForm } from "@/features/catalog/brands/BrandForm";

/** Create page wrapper: after a successful save, go back to the brand list and highlight the new row. */
export function BrandCreateForm() {
  const router = useRouter();
  return (
    <BrandForm
      formId="brand-create-form"
      mode="create"
      onSaved={(id) => router.push(`/admin/markalar?eklendi=${encodeURIComponent(id)}`)}
      renderActions={(busy) => (
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
          <Link href="/admin/markalar" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Vazgeç
          </Link>
          <button type="submit" disabled={busy}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
            <Save className="h-4 w-4" />
            {busy ? "Bekleyin…" : "Markayı kaydet"}
          </button>
        </div>
      )}
    />
  );
}

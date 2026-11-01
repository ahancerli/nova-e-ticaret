import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";
import { AdminBadge } from "@/components/admin/ui";

export const metadata = { title: "Panel girişi", robots: { index: false } };

export default function AdminLoginPage() {
  return (
    <div className="min-h-dvh bg-[#f5f6fb] p-4 sm:p-8">
      <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl lg:grid-cols-[1.2fr_1fr]">
        <section className="relative isolate hidden overflow-hidden bg-[#2b2f45] p-10 text-white lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,#818cf8_0%,transparent_48%)] opacity-70" />
          <div className="absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-indigo-300/25 blur-2xl" />
          <div className="absolute -right-16 top-12 h-56 w-56 rounded-full bg-violet-300/20 blur-2xl" />
          <div className="relative z-10 max-w-lg space-y-6">
            <AdminBadge tone="purple">NOVA · Admin Panel</AdminBadge>
            <h1 className="text-4xl font-semibold leading-tight">Yönetim süreçlerini tek bir merkezden yönetin.</h1>
            <p className="text-sm leading-6 text-slate-200">
              Sipariş, stok, kampanya ve ödeme operasyonları için modern dashboard deneyimi.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Canlı sipariş görünümü", "Dataview + filtreleme"],
                ["Yetki bazlı erişim", "Admin auth ve RBAC"],
                ["Operasyon KPI kartları", "Gelir · ödeme · kargo"],
                ["Modüler altyapı", "Yeni CRUD ekranlarına hazır"],
              ].map(([t, d]) => (
                <div key={t} className="rounded-xl border border-white/15 bg-white/10 p-3">
                  <p className="text-sm font-medium">{t}</p>
                  <p className="mt-1 text-xs text-slate-200">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="p-6 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Welcome back</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-900">Yönetim paneli girişi</h2>
          <p className="mt-2 text-sm text-slate-500">Sadece yetkili personel hesapları giriş yapabilir.</p>
          <div className="mt-7">
            <Suspense>
              <LoginForm endpoint="/api/admin/auth/login" fallbackTarget="/admin" submitLabel="Panele giriş yap" />
            </Suspense>
          </div>
        </section>
      </div>
    </div>
  );
}


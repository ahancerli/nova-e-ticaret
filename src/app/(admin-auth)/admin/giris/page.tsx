import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Panel girişi", robots: { index: false } };

function MiniTrend({ bars }: { bars: number[] }) {
  return (
    <div className="mt-3 grid h-16 grid-cols-8 items-end gap-1">
      {bars.map((b, i) => (
        <span key={i} className="rounded-sm bg-indigo-400/90" style={{ height: `${b}%` }} />
      ))}
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="min-h-dvh bg-[#f4f4f8]">
      <div className="grid min-h-dvh lg:grid-cols-[1fr_1.2fr]">
        <section className="flex items-center justify-center bg-white px-6 py-10">
          <div className="w-full max-w-md">
            <Link href="/" className="mb-8 inline-flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-800">
              nova<span className="text-[#7367f0]">.</span>
            </Link>
            <h1 className="text-3xl font-semibold text-slate-800">Panele hoş geldiniz 👋</h1>
            <p className="mt-2 text-sm text-slate-500">Devam etmek için yönetici hesabınızla giriş yapın.</p>

            <div className="mt-8">
              <Suspense>
                <LoginForm
                  endpoint="/api/admin/auth/login"
                  fallbackTarget="/admin"
                  submitLabel="Giriş yap"
                  card={false}
                  emailPlaceholder="E-posta adresinizi yazın"
                  passwordPlaceholder="Parolanızı yazın"
                  inputClassName="input h-11 border-slate-300 text-slate-700 placeholder:text-slate-400"
                  buttonClassName="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white transition hover:bg-[#6559df] disabled:opacity-60"
                />
              </Suspense>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm">
              <label className="inline-flex items-center gap-2 text-slate-600">
                <input type="checkbox" className="size-4 rounded border-slate-300 accent-[#7367f0]" />
                Beni hatırla
              </label>
              <button type="button" className="font-medium text-[#7367f0] hover:underline">Parolamı unuttum</button>
            </div>
          </div>
        </section>

        <section className="relative hidden overflow-hidden bg-[#f7f7fb] lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_35%,#ece8ff_0%,transparent_42%)]" />
          <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-slate-200/45 to-transparent" />

          <div className="absolute left-8 top-8 rounded-2xl bg-white/95 p-5 shadow-lg ring-1 ring-slate-200">
            <p className="text-2xl font-semibold text-slate-700">620K</p>
            <p className="text-xs text-slate-500">Aylık ciro</p>
            <MiniTrend bars={[20, 58, 34, 80, 47, 72, 51, 88]} />
          </div>

          <div className="absolute right-10 top-28 rounded-2xl bg-white/95 p-5 shadow-lg ring-1 ring-slate-200">
            <p className="text-2xl font-semibold text-slate-700">124K</p>
            <p className="text-xs text-slate-500">Yeni sipariş</p>
            <MiniTrend bars={[65, 48, 78, 44, 72, 58, 82, 68]} />
          </div>

          <div className="absolute bottom-10 left-1/2 w-[420px] -translate-x-1/2">
            <div className="relative mx-auto h-[420px] w-[280px]">
              <div className="absolute left-1/2 top-4 h-24 w-24 -translate-x-1/2 rounded-full bg-[#7367f0]" />
              <div className="absolute left-1/2 top-24 h-40 w-36 -translate-x-1/2 rounded-[42%] bg-[#8b80ff]" />
              <div className="absolute left-1/2 top-56 h-44 w-28 -translate-x-1/2 rounded-t-[40px] rounded-b-[22px] bg-[#4b4b60]" />
              <div className="absolute left-[86px] top-[304px] h-24 w-12 rounded-b-[22px] bg-[#38384b]" />
              <div className="absolute right-[86px] top-[304px] h-24 w-12 rounded-b-[22px] bg-[#38384b]" />
              <div className="absolute left-[70px] top-[392px] h-10 w-[72px] rounded-[20px] bg-[#2e2e3d]" />
              <div className="absolute right-[70px] top-[392px] h-10 w-[72px] rounded-[20px] bg-[#2e2e3d]" />
              <div className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full border border-slate-300/70" />
              <div className="absolute left-1/2 top-8 h-56 w-56 -translate-x-1/2 rounded-full bg-slate-100/90" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

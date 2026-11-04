import Link from "next/link";

/**
 * Split layout for panel sign-in, forgot-password and set-password pages: illustration with floating KPI cards on
 * the left (desktop), the form column on the right. Server component; the illustration is decorative (aria-hidden).
 */
export function AdminAuthShell({ siteName, children }: { siteName: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1.6fr)_minmax(440px,1fr)]">
      <aside aria-hidden className="relative hidden overflow-hidden bg-[#f8f7fa] lg:block">
        <BrandMark name={siteName} className="absolute left-8 top-8 z-10" />
        <svg viewBox="0 0 1000 300" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[38%] w-full text-[#efeef3]">
          <path d="M0 120 C 180 40, 420 40, 1000 90 L1000 300 L0 300 Z" fill="currentColor" />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="relative h-[460px] w-[560px]">
            <div className="absolute left-1/2 top-6 size-[400px] -translate-x-1/2 rounded-full border border-slate-200/80" />
            <div className="absolute left-1/2 top-16 size-[320px] -translate-x-1/2 rounded-full bg-[#eeedf6]" />
            <Illustration className="absolute left-1/2 top-10 h-[420px] -translate-x-1/2" />
            <KpiCard className="left-0 top-4 animate-float" title="Ciro" period="Son ay" value="624B" delta="+8,2%">
              <svg viewBox="0 0 100 40" className="h-12 w-28">
                <polyline points="2,34 20,22 36,30 56,14 74,22 96,4" fill="none" stroke="#28c3d7" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                {[[2, 34], [20, 22], [36, 30], [56, 14], [74, 22]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2.5" fill="#28c3d7" />)}
                <circle cx="96" cy="4" r="3.5" fill="#fff" stroke="#28c3d7" strokeWidth="2" />
              </svg>
            </KpiCard>
            <KpiCard className="right-0 top-36 animate-float [animation-delay:-3s]" title="Sipariş" period="Son hafta" value="124B" delta="+12,6%">
              <div className="flex h-12 w-28 items-end gap-2">
                {[70, 45, 28, 52, 88, 60, 96].map((h, i) => (
                  <span key={i} className="flex h-full w-2 items-end rounded-full bg-[#7367f0]/15"><span className="w-full rounded-full bg-[#7367f0]" style={{ height: `${h}%` }} /></span>
                ))}
              </div>
            </KpiCard>
          </div>
        </div>
      </aside>

      <main className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
        <BrandMark name={siteName} className="lg:hidden" />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-page-in">{children}</div>
        </div>
        <p className="text-center text-xs text-slate-400">© {new Date().getFullYear()} {siteName} · Yönetim paneli</p>
      </main>
    </div>
  );
}

function BrandMark({ name, className = "" }: { name: string; className?: string }) {
  return (
    <Link href="/admin/giris" className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="grid size-9 place-items-center rounded-xl bg-[#7367f0] text-lg font-extrabold text-white shadow-md shadow-[#7367f0]/30">
        {name.trim().charAt(0).toLocaleUpperCase("tr-TR")}
      </span>
      <span className="text-xl font-bold tracking-tight text-slate-800">{name}</span>
    </Link>
  );
}

function KpiCard({ title, period, value, delta, className, children }: {
  title: string; period: string; value: string; delta: string; className: string; children: React.ReactNode;
}) {
  return (
    <div className={`absolute rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgb(47_43_61/0.12)] ${className}`}>
      <p className="text-[15px] font-semibold text-slate-700">{title}</p>
      <p className="text-xs text-slate-400">{period}</p>
      <div className="my-3">{children}</div>
      <p className="flex items-baseline gap-2"><span className="text-2xl font-semibold text-slate-700">{value}</span><span className="text-xs font-semibold text-emerald-500">{delta}</span></p>
    </div>
  );
}

/** Store owner at a laptop with parcels and a shopping bag — flat shapes in the panel palette. */
function Illustration({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 400 420" className={className} fill="none">
      {/* desk */}
      <rect x="40" y="300" width="320" height="14" rx="7" fill="#d9d7e3" />
      <rect x="70" y="314" width="12" height="96" rx="6" fill="#c8c5d6" />
      <rect x="318" y="314" width="12" height="96" rx="6" fill="#c8c5d6" />
      {/* person */}
      <circle cx="200" cy="120" r="34" fill="#f2c9a8" />
      <path d="M166 112c0-26 16-40 36-40 22 0 36 14 34 40-8-12-22-16-36-16-14 0-26 6-34 16Z" fill="#2f2b3d" />
      <circle cx="189" cy="124" r="3" fill="#2f2b3d" />
      <circle cx="211" cy="124" r="3" fill="#2f2b3d" />
      <path d="M190 137c6 6 14 6 20 0" stroke="#2f2b3d" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M140 300c0-62 26-120 60-120s60 58 60 120Z" fill="#7367f0" />
      <path d="M182 180h36l-6 24h-24Z" fill="#f2c9a8" />
      {/* laptop */}
      <path d="M128 230h144l-14 70H142Z" fill="#4b465c" />
      <rect x="112" y="296" width="176" height="8" rx="4" fill="#2f2b3d" />
      <circle cx="200" cy="264" r="7" fill="#7367f0" opacity=".8" />
      {/* hands */}
      <ellipse cx="150" cy="292" rx="14" ry="8" fill="#f2c9a8" />
      <ellipse cx="250" cy="292" rx="14" ry="8" fill="#f2c9a8" />
      {/* parcels */}
      <rect x="290" y="236" width="62" height="64" rx="6" fill="#e0b989" />
      <path d="M290 254h62M321 236v18" stroke="#c99a63" strokeWidth="4" />
      <rect x="302" y="190" width="42" height="46" rx="5" fill="#ecc89a" />
      <path d="M302 203h42" stroke="#d4a873" strokeWidth="3" />
      {/* shopping bag */}
      <path d="M52 236h56l-6 64H58Z" fill="#9e95f5" />
      <path d="M66 236c0-18 28-18 28 0" stroke="#7367f0" strokeWidth="4" strokeLinecap="round" />
      {/* plant */}
      <rect x="22" y="272" width="22" height="28" rx="4" fill="#4b465c" />
      <path d="M33 272c-12-14-8-34 0-40 8 6 12 26 0 40Z" fill="#28c76f" />
    </svg>
  );
}

import { Heart, Package, Tag, Zap } from "lucide-react";

const PERKS = [
  { icon: Package, text: "Siparişlerini ve kargonu tek yerden takip et", color: "var(--color-dept-1)" },
  { icon: Zap, text: "Adresini kaydet, ödemeyi saniyeler içinde tamamla", color: "var(--color-dept-2)" },
  { icon: Tag, text: "Sana özel kampanya ve kuponları ilk sen gör", color: "var(--color-dept-3)" },
  { icon: Heart, text: "Değerlendirme yaz, deneyimini paylaş", color: "var(--color-dept-5)" },
];

/**
 * Sign-in / sign-up / password pages: brand panel with the membership perks beside the form card. On phones the
 * panel shrinks to a short coloured band above the form.
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="container-page py-6 md:py-12">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-[28px] border border-line bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <aside className="relative isolate overflow-hidden bg-brand px-6 py-7 text-white md:px-10 md:py-12">
          <span aria-hidden className="absolute -bottom-32 -right-28 -z-10 size-96 rounded-full border-[60px] border-white/10" />
          <span aria-hidden className="absolute -left-10 -top-10 -z-10 size-40 rounded-full bg-white/10" />
          <h1 className="font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] md:text-[44px]">{title}</h1>
          {subtitle && <p className="mt-2 max-w-sm text-[15px] text-white/90 md:mt-3">{subtitle}</p>}
          <ul className="mt-8 hidden space-y-3 lg:block">
            {PERKS.map(({ icon: Icon, text, color }) => (
              <li key={text} className="flex items-center gap-3 rounded-2xl bg-white/12 p-3 pr-4 text-sm font-medium backdrop-blur-sm">
                <span className="grid size-10 flex-none place-items-center rounded-full bg-white" style={{ color }}><Icon className="size-5" aria-hidden /></span>
                {text}
              </li>
            ))}
          </ul>
        </aside>
        <div className="px-5 py-7 md:px-10 md:py-12">{children}</div>
      </div>
    </div>
  );
}

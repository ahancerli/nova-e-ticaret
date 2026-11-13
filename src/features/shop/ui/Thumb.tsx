/**
 * Square-ish visual for categories / brands: the uploaded image, or the name's initial on the brand tint
 * (seeded categories often have no image yet).
 */
export function Thumb({ src, name, className = "size-16", rounded = "rounded-2xl", contain = false }: {
  src: string | null; name: string; className?: string; rounded?: string; contain?: boolean;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset; next/image optimisation is not configured
    return <img src={src} alt="" loading="lazy" className={`${className} ${rounded} flex-none bg-white ${contain ? "object-contain p-1.5" : "object-cover"}`} />;
  }
  return (
    <span aria-hidden className={`${className} ${rounded} grid flex-none place-items-center bg-brand-soft text-xl font-extrabold text-brand`}>
      {name.trim().charAt(0).toLocaleUpperCase("tr-TR")}
    </span>
  );
}

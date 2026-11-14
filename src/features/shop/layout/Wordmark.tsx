/**
 * Store identity: the uploaded logo, or the store name as text (a trailing "." gets the accent colour, as in
 * "nova.").
 */
export function Wordmark({ name, logoUrl, className = "h-9" }: { name: string; logoUrl: string | null; className?: string }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- uploaded asset path; next/image optimisation is not configured for it
    return <img src={logoUrl} alt={name} className={`${className} w-auto max-w-48 object-contain`} />;
  }
  const dot = name.endsWith(".");
  return (
    <span className="font-display text-[28px] font-extrabold leading-none tracking-[-0.04em] text-ink md:text-[34px]">
      {dot ? name.slice(0, -1) : name}
      {dot && <span className="text-brand">.</span>}
    </span>
  );
}

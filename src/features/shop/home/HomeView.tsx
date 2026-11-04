import type { HomeData, HomeSection } from "@/lib/types";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ProductGridSkeleton } from "../ui/ProductGrid";
import { HeroSlider } from "./HeroSlider";
import { Banner, BrandStrip, CategoryTiles, ProductsSection, StoryStrip } from "./sections";

/**
 * Home page body, server-rendered from the published home layout (Vitrin → Ana sayfa düzeni). Every section is a
 * full-width band, alternating white / grey so the page reads as clear steps; a hero slider directly followed by a
 * banner shares one band (side by side on wide screens). One broken section is reported and hidden, the rest
 * still renders.
 */
export function HomeView({ data }: { data: HomeData }) {
  if (!data.sections.length) return <p className="container-page py-16 text-center text-ink-soft">Henüz yayında içerik yok.</p>;
  const blocks: { key: string; tight: boolean; node: React.ReactNode }[] = [];
  const list = data.sections;
  for (let k = 0; k < list.length; k++) {
    const s = list[k]!;
    const next = list[k + 1];
    if (s.type === "hero_slider" && next?.type === "banner") {
      blocks.push({
        key: s.id, tight: false,
        node: (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Guard s={s}><HeroSlider slides={s.slides} /></Guard>
            <Guard s={next}><Banner s={next} compact /></Guard>
          </div>
        ),
      });
      k++;
      continue;
    }
    blocks.push({ key: s.id, tight: s.type === "story_strip", node: <Guard s={s}><Section s={s} index={k} /></Guard> });
  }
  return (
    // -mb-16 cancels the footer's top margin: the last band meets the footer directly.
    <div className="-mb-16">
      {blocks.map((b, i) => (
        <div key={b.key} data-band={i % 2 ? "grey" : "white"} className={i % 2 ? "bg-ground" : "border-b border-line/60 bg-white"}>
          <div className={`container-page ${b.tight ? "py-4 md:py-5" : "py-7 md:py-10"}`}>{b.node}</div>
        </div>
      ))}
    </div>
  );
}

function Guard({ s, children }: { s: HomeSection; children: React.ReactNode }) {
  return <ErrorBoundary name={`home.section:${s.type}`}>{children}</ErrorBoundary>;
}

function Section({ s, index }: { s: HomeSection; index: number }) {
  switch (s.type) {
    case "hero_slider": return <HeroSlider slides={s.slides} />;
    case "story_strip": return <StoryStrip s={s} />;
    case "category_tiles": return <CategoryTiles s={s} />;
    case "brand_strip": return <BrandStrip s={s} />;
    case "banner": return <Banner s={s} />;
    case "products": return <ProductsSection s={s} eager={index < 4} />;
  }
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yükleniyor">
      <div className="bg-white"><div className="container-page py-7"><div className="skeleton aspect-[5/2] w-full rounded-2xl" /></div></div>
      <div className="bg-ground"><div className="container-page flex gap-3 py-7">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-24 flex-1 rounded-xl" />)}</div></div>
      <div className="bg-white"><div className="container-page py-7"><ProductGridSkeleton count={5} /></div></div>
    </div>
  );
}

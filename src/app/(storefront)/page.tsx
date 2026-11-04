import { Suspense } from "react";
import { HomeSkeleton, HomeView } from "@/features/shop";
import { GetPublicSettingsToken } from "@/modules/settings";
import { GetHomeToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";

/** Home is server-rendered; its sections stream in behind the header/footer shell. */
export default async function HomePage() {
  const settings = await resolveService(GetPublicSettingsToken).then((q) => q.execute());
  return (
    <>
      <h1 className="sr-only">{settings.siteName}{settings.tagline ? ` — ${settings.tagline}` : ""}</h1>
      <Suspense fallback={<HomeSkeleton />}><HomeSections /></Suspense>
    </>
  );
}

async function HomeSections() {
  const data = await resolveService(GetHomeToken).then((q) => q.execute());
  return <HomeView data={data} />;
}

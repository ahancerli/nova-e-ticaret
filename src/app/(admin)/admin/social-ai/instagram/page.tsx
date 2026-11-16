import { ChannelPage } from "@/features/social-ai/ChannelPage";
import { GetChannelOverviewToken } from "@/modules/social-ai";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Instagram · Social AI Marketing" };
export const dynamic = "force-dynamic";

const text = (v: string | string[] | undefined, max: number) => (typeof v === "string" && v.length <= max ? v : null);

export default async function SocialInstagramPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("social_ai.manage");
  const [overview, q] = await Promise.all([resolveService(GetChannelOverviewToken).then((s) => s.execute("instagram")), searchParams]);
  // `code` / `state` / `red` come back from Instagram's login page (see /api/admin/social-ai/instagram/callback).
  return <ChannelPage overview={overview} callback={{ code: text(q.code, 2000), state: text(q.state, 400), denied: !!text(q.red, 200), error: text(q.hata, 80) }} />;
}

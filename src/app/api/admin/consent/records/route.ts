import { ListConsentRecordsToken, consentRecordsQuery } from "@/modules/consent";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/consent/records?ziyaretci=&sayfa=&boyut= — consent proof rows, newest first. */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" },
  query: consentRecordsQuery,
  handle: ({ query, resolve }) => resolve(ListConsentRecordsToken).execute({ visitorId: query.ziyaretci, page: query.sayfa, pageSize: query.boyut }),
});

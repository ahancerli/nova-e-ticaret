import { ConfigToken, isAppError } from "@/core";
import { StartInstagramLoginToken } from "@/modules/social-ai";
import { route } from "@/server/app";
import { stateCookie } from "../state-cookie";

export const dynamic = "force-dynamic";

/**
 * GET — target of "Instagram ile bağlan" (a browser navigation): stores the signed state cookie and sends the browser
 * to Instagram's consent screen. Failures go back to the channel page with a code.
 */
export const GET = route({
  auth: { audience: "admin", permission: "social_ai.manage" },
  cacheControl: "no-store",
  handle: async ({ resolve, logger }) => {
    try {
      const { url, state, maxAgeSec } = await resolve(StartInstagramLoginToken).execute();
      return new Response(null, {
        status: 302,
        headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer", "set-cookie": stateCookie(state, maxAgeSec, resolve(ConfigToken).publicSiteUrl.startsWith("https://")) },
      });
    } catch (err) {
      const code = isAppError(err) ? err.code : "social_ai_failed";
      if (!isAppError(err)) logger.error("instagram login start failed", { error: String(err) });
      return new Response(null, { status: 302, headers: { location: `/admin/social-ai/instagram?hata=${encodeURIComponent(code)}`, "cache-control": "no-store" } });
    }
  },
});

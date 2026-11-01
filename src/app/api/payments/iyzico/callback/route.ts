import { NextResponse } from "next/server";
import { verifyAndSettle } from "@/server/services/iyzico";
import { getEnv } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * iyzico redirects the buyer's browser here (form POST with `token`).
 * Protected by provider verification (server-to-server detail call), not by cookies.
 * The browser only ever sees a status page; PII is never put in the URL.
 */
export async function POST(req: Request) {
  const env = await getEnv();
  const base = env.PUBLIC_SITE_URL.replace(/\/$/, "");
  try {
    const form = await req.formData();
    const token = String(form.get("token") ?? "");
    if (!/^[A-Za-z0-9-]{10,100}$/.test(token)) return NextResponse.redirect(`${base}/siparis/sonuc?durum=hata`, 303);
    const r = await verifyAndSettle(token, "callback");
    const q = new URLSearchParams({ durum: r.status === "paid" ? "basarili" : "hata", ...(r.orderNumber ? { no: r.orderNumber } : {}) });
    return NextResponse.redirect(`${base}/siparis/sonuc?${q}`, 303);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", where: "iyzico.callback", message: err instanceof Error ? err.message : String(err) }));
    return NextResponse.redirect(`${base}/siparis/sonuc?durum=hata`, 303);
  }
}

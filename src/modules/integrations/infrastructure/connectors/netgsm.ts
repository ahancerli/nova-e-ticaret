import { toBase64 } from "@/core";
import type { ConnectorContext, SmsConnector } from "../../application/ports";
import { IntegrationErrors as E } from "../../domain/errors";

const URL_SEND = "https://api.netgsm.com.tr/sms/rest/v2/send";
const TIMEOUT_MS = 15_000;
const NAME = "Netgsm";

/** Netgsm result codes → what the admin should check. */
const CODES: Record<string, string> = {
  "20": "Mesaj metni hatalı ya da izin verilen uzunluğu aşıyor.",
  "30": "Kullanıcı adı / API şifresi hatalı, API erişim izni yok ya da IP kısıtı var.",
  "40": "Gönderici adı (SMS başlığı) Netgsm hesabınızda tanımlı değil.",
  "50": "İYS kontrollü gönderim yapılamıyor; hesabınızın İYS ayarlarını kontrol edin.",
  "51": "Hesabınıza tanımlı İYS marka bilgisi bulunamadı.",
  "70": "Hatalı istek; parametreleri kontrol edin.",
  "80": "Gönderim sınırı aşıldı.",
  "85": "Aynı numaraya mükerrer gönderim sınırı aşıldı.",
};

/**
 * Netgsm REST v2 (`/sms/rest/v2/send`, Basic auth = usercode:password). Order messages are informational, so they
 * go with `iysfilter: "0"` (no commercial consent needed). Success = code "00" + jobid.
 *
 * ⚠ Verify field names and codes against the current docs before going live: https://www.netgsm.com.tr/dokuman
 */
export class NetgsmConnector implements SmsConnector {
  readonly kind = "sms" as const;
  readonly code = "netgsm";

  constructor(private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  async send(ctx: ConnectorContext, message: { to: string[]; text: string }) {
    const { usercode, msgheader } = ctx.values;
    const password = ctx.secrets.password;
    if (!usercode || !password || !msgheader) throw E.providerFailed(NAME, "Kullanıcı adı, API şifresi ve gönderici adı gerekli.");
    let res: Response;
    try {
      res = await this.fetchFn(URL_SEND, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${toBase64(new TextEncoder().encode(`${usercode}:${password}`))}` },
        body: JSON.stringify({ msgheader, encoding: "TR", iysfilter: "0", messages: message.to.map((no) => ({ msg: message.text, no })) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw E.providerUnreachable(NAME);
    }
    const raw = (await res.text()).trim();
    let code = raw.split(/\s+/)[0] ?? "";
    let jobId: string | null = null;
    let j: unknown = null;
    try { j = JSON.parse(raw); } catch { /* plain text */ }
    if (j && typeof j === "object") {
      const o = j as { code?: string | number; jobid?: string | number };
      code = String(o.code ?? "");
      jobId = o.jobid ? String(o.jobid) : null;
    } else {
      // older plain-text answer "<code> <jobid>" ("30" alone parses as a JSON number)
      jobId = raw.split(/\s+/)[1] ?? null;
    }
    if (code === "00" || code === "01" || code === "02") return { providerRef: jobId };
    if (res.status === 401 || res.status === 403) throw E.providerFailed(NAME, CODES["30"]!, { status: res.status });
    throw E.providerFailed(NAME, CODES[code] ?? `Beklenmeyen yanıt (${code || res.status}).`, { code, status: res.status });
  }
}

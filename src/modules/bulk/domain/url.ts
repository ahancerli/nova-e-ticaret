import { BulkErrors } from "./errors";

/**
 * Only public https URLs may be fetched (SSRF): default port, no credentials, no internal host names, no private /
 * loopback / link-local / cloud-metadata / multicast IP literals (also the integer and IPv4-mapped IPv6 forms).
 */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw BulkErrors.urlNotAllowed("geçerli bir adres değil."); }
  if (u.protocol !== "https:") throw BulkErrors.urlNotAllowed("yalnız https:// adresleri.");
  if (u.username || u.password) throw BulkErrors.urlNotAllowed("adreste kullanıcı adı / parola olamaz (başlık alanını kullanın).");
  if (u.port && u.port !== "443") throw BulkErrors.urlNotAllowed("yalnız standart https portu (443).");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") || host === "localhost" || /\.(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) throw BulkErrors.urlNotAllowed("iç ağ adresi.");
  if (isPrivateIp(host)) throw BulkErrors.urlNotAllowed("özel / yerel IP adresi.");
  return u;
}

export function isPrivateIp(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (host.includes(":")) {
    const h = host.toLowerCase();
    if (h === "::" || h === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return isPrivateIp(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(h) || h.startsWith("64:ff9b:") || h.startsWith("2001:db8:");
  }
  // decimal / hex integer forms ("2130706433", "0x7f000001") are IPs too
  return /^(0x[0-9a-f]+|\d+)$/i.test(host);
}

export const newId = (): string => crypto.randomUUID();

export const nowIso = (): string => new Date().toISOString();

export const addMinutesIso = (minutes: number, from = new Date()): string =>
  new Date(from.getTime() + minutes * 60_000).toISOString();

/** Human-friendly order number: NV + yymmdd + 6 random base32 chars. */
export function newOrderNumber(d = new Date()): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rnd = crypto.getRandomValues(new Uint8Array(6));
  const tail = [...rnd].map((b) => alphabet[b % alphabet.length]).join("");
  const ymd = d.toISOString().slice(2, 10).replaceAll("-", "");
  return `NV${ymd}${tail}`;
}

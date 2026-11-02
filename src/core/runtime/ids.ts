/** Identifier source (UUIDs for rows, human-friendly order numbers). Injectable for deterministic tests. */
export interface IdGenerator {
  newId(): string;
  newOrderNumber(at?: Date): string;
}

const ORDER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class CryptoIdGenerator implements IdGenerator {
  newId(): string {
    return crypto.randomUUID();
  }

  /** NV + yymmdd + 6 random base32 chars (no 0/O/1/I). */
  newOrderNumber(at: Date = new Date()): string {
    const rnd = crypto.getRandomValues(new Uint8Array(6));
    const tail = [...rnd].map((b) => ORDER_ALPHABET[b % ORDER_ALPHABET.length]).join("");
    return `NV${at.toISOString().slice(2, 10).replaceAll("-", "")}${tail}`;
  }
}

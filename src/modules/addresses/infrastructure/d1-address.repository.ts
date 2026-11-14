import { Repository, type Statement } from "@/core";
import type { AddressRepository } from "../application/ports";
import { MAX_ADDRESSES, type AddressView } from "../domain/address";
import type { AddressInput } from "../http/schemas";

type Row = {
  id: string; label: string; recipient_name: string; phone_e164: string; country_code: string; province: string; district: string; line1: string; line2: string | null;
  postal_code: string | null; is_default_shipping: number; is_default_billing: number; updated_at: string;
};
const view = (r: Row): AddressView => ({
  id: r.id, label: r.label, recipientName: r.recipient_name, phone: r.phone_e164, countryCode: r.country_code, province: r.province, district: r.district, line1: r.line1, line2: r.line2,
  postalCode: r.postal_code, isDefaultShipping: r.is_default_shipping === 1, isDefaultBilling: r.is_default_billing === 1, updatedAt: r.updated_at,
});
const COLS = "id, label, recipient_name, phone_e164, country_code, province, district, line1, line2, postal_code, is_default_shipping, is_default_billing, updated_at";
const phone = (v: string) => (v.startsWith("+") ? v : `+${v}`);

export class D1AddressRepository extends Repository implements AddressRepository {
  async list(userId: string) {
    return (await this.db.all<Row>(`SELECT ${COLS} FROM addresses WHERE user_id = ? ORDER BY is_default_shipping DESC, updated_at DESC`, userId)).map(view);
  }

  async find(userId: string, id: string) {
    const r = await this.db.first<Row>(`SELECT ${COLS} FROM addresses WHERE user_id = ? AND id = ?`, userId, id);
    return r ? view(r) : null;
  }

  insertStatement(userId: string, id: string, a: AddressInput, now: string): Statement {
    return this.db.statement(
      `INSERT INTO addresses (id, user_id, label, recipient_name, phone_e164, country_code, province, district, line1, line2, postal_code, is_default_shipping, is_default_billing, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM addresses WHERE user_id = ?) < ${MAX_ADDRESSES}`,
      id, userId, a.label, a.recipientName, phone(a.phone), a.countryCode, a.province, a.district, a.line1, a.line2 || null, a.postalCode || null,
      a.isDefaultShipping ? 1 : 0, a.isDefaultBilling ? 1 : 0, now, now, userId,
    );
  }

  updateStatement(userId: string, id: string, a: AddressInput, now: string): Statement {
    return this.db.statement(
      `UPDATE addresses SET label = ?, recipient_name = ?, phone_e164 = ?, country_code = ?, province = ?, district = ?, line1 = ?, line2 = ?, postal_code = ?,
              is_default_shipping = ?, is_default_billing = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      a.label, a.recipientName, phone(a.phone), a.countryCode, a.province, a.district, a.line1, a.line2 || null, a.postalCode || null,
      a.isDefaultShipping ? 1 : 0, a.isDefaultBilling ? 1 : 0, now, id, userId,
    );
  }

  deleteStatement(userId: string, id: string): Statement {
    return this.db.statement("DELETE FROM addresses WHERE id = ? AND user_id = ?", id, userId);
  }

  clearDefaultsStatement(userId: string, exceptId: string, shipping: boolean, billing: boolean): Statement {
    return this.db.statement(
      `UPDATE addresses SET is_default_shipping = CASE WHEN ? = 1 THEN 0 ELSE is_default_shipping END,
                            is_default_billing  = CASE WHEN ? = 1 THEN 0 ELSE is_default_billing END
        WHERE user_id = ? AND id <> ? AND ((? = 1 AND is_default_shipping = 1) OR (? = 1 AND is_default_billing = 1))`,
      shipping ? 1 : 0, billing ? 1 : 0, userId, exceptId, shipping ? 1 : 0, billing ? 1 : 0,
    );
  }

  ensureDefaultsStatement(userId: string, now: string): Statement[] {
    const newest = "(SELECT id FROM addresses WHERE user_id = ?1 ORDER BY updated_at DESC, id LIMIT 1)";
    return (["is_default_shipping", "is_default_billing"] as const).map((col) => this.db.statement(
      `UPDATE addresses SET ${col} = 1, updated_at = ?2 WHERE id = ${newest} AND NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = ?1 AND ${col} = 1)`, userId, now,
    ));
  }
}

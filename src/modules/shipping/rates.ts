import { z } from "zod";
import {
  ClockToken, ConflictError, DatabaseToken, IdGeneratorToken, NotFoundError, Repository, UnitOfWork, token,
  type Clock, type Container, type Database, type IdGenerator, type Resolver, type Statement,
} from "@/core";
import { AuditLogToken, type AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import { slugify } from "@/lib/slug";

/**
 * Kargo ücretleri (panel): the shipping methods checkout charges — fee, free-shipping threshold, on/off. Pricing
 * applies the cheapest active method (`D1PricingRepository`), so at least one stays active. A method used by a
 * shipment cannot be deleted (only deactivated). Edits are guarded on `expectedUpdatedAt`.
 */
export interface ShippingRateView {
  id: string;
  code: string;
  name: string;
  feeMinor: number;
  freeAboveMinor: number | null;
  isActive: boolean;
  inUse: boolean;
  updatedAt: string | null;
}

export const MAX_FEE_MINOR = 10_000_000;

export const shippingRateSchema = z.object({
  name: z.string().trim().min(2, "En az 2 karakter girin.").max(60, "En fazla 60 karakter."),
  feeMinor: z.number().int().min(0, "Ücret negatif olamaz.").max(MAX_FEE_MINOR, "Ücret çok yüksek."),
  freeAboveMinor: z.number().int().positive("Eşik 0'dan büyük olmalı.").max(MAX_FEE_MINOR * 100).nullable(),
  isActive: z.boolean(),
  expectedUpdatedAt: z.string().max(40).nullable().optional(),
});
export type ShippingRateInput = z.infer<typeof shippingRateSchema>;

export const ShippingRateErrors = {
  notFound: () => new NotFoundError("shipping_method_not_found", "Kargo yöntemi bulunamadı."),
  changed: () => new ConflictError("shipping_method_changed", "Kargo yöntemi siz düzenlerken değişti. Sayfayı yenileyip tekrar deneyin."),
  lastActive: () => new ConflictError("last_active_shipping_method", "En az bir kargo yöntemi aktif kalmalı; ödeme sayfası kargo ücretini buradan alır."),
  inUse: () => new ConflictError("shipping_method_in_use", "Bu yöntemle gönderilmiş siparişler var; silinemez, pasif yapabilirsiniz."),
};

type Row = { id: string; code: string; name: string; fee_minor: number; free_above_minor: number | null; is_active: number; updated_at: string | null; in_use: number };
const view = (r: Row): ShippingRateView => ({
  id: r.id, code: r.code, name: r.name, feeMinor: r.fee_minor, freeAboveMinor: r.free_above_minor, isActive: r.is_active === 1, inUse: r.in_use === 1, updatedAt: r.updated_at,
});
const SELECT = `SELECT m.id, m.code, m.name, m.fee_minor, m.free_above_minor, m.is_active, m.updated_at,
                       EXISTS (SELECT 1 FROM shipments s WHERE s.shipping_method_id = m.id) AS in_use
                  FROM shipping_methods m`;
/** True when the row may stop being active: it is inactive anyway, or another active method remains. */
const KEEPS_ONE_ACTIVE = "(? = 1 OR EXISTS (SELECT 1 FROM shipping_methods o WHERE o.is_active = 1 AND o.id <> shipping_methods.id))";

export class ShippingRateRepository extends Repository {
  async list(): Promise<ShippingRateView[]> {
    return (await this.db.all<Row>(`${SELECT} ORDER BY m.is_active DESC, m.fee_minor, m.name`)).map(view);
  }
  async find(id: string): Promise<ShippingRateView | null> {
    const r = await this.db.first<Row>(`${SELECT} WHERE m.id = ?`, id);
    return r ? view(r) : null;
  }
  async codeTaken(code: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM shipping_methods WHERE code = ?", code)) !== null;
  }
  insertStatement(id: string, code: string, i: ShippingRateInput, now: string): Statement {
    return this.db.statement(
      "INSERT INTO shipping_methods (id, code, name, fee_minor, free_above_minor, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, code, i.name, i.feeMinor, i.freeAboveMinor, i.isActive ? 1 : 0, now,
    );
  }
  /** Guarded: same `updated_at` as loaded, and never the last active method switched off. */
  updateStatement(id: string, i: ShippingRateInput, expectedUpdatedAt: string | null, now: string): Statement {
    return this.db.statement(
      `UPDATE shipping_methods SET name = ?, fee_minor = ?, free_above_minor = ?, is_active = ?, updated_at = ?
        WHERE id = ? AND updated_at IS ? AND ${KEEPS_ONE_ACTIVE}`,
      i.name, i.feeMinor, i.freeAboveMinor, i.isActive ? 1 : 0, now, id, expectedUpdatedAt, i.isActive ? 1 : 0,
    );
  }
  deleteStatement(id: string): Statement {
    return this.db.statement(
      `DELETE FROM shipping_methods WHERE id = ? AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.shipping_method_id = shipping_methods.id)
          AND (is_active = 0 OR EXISTS (SELECT 1 FROM shipping_methods o WHERE o.is_active = 1 AND o.id <> shipping_methods.id))`, id,
    );
  }
}

interface Deps { db: Database; repo: ShippingRateRepository; audit: AuditLog; clock: Clock; ids: IdGenerator }
const auditOf = (v: Pick<ShippingRateView, "name" | "feeMinor" | "freeAboveMinor" | "isActive">) => ({ name: v.name, feeMinor: v.feeMinor, freeAboveMinor: v.freeAboveMinor, isActive: v.isActive });

export class ListShippingRates {
  constructor(private readonly repo: ShippingRateRepository) {}
  execute() { return this.repo.list(); }
}

export class CreateShippingRate {
  constructor(private readonly d: Deps) {}
  async execute(input: ShippingRateInput, actor: Actor): Promise<{ id: string }> {
    const base = slugify(input.name).replace(/-/g, "_").toUpperCase().slice(0, 30) || "KARGO";
    let code = base;
    for (let n = 2; await this.d.repo.codeTaken(code); n++) code = `${base}_${n}`;
    const id = this.d.ids.newId();
    await new UnitOfWork(this.d.db)
      .add(this.d.repo.insertStatement(id, code, input, this.d.clock.nowIso()))
      .add(this.d.audit.recordStatement({ actor, action: "shipping_method.create", entityType: "shipping_method", entityId: id, diff: auditOf(input) }))
      .commit();
    return { id };
  }
}

export class UpdateShippingRate {
  constructor(private readonly d: Deps) {}
  async execute(id: string, input: ShippingRateInput, actor: Actor): Promise<ShippingRateView> {
    const current = await this.d.repo.find(id);
    if (!current) throw ShippingRateErrors.notFound();
    const expected = input.expectedUpdatedAt ?? null;
    if (expected !== current.updatedAt) throw ShippingRateErrors.changed();
    // Only remaining reason for 0 changed rows (version matched just above): it was the last active method.
    await new UnitOfWork(this.d.db)
      .add(this.d.repo.updateStatement(id, input, expected, this.d.clock.nowIso()))
      .expectChanges(1, () => (current.isActive && !input.isActive ? ShippingRateErrors.lastActive() : ShippingRateErrors.changed()))
      .add(this.d.audit.recordStatement({ actor, action: "shipping_method.update", entityType: "shipping_method", entityId: id, diff: { before: auditOf(current), after: auditOf(input) } }))
      .commit();
    return (await this.d.repo.find(id))!;
  }
}

export class DeleteShippingRate {
  constructor(private readonly d: Deps) {}
  async execute(id: string, actor: Actor): Promise<void> {
    const current = await this.d.repo.find(id);
    if (!current) throw ShippingRateErrors.notFound();
    if (current.inUse) throw ShippingRateErrors.inUse();
    await new UnitOfWork(this.d.db)
      .add(this.d.repo.deleteStatement(id))
      .expectChanges(1, ShippingRateErrors.lastActive)
      .add(this.d.audit.recordStatement({ actor, action: "shipping_method.delete", entityType: "shipping_method", entityId: id, diff: auditOf(current) }))
      .commit();
  }
}

export const ShippingRateRepositoryToken = token<ShippingRateRepository>("ShippingRateRepository");
export const ListShippingRatesToken = token<ListShippingRates>("ListShippingRates");
export const CreateShippingRateToken = token<CreateShippingRate>("CreateShippingRate");
export const UpdateShippingRateToken = token<UpdateShippingRate>("UpdateShippingRate");
export const DeleteShippingRateToken = token<DeleteShippingRate>("DeleteShippingRate");

export function registerShippingRates(c: Container): void {
  const deps = (r: Resolver): Deps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(ShippingRateRepositoryToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(ShippingRateRepositoryToken, (r) => new ShippingRateRepository(r.resolve(DatabaseToken)));
  c.scoped(ListShippingRatesToken, (r) => new ListShippingRates(r.resolve(ShippingRateRepositoryToken)));
  c.scoped(CreateShippingRateToken, (r) => new CreateShippingRate(deps(r)));
  c.scoped(UpdateShippingRateToken, (r) => new UpdateShippingRate(deps(r)));
  c.scoped(DeleteShippingRateToken, (r) => new DeleteShippingRate(deps(r)));
}

import { ConflictError, UnitOfWork, ValidationError, type Clock, type Database } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import { WEEKDAYS, formatCutoff, type DeliveryRules, type DeliverySettings } from "../domain/delivery";
import type { DeliveryRepository } from "./ports";

/** Query: rules for the product page (computed in the browser so the countdown stays live). Null = switched off. */
export class GetDeliveryRules {
  constructor(private readonly repo: DeliveryRepository) {}

  async execute(): Promise<DeliveryRules | null> {
    const s = await this.repo.settings();
    const rules: DeliveryRules = {
      enabled: s.enabled, cutoffMinutes: s.cutoffMinutes, shipDays: s.shipDays, handlingDays: s.handlingDays,
      transitMinDays: s.transitMinDays, transitMaxDays: s.transitMaxDays, holidays: s.holidays,
    };
    return rules.enabled && rules.shipDays.length ? rules : null;
  }
}

/** Query: panel Kargo ücretleri › Tahmini teslim card. */
export class GetDeliverySettings {
  constructor(private readonly repo: DeliveryRepository) {}
  execute(): Promise<DeliverySettings> { return this.repo.settings(); }
}

/** Command: change the delivery promise rules (optimistic concurrency on `updatedAt`, audited). */
export class UpdateDeliverySettings {
  constructor(private readonly deps: { db: Database; repo: DeliveryRepository; audit: AuditLog; clock: Clock }) {}

  async execute(input: DeliveryRules & { expectedUpdatedAt: string }, actor: Actor): Promise<DeliverySettings> {
    const { expectedUpdatedAt, ...raw } = input;
    const rules: DeliveryRules = { ...raw, shipDays: [...new Set(raw.shipDays)].sort(), holidays: [...new Set(raw.holidays)].sort() };
    if (rules.enabled && !rules.shipDays.length) throw ValidationError.field("shipDays", "En az bir kargo günü seçin.", "delivery_ship_days_required");
    if (rules.transitMaxDays < rules.transitMinDays) throw ValidationError.field("transitMaxDays", "En çok süre en az süreden kısa olamaz.", "delivery_transit_range");
    await new UnitOfWork(this.deps.db)
      .add(this.deps.repo.updateStatement(rules, expectedUpdatedAt, actor.userId, this.deps.clock.nowIso()))
      .expectChanges(1, () => new ConflictError("delivery_settings_changed", "Teslim tahmini ayarları bu sırada değişti. Sayfayı yenileyip tekrar deneyin."))
      .add(this.deps.audit.recordStatement({
        actor, action: "delivery_settings.update", entityType: "delivery_settings", entityId: "1",
        diff: {
          enabled: rules.enabled, cutoff: formatCutoff(rules.cutoffMinutes), shipDays: rules.shipDays.map((d) => WEEKDAYS[d - 1]).join(", "),
          handlingDays: rules.handlingDays, transit: `${rules.transitMinDays}-${rules.transitMaxDays}`, holidays: rules.holidays.length,
        },
      }))
      .commit();
    return this.deps.repo.settings();
  }
}

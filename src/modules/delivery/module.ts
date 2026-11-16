import { ClockToken, DatabaseToken, token, type Container } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import type { DeliveryRepository } from "./application/ports";
import { GetDeliveryRules, GetDeliverySettings, UpdateDeliverySettings } from "./application/delivery-use-cases";
import { D1DeliveryRepository } from "./infrastructure/d1-delivery.repository";

export const DeliveryRepositoryToken = token<DeliveryRepository>("DeliveryRepository");
export const GetDeliveryRulesToken = token<GetDeliveryRules>("GetDeliveryRules");
export const GetDeliverySettingsToken = token<GetDeliverySettings>("GetDeliverySettings");
export const UpdateDeliverySettingsToken = token<UpdateDeliverySettings>("UpdateDeliverySettings");

export function registerDelivery(c: Container): void {
  c.scoped(DeliveryRepositoryToken, (r) => new D1DeliveryRepository(r.resolve(DatabaseToken)));
  c.scoped(GetDeliveryRulesToken, (r) => new GetDeliveryRules(r.resolve(DeliveryRepositoryToken)));
  c.scoped(GetDeliverySettingsToken, (r) => new GetDeliverySettings(r.resolve(DeliveryRepositoryToken)));
  c.scoped(UpdateDeliverySettingsToken, (r) => new UpdateDeliverySettings({
    db: r.resolve(DatabaseToken), repo: r.resolve(DeliveryRepositoryToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken),
  }));
}

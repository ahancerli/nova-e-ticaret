import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { MailSenderToken } from "@/modules/mail";
import { GetPublicSettingsToken } from "@/modules/settings";
import {
  CancelProductAlert, DispatchProductAlerts, GetProductAlertState, ListMyProductAlerts, SubscribeProductAlert, type AlertDeps,
} from "./application/alert-use-cases";
import type { ProductAlertRepository } from "./application/ports";
import { D1ProductAlertRepository } from "./infrastructure/d1-product-alert.repository";

export const ProductAlertRepositoryToken = token<ProductAlertRepository>("ProductAlertRepository");
export const SubscribeProductAlertToken = token<SubscribeProductAlert>("SubscribeProductAlert");
export const CancelProductAlertToken = token<CancelProductAlert>("CancelProductAlert");
export const GetProductAlertStateToken = token<GetProductAlertState>("GetProductAlertState");
export const ListMyProductAlertsToken = token<ListMyProductAlerts>("ListMyProductAlerts");
export const DispatchProductAlertsToken = token<DispatchProductAlerts>("DispatchProductAlerts");

export function registerAlerts(c: Container): void {
  const deps = (r: Resolver): AlertDeps => ({
    db: r.resolve(DatabaseToken), alerts: r.resolve(ProductAlertRepositoryToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(ProductAlertRepositoryToken, (r) => new D1ProductAlertRepository(r.resolve(DatabaseToken)));
  c.scoped(SubscribeProductAlertToken, (r) => new SubscribeProductAlert(deps(r)));
  c.scoped(CancelProductAlertToken, (r) => new CancelProductAlert(deps(r)));
  c.scoped(GetProductAlertStateToken, (r) => new GetProductAlertState(r.resolve(ProductAlertRepositoryToken)));
  c.scoped(ListMyProductAlertsToken, (r) => new ListMyProductAlerts(r.resolve(ProductAlertRepositoryToken)));
  c.scoped(DispatchProductAlertsToken, (r) => new DispatchProductAlerts(
    deps(r), r.resolve(MailSenderToken),
    async () => {
      const s = await r.resolve(GetPublicSettingsToken).execute();
      return { brand: s.siteName, siteUrl: r.resolve(ConfigToken).publicSiteUrl, accent: s.accentColor ?? "#f21c99" };
    },
    r.resolve(LoggerToken),
  ));
}

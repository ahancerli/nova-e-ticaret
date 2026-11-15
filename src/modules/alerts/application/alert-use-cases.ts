import { UnitOfWork, isAppError, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { MailSender } from "@/modules/mail";
import type { Actor } from "@/modules/shared/actor";
import {
  DISPATCH_BATCH, MAX_ACTIVE_ALERTS, MAX_SEND_ATTEMPTS, retryDelayMinutes,
  type AlertKind, type DispatchResult, type MyProductAlert, type ProductAlertState,
} from "../domain/alert";
import { buildAlertMail, type AlertMailContext } from "../domain/alert-mail";
import { AlertErrors } from "../domain/errors";
import type { ProductAlertRepository } from "./ports";

export interface AlertDeps {
  db: Database;
  alerts: ProductAlertRepository;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * Product page: follow a variant. Idempotent (an open alert of the same kind is returned as is). Back-in-stock is
 * refused while the variant can be bought; price-drop remembers today's retail price as the baseline.
 */
export class SubscribeProductAlert {
  constructor(private readonly deps: AlertDeps) {}

  async execute(input: { variantId: string; kind: AlertKind }, actor: Actor): Promise<ProductAlertState> {
    const { alerts } = this.deps;
    const v = await alerts.variant(input.variantId);
    if (!v) throw AlertErrors.variantNotFound();
    if (input.kind === "back_in_stock" && v.available > 0) throw AlertErrors.inStock();
    if (input.kind === "price_drop" && v.priceMinor == null) throw AlertErrors.noPrice();
    const existing = await alerts.findActive(actor.userId, input.variantId, input.kind);
    if (existing) return { alertId: existing.id, variantId: input.variantId, kind: input.kind };
    if ((await alerts.activeCount(actor.userId)) >= MAX_ACTIVE_ALERTS) throw AlertErrors.tooMany();

    const id = this.deps.ids.newId();
    try {
      await new UnitOfWork(this.deps.db).add(alerts.insertStatement({
        id, kind: input.kind, userId: actor.userId, productId: v.productId, variantId: input.variantId,
        baselinePriceMinor: input.kind === "price_drop" ? v.priceMinor : null, now: this.deps.clock.nowIso(),
      })).commit();
    } catch (err) {
      // double click: the partial unique index let the other request win
      const winner = await alerts.findActive(actor.userId, input.variantId, input.kind);
      if (!winner) throw err;
      return { alertId: winner.id, variantId: input.variantId, kind: input.kind };
    }
    return { alertId: id, variantId: input.variantId, kind: input.kind };
  }
}

export class CancelProductAlert {
  constructor(private readonly deps: AlertDeps) {}

  async execute(id: string, actor: Actor): Promise<{ cancelled: true }> {
    await new UnitOfWork(this.deps.db)
      .add(this.deps.alerts.cancelStatement(id, actor.userId, this.deps.clock.nowIso()))
      .expectChanges(1, AlertErrors.notFound)
      .commit();
    return { cancelled: true };
  }
}

/** Product page: the customer's open alerts for this product (per variant). */
export class GetProductAlertState {
  constructor(private readonly alerts: ProductAlertRepository) {}

  execute(productId: string, userId: string): Promise<ProductAlertState[]> {
    return this.alerts.forProduct(userId, productId);
  }
}

/** Hesabım › Haber ver listem: open alerts first, then the ones already mailed. */
export class ListMyProductAlerts {
  constructor(private readonly alerts: ProductAlertRepository) {}

  execute(userId: string): Promise<MyProductAlert[]> {
    return this.alerts.mine(userId, 100);
  }
}

/**
 * Cron (/api/cron/product-alerts): e-mails every alert whose condition holds (variant sellable again / retail price
 * below the baseline) through the shop SMTP account, then marks it notified. SMTP errors back off and give up after
 * MAX_SEND_ATTEMPTS; without SMTP settings nothing is touched (alerts wait for the shop to configure mail).
 */
export class DispatchProductAlerts {
  constructor(
    private readonly deps: AlertDeps, private readonly mail: MailSender, private readonly context: () => Promise<AlertMailContext>, private readonly logger: Logger,
  ) {}

  async execute(): Promise<DispatchResult> {
    const { alerts, clock, db } = this.deps;
    const due = await alerts.due(clock.nowIso(), DISPATCH_BATCH);
    const result: DispatchResult = { sent: 0, failed: 0, notConfigured: false };
    if (!due.length) return result;
    const ctx = await this.context();

    for (const a of due) {
      let outcome: "sent" | "not_configured";
      try {
        outcome = await this.mail.send({ purpose: "other", to: a.email, toName: a.customerName, ...buildAlertMail(a, ctx) });
      } catch (err) {
        const attempts = a.attempts + 1;
        const next = attempts >= MAX_SEND_ATTEMPTS ? null : clock.addMinutesIso(retryDelayMinutes(attempts));
        const message = isAppError(err) ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
        this.logger.warn("product alert e-mail failed", { alertId: a.id, attempts, gaveUp: next === null, error: message });
        await db.batch([alerts.failedAttemptStatement(a.id, message, next, clock.nowIso())]);
        result.failed++;
        continue;
      }
      if (outcome === "not_configured") {
        this.logger.warn("product alerts waiting: SMTP is not configured", { due: due.length });
        result.notConfigured = true;
        break;
      }
      await db.batch([alerts.notifiedStatement(a.id, a.priceMinor, clock.nowIso())]);
      result.sent++;
    }
    return result;
  }
}

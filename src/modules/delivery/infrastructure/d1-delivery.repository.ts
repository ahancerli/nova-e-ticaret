import { Repository, bit, bool, type Statement } from "@/core";
import type { DeliveryRepository } from "../application/ports";
import type { DeliveryRules, DeliverySettings } from "../domain/delivery";

type Row = {
  is_enabled: number; cutoff_minutes: number; ship_days: string; handling_days: number; transit_min_days: number; transit_max_days: number; holidays: string; updated_at: string;
};

const DEFAULTS: DeliverySettings = { enabled: false, cutoffMinutes: 900, shipDays: [1, 2, 3, 4, 5], handlingDays: 0, transitMinDays: 1, transitMaxDays: 3, holidays: [], updatedAt: "" };

const parse = <T>(raw: string, ok: (v: unknown) => v is T): T[] => {
  try { const v: unknown = JSON.parse(raw); return Array.isArray(v) ? v.filter(ok) : []; } catch { return []; }
};

export class D1DeliveryRepository extends Repository implements DeliveryRepository {
  async settings(): Promise<DeliverySettings> {
    const r = await this.db.first<Row>(
      "SELECT is_enabled, cutoff_minutes, ship_days, handling_days, transit_min_days, transit_max_days, holidays, updated_at FROM delivery_settings WHERE id = 1",
    );
    if (!r) return DEFAULTS;
    return {
      enabled: bool(r.is_enabled), cutoffMinutes: r.cutoff_minutes, shipDays: parse(r.ship_days, (v): v is number => Number.isInteger(v)),
      handlingDays: r.handling_days, transitMinDays: r.transit_min_days, transitMaxDays: r.transit_max_days,
      holidays: parse(r.holidays, (v): v is string => typeof v === "string"), updatedAt: r.updated_at,
    };
  }

  updateStatement(s: DeliveryRules, expectedUpdatedAt: string, actorId: string, now: string): Statement {
    return this.db.statement(
      `UPDATE delivery_settings SET is_enabled = ?, cutoff_minutes = ?, ship_days = ?, handling_days = ?, transit_min_days = ?, transit_max_days = ?, holidays = ?,
              updated_by = ?, updated_at = ?
        WHERE id = 1 AND updated_at = ?`,
      bit(s.enabled), s.cutoffMinutes, JSON.stringify(s.shipDays), s.handlingDays, s.transitMinDays, s.transitMaxDays, JSON.stringify(s.holidays), actorId, now, expectedUpdatedAt,
    );
  }
}

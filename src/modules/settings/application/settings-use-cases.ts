import { UnitOfWork, ValidationError, type AppConfig, type Clock, type Database, type Statement } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { MediaLibrary } from "@/modules/media";
import type { Actor } from "@/modules/shared/actor";
import { toPublicSettings, templateVariables, type PublicSettings } from "../domain/public-settings";
import { SETTINGS, SETTINGS_BY_KEY, SETTING_GROUP_KEYS, settingsOfGroup, type SettingGroup } from "../domain/registry";
import { validateSettings, type SettingValue } from "../domain/values";
import { SettingsErrors } from "../domain/errors";

export interface StoredSetting {
  key: string;
  value: SettingValue;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SettingsRepository {
  /** Registry keys only; unknown rows in the table are ignored. */
  load(keys: readonly string[]): Promise<StoredSetting[]>;
  imageUrls(mediaIds: string[]): Promise<Map<string, string>>;
  upsertStatement(s: { key: string; group: SettingGroup; value: Exclude<SettingValue, null>; isPublic: boolean; actorId: string; now: string }): Statement;
  deleteStatement(key: string): Statement;
}

export interface AdminSettings {
  values: Record<string, SettingValue>;
  /** mediaId → public URL for image settings (form previews). */
  images: Record<string, string>;
  /** Fingerprint of each group's current values — sent back as `expectedVersion` on update. */
  groupVersions: Record<string, string>;
}

/**
 * Fingerprint of a group's stored values (FNV-1a over the sorted key/value pairs). Unlike a timestamp it does not
 * depend on clocks or their precision: any change by someone else changes it.
 */
export function groupVersion(group: SettingGroup, values: Record<string, SettingValue>): string {
  const text = JSON.stringify(settingsOfGroup(group).map((d) => [d.key, values[d.key] ?? null]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const imageKeys = SETTINGS.filter((s) => s.type === "image").map((s) => s.key);
const toMap = (rows: StoredSetting[]) => Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, SettingValue>;
const imageIdsOf = (values: Record<string, SettingValue>) =>
  imageKeys.map((k) => values[k]).filter((v): v is string => typeof v === "string" && v !== "");

/** Query: every registry setting with its value, for the admin settings screen. */
export class GetAdminSettings {
  constructor(private readonly repo: SettingsRepository) {}

  async execute(): Promise<AdminSettings> {
    const rows = await this.repo.load(SETTINGS.map((s) => s.key));
    const values = toMap(rows);
    const groupVersions = Object.fromEntries(SETTING_GROUP_KEYS.map((g) => [g, groupVersion(g, values)]));
    return { values, images: Object.fromEntries(await this.repo.imageUrls(imageIdsOf(values))), groupVersions };
  }
}

export interface UpdateSettingsDeps {
  db: Database;
  repo: SettingsRepository;
  media: MediaLibrary;
  audit: AuditLog;
  clock: Clock;
}

/**
 * Command: updates the settings of one group. Every value is validated against its registry type; images must
 * be uploaded media. The group's version fingerprint guards against overwriting a colleague's edit.
 */
export class UpdateSettings {
  constructor(private readonly deps: UpdateSettingsDeps) {}

  async execute(group: SettingGroup, input: Record<string, unknown>, expectedVersion: string, actor: Actor): Promise<{ version: string }> {
    const defs = settingsOfGroup(group);
    const { values, fieldErrors } = validateSettings(input, defs.map((d) => d.key));
    if (Object.keys(fieldErrors).length) throw new ValidationError("invalid_settings", "Bazı alanlar geçersiz.", { fieldErrors });

    const before = toMap(await this.deps.repo.load(defs.map((d) => d.key)));
    if (groupVersion(group, before) !== expectedVersion) throw SettingsErrors.changedMeanwhile();

    for (const def of defs) {
      const v = values[def.key];
      if (def.type === "image" && typeof v === "string") await this.deps.media.assertImage(v, def.key);
    }

    const now = this.deps.clock.nowIso();
    const uow = new UnitOfWork(this.deps.db);
    const changed: Record<string, SettingValue> = {};
    for (const [key, value] of Object.entries(values)) {
      if (JSON.stringify(before[key] ?? null) === JSON.stringify(value)) continue;
      const def = SETTINGS_BY_KEY.get(key)!;
      changed[key] = value;
      uow.add(value === null
        ? this.deps.repo.deleteStatement(key)
        : this.deps.repo.upsertStatement({ key, group, value, isPublic: def.public, actorId: actor.userId, now }));
    }
    if (!Object.keys(changed).length) return { version: expectedVersion };

    await uow.add(this.deps.audit.recordStatement({ actor, action: "settings.update", entityType: "site_settings", entityId: group, diff: changed })).commit();

    // Replaced or cleared images are no longer referenced by this setting.
    for (const def of defs) {
      if (def.type !== "image" || !(def.key in changed)) continue;
      const old = before[def.key];
      if (typeof old === "string" && old !== changed[def.key]) await this.deps.media.release(old);
    }
    return { version: groupVersion(group, { ...before, ...changed }) };
  }
}

/** Query: typed public settings for the storefront shell, metadata and documents. */
export class GetPublicSettings {
  constructor(private readonly repo: SettingsRepository) {}

  async execute(): Promise<PublicSettings> {
    const values = toMap(await this.repo.load(SETTINGS.filter((s) => s.public).map((s) => s.key)));
    const urls = await this.repo.imageUrls(imageIdsOf(values));
    return toPublicSettings(values, (id) => urls.get(id) ?? null);
  }
}

/** Query: values for {{placeholders}} in content pages (company identity, contact, site address, year). */
export class GetTemplateVariables {
  constructor(private readonly repo: SettingsRepository, private readonly config: AppConfig, private readonly clock: Clock) {}

  async execute(): Promise<Record<string, string>> {
    const keys = SETTINGS.filter((s) => s.public && s.templateVar).map((s) => s.key);
    const values = toMap(await this.repo.load(keys));
    return templateVariables(values, {
      "site.adres": this.config.publicSiteUrl,
      "tarih.yil": String(new Date(this.clock.nowIso()).getUTCFullYear()),
    });
  }
}

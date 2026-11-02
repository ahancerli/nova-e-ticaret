import { ClockToken, ConfigToken, DatabaseToken, token, type Container } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MediaLibraryToken } from "@/modules/media";
import { GetAdminSettings, GetPublicSettings, GetTemplateVariables, UpdateSettings, type SettingsRepository } from "./application/settings-use-cases";
import { D1SettingsRepository } from "./infrastructure/d1-settings.repository";

export const SettingsRepositoryToken = token<SettingsRepository>("SettingsRepository");
export const GetAdminSettingsToken = token<GetAdminSettings>("GetAdminSettings");
export const UpdateSettingsToken = token<UpdateSettings>("UpdateSettings");
export const GetPublicSettingsToken = token<GetPublicSettings>("GetPublicSettings");
export const GetTemplateVariablesToken = token<GetTemplateVariables>("GetTemplateVariables");

export function registerSettings(c: Container): void {
  c.scoped(SettingsRepositoryToken, (r) => new D1SettingsRepository(r.resolve(DatabaseToken)));
  c.scoped(GetAdminSettingsToken, (r) => new GetAdminSettings(r.resolve(SettingsRepositoryToken)));
  c.scoped(UpdateSettingsToken, (r) => new UpdateSettings({
    db: r.resolve(DatabaseToken), repo: r.resolve(SettingsRepositoryToken), media: r.resolve(MediaLibraryToken),
    audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken),
  }));
  c.scoped(GetPublicSettingsToken, (r) => new GetPublicSettings(r.resolve(SettingsRepositoryToken)));
  c.scoped(GetTemplateVariablesToken, (r) => new GetTemplateVariables(r.resolve(SettingsRepositoryToken), r.resolve(ConfigToken), r.resolve(ClockToken)));
}

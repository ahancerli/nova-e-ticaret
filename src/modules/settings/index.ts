/** Public surface of the settings module (typed site configuration: identity, contact, branding, SEO, footer). */
export { SETTINGS, SETTINGS_BY_KEY, SETTING_GROUPS, SETTING_GROUP_KEYS, isSettingGroup, settingsOfGroup, type SettingDef, type SettingGroup, type SettingType } from "./domain/registry";
export { validateSettings, type LinkValue, type SettingValue } from "./domain/values";
export { TEMPLATE_VARIABLES, toPublicSettings, type PublicSettings, type SocialNetwork } from "./domain/public-settings";
export type { AdminSettings } from "./application/settings-use-cases";
export { settingsGroupParams, settingsUpdateSchema } from "./http/schemas";
export { GetAdminSettingsToken, GetPublicSettingsToken, GetTemplateVariablesToken, UpdateSettingsToken, registerSettings } from "./module";

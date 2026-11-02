import { UpdateSettingsToken, settingsGroupParams, settingsUpdateSchema, type SettingGroup } from "@/modules/settings";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * PUT /api/admin/settings/:group — { values: { key: value }, expectedVersion }.
 * Values are validated per key against the registry; 409 settings_changed if someone saved the group meanwhile.
 */
export const PUT = route({
  auth: { audience: "admin", permission: "settings.write" },
  params: settingsGroupParams,
  body: settingsUpdateSchema,
  handle: (ctx) => ctx.resolve(UpdateSettingsToken).execute(ctx.params.group as SettingGroup, ctx.body.values, ctx.body.expectedVersion, actorOf(ctx)),
});

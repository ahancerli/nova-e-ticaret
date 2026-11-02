import { ConflictError } from "@/core";

/** Settings error catalogue. */
export const SettingsErrors = {
  changedMeanwhile: () =>
    new ConflictError("settings_changed", "Bu ayarlar siz düzenlerken başka biri tarafından güncellendi. Sayfayı yenileyip değişikliklerinizi tekrar yapın."),
};

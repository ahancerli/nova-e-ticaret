import { ValidationError } from "@/core";

/** Notification error catalogue. */
export const NotificationErrors = {
  unknownType: (type: string) => ValidationError.field("type", `Bilinmeyen bildirim türü: ${type}`, "notification_type_unknown"),
  recipientsRequired: (label: string) => ValidationError.field("emailTo", `“${label}” için e-posta açık; en az bir alıcı girin.`, "notification_recipients_required"),
};

/** Public surface of the mail module: SMTP settings (panel) and the MailSender port (password reset e-mails). */
export * from "./domain/mail";
export type { MailSender, SmtpServer, SmtpTransport } from "./application/ports";
export { mailSettingsDeleteSchema, mailSettingsSchema } from "./http/schemas";
export {
  GetMailSettingsToken, ListMailDeliveriesToken, MailSenderToken, RemoveMailSettingsToken, SaveMailSettingsToken, SendTestMailToken, SmtpTransportToken, registerMail,
} from "./module";

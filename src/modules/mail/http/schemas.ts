import { z } from "zod";
import { SMTP_SECURITY, type SmtpSecurity } from "../domain/mail";

const noBreaks = (v: string) => !/[\r\n]/.test(v);

export const mailSettingsSchema = z.object({
  host: z.string().trim().min(3, "SMTP sunucusunu girin (ör. smtp.gmail.com).").max(253)
    .regex(/^[A-Za-z0-9.-]+$/, "Sunucu adı yalnız harf, rakam, nokta ve tire içerebilir."),
  port: z.coerce.number().int("Port tam sayı olmalı.").min(1, "Geçerli bir port girin.").max(65535, "Geçerli bir port girin.")
    .refine((p) => p !== 25, "Port 25 desteklenmiyor; 465 (SSL) veya 587 (STARTTLS) kullanın."),
  security: z.enum(SMTP_SECURITY as unknown as [SmtpSecurity, ...SmtpSecurity[]], { error: "Güvenlik türünü seçin." }),
  username: z.string().trim().min(1, "Kullanıcı adını girin.").max(254).refine(noBreaks, "Geçersiz kullanıcı adı."),
  password: z.string().max(200).optional().transform((v) => v || undefined).refine((v) => v === undefined || noBreaks(v), "Geçersiz parola."),
  fromEmail: z.email("Geçerli bir gönderen e-posta adresi girin.").max(254),
  fromName: z.string().trim().min(1, "Gönderen adını girin.").max(100).refine(noBreaks, "Geçersiz gönderen adı."),
  expectedUpdatedAt: z.string().max(40).nullable(),
}).strict();

export const mailSettingsDeleteSchema = z.object({ expectedUpdatedAt: z.string().min(1).max(40) }).strict();

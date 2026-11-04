import { z } from "zod";
import "@/modules/shared/schemas"; // Turkish Zod messages

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional(),
}).strict();

export const forgotPasswordSchema = z.object({
  email: z.email("Geçerli bir e-posta adresi girin.").max(254),
}).strict();

export const completeLinkSchema = z.object({
  token: z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/),
  password: z.string().min(1).max(200),
}).strict();

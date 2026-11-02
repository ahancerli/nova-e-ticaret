import { z } from "zod";
import "@/modules/shared/schemas"; // Turkish Zod messages

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
}).strict();

import { z } from "zod";
import { IYS_ENVIRONMENTS, type IysEnvironment } from "../domain/iys";

export const iysSettingsSchema = z.object({
  isActive: z.boolean(),
  environment: z.enum(Object.keys(IYS_ENVIRONMENTS) as [IysEnvironment, ...IysEnvironment[]]),
  iysCode: z.string().trim().regex(/^\d{3,20}$/, "İYS numarasını girin (yalnız rakam)."),
  brandCode: z.string().trim().regex(/^\d{3,20}$/, "Marka kodunu girin (yalnız rakam)."),
  username: z.string().trim().min(2, "API kullanıcı adını girin.").max(120),
  password: z.string().max(200).nullish(),
  expectedUpdatedAt: z.string().min(1).max(40),
}).strict();

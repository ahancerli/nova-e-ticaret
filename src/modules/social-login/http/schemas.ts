import { z } from "zod";
import "@/modules/shared/schemas"; // Turkish Zod messages
import { SOCIAL_PROVIDER_KEYS, type SocialProvider } from "../domain/social";

const provider = z.enum(SOCIAL_PROVIDER_KEYS as [SocialProvider, ...SocialProvider[]], { error: "Bu giriş sağlayıcısı desteklenmiyor." });

export const socialProviderParams = z.object({ provider });

export const socialProviderSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().trim().min(10, "Client ID çok kısa; sağlayıcı panelindeki değerin tamamını kopyalayın.").max(200)
    .regex(/^\S+$/, "Client ID boşluk içeremez; kopyalarken boşluk karışmış olabilir."),
  clientSecret: z.string().max(300).optional().transform((v) => v?.trim() || undefined)
    .pipe(z.string().min(10, "Client secret çok kısa; sağlayıcı panelindeki değerin tamamını kopyalayın.").regex(/^\S+$/, "Client secret boşluk içeremez.").optional()),
  expectedUpdatedAt: z.string().max(40).nullable(),
}).strict();

/** `next` is re-checked with `safeInternalPath` in the route; the length cap keeps the flow cookie small. */
export const socialStartQuery = z.object({ next: z.string().max(512).optional() });

/** Everything is optional: the provider decides what comes back, and a bad callback must end in a redirect, not a 422. */
export const socialCallbackQuery = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(256).optional(),
  error: z.string().max(100).optional(),
});

export const socialSignupSchema = z.object({
  firstName: z.string().trim().min(1, "Adınızı girin.").max(80),
  lastName: z.string().trim().min(1, "Soyadınızı girin.").max(80),
  kvkkAccepted: z.literal(true, { error: "Aydınlatma metnini okuduğunuzu onaylayın." }),
  marketingEmail: z.boolean().default(false),
  marketingSms: z.boolean().default(false),
}).strict();

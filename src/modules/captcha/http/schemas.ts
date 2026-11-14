import { z } from "zod";
import { CAPTCHA_FORM_KEYS, CAPTCHA_PROVIDER_KEYS, DEFAULT_MIN_SCORE, type CaptchaForm, type CaptchaProvider } from "../domain/captcha";

const key = (label: string) => z.string().trim().min(10, `${label} çok kısa; sağlayıcı panelindeki değerin tamamını kopyalayın.`).max(100)
  .regex(/^[A-Za-z0-9_-]+$/, `${label} yalnız harf, rakam, alt çizgi ve tire içerir; boşluk veya tırnak kopyalanmış olabilir.`);

export const captchaSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(CAPTCHA_PROVIDER_KEYS as [CaptchaProvider, ...CaptchaProvider[]], { error: "Sağlayıcıyı seçin." }),
  siteKey: key("Site anahtarı"),
  secretKey: z.string().max(200).optional().transform((v) => v?.trim() || undefined)
    .pipe(key("Gizli anahtar").optional()),
  forms: z.array(z.enum(CAPTCHA_FORM_KEYS as [CaptchaForm, ...CaptchaForm[]])).max(CAPTCHA_FORM_KEYS.length),
  minScore: z.coerce.number().min(0.1, "En düşük skor 0.1 olabilir.").max(0.9, "En yüksek skor 0.9 olabilir.").default(DEFAULT_MIN_SCORE),
  verificationToken: z.string().max(4096).optional().transform((v) => v || undefined),
  expectedUpdatedAt: z.string().max(40).nullable(),
}).strict();

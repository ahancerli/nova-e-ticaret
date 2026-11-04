import { GetPaymentSettingsToken } from "@/modules/payments";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/payments — iyzico accounts (key hints only), Havale / EFT state and bank accounts. */
export const GET = route({
  auth: { audience: "admin", permission: "payments.secrets" },
  handle: ({ resolve }) => resolve(GetPaymentSettingsToken).execute(),
});

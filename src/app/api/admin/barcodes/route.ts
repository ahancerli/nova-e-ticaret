import { GenerateBarcodesToken, GetBarcodeSettingsToken, SetBarcodePrefixToken, barcodeGenerateSchema, barcodePrefixSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — barcode prefix; POST — reserve new EAN-13 barcodes for variants; PUT — change the prefix (GS1 company prefix). */
export const GET = route({
  auth: { audience: "admin", permission: "catalog.read" },
  handle: ({ resolve }) => resolve(GetBarcodeSettingsToken).execute(),
});

export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: barcodeGenerateSchema,
  handle: async ({ body, resolve }) => ({ barcodes: await resolve(GenerateBarcodesToken).execute(body.count) }),
});

export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: barcodePrefixSchema,
  handle: async (ctx) => {
    await ctx.resolve(SetBarcodePrefixToken).execute(ctx.body.prefix, actorOf(ctx));
    return { saved: true };
  },
});

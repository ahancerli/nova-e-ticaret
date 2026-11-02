import { BadRequestError, PayloadTooLargeError, ValidationError, reply } from "@/core";
import { MAX_IMAGE_BYTES, UploadImageToken, isMediaFolder } from "@/modules/media";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Multipart overhead allowance on top of the image limit. */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * POST /api/admin/media  (multipart/form-data: file, folder)
 * Stores the image in R2 and returns { id, url } to attach to a record (e.g. categories.image_media_id).
 */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  csrf: "multipart",
  handle: async (ctx) => {
    // Reject oversized bodies before buffering them.
    if (Number(ctx.req.headers.get("content-length") ?? "0") > MAX_IMAGE_BYTES + MULTIPART_OVERHEAD) {
      throw new PayloadTooLargeError("file_too_large", "Görsel en fazla 5 MB olabilir.", { fieldErrors: { file: ["Görsel en fazla 5 MB olabilir."] } });
    }
    const form = await ctx.req.formData().catch(() => {
      throw new BadRequestError("invalid_form", "Yükleme verisi okunamadı.");
    });
    const file = form.get("file");
    const folder = String(form.get("folder") ?? "");
    if (!(file instanceof File)) throw ValidationError.field("file", "Bir görsel seçin.", "file_required");
    if (!isMediaFolder(folder)) throw ValidationError.field("folder", "Geçersiz klasör.", "invalid_folder");

    const media = await ctx.resolve(UploadImageToken).execute(
      { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, folder },
      actorOf(ctx),
    );
    return reply.created(media);
  },
});

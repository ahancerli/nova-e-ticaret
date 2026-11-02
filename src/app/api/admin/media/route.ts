import { ApiError, handler, ok, requestId } from "@/server/http";
import { audit, requirePermission } from "@/server/auth";
import { assertSameOrigin } from "@/server/security";
import { MAX_IMAGE_BYTES, MEDIA_FOLDERS, uploadImage, type MediaFolder } from "@/server/services/media";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/media  (multipart/form-data: file, folder)
 * Stores the image in R2 and returns { id, url } to attach to a record (e.g. categories.image_media_id).
 */
export const POST = handler(async (req) => {
  await assertSameOrigin(req, { multipart: true });
  const user = await requirePermission("catalog.write");
  // Reject oversized bodies before buffering them (multipart overhead allowance: 64 KB).
  if (Number(req.headers.get("content-length") ?? "0") > MAX_IMAGE_BYTES + 64 * 1024) {
    throw new ApiError(413, "file_too_large", "Görsel en fazla 5 MB olabilir.", { file: ["Görsel en fazla 5 MB olabilir."] });
  }
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "invalid_form", "Yükleme verisi okunamadı.");
  });
  const file = form.get("file");
  const folder = String(form.get("folder") ?? "");
  if (!(file instanceof File)) throw new ApiError(422, "file_required", "Bir görsel seçin.", { file: ["Bir görsel seçin."] });
  if (!MEDIA_FOLDERS.includes(folder as MediaFolder)) throw new ApiError(422, "invalid_folder", "Geçersiz klasör.");

  const media = await uploadImage({ bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, folder: folder as MediaFolder, uploadedBy: user.id });
  await audit(user.id, "media.upload", "media", media.id, { storageKey: media.storageKey, bytes: media.bytes, mime: media.mime }, requestId(req));
  return ok(req, media, {}, 201);
});

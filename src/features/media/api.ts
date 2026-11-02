"use client";

import { uploadFile } from "@/lib/api-client";
import type { UploadedImage as ServerUploadedImage } from "@/modules/media";

export type MediaFolder = "categories" | "brands" | "products" | "branding";

/** Multipart image upload to R2 with progress. */
export function uploadImage(file: File, folder: MediaFolder, opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}) {
  const form = new FormData();
  form.set("file", file);
  form.set("folder", folder);
  return uploadFile<ServerUploadedImage>("/api/admin/media", form, opts);
}

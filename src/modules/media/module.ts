import { DatabaseToken, EnvToken, IdGeneratorToken, LoggerToken, token, type Container } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MediaLibraryService, ReadAsset, UploadImage, type MediaLibrary } from "./application/media-service";
import type { MediaRepository, ObjectStorage } from "./application/ports";
import { D1MediaRepository } from "./infrastructure/d1-media.repository";
import { unavailableObjectStorage } from "./infrastructure/fs-object-storage";

export const MediaRepositoryToken = token<MediaRepository>("MediaRepository");
export const ObjectStorageToken = token<ObjectStorage>("ObjectStorage");
export const MediaLibraryToken = token<MediaLibrary>("MediaLibrary");
export const UploadImageToken = token<UploadImage>("UploadImage");
export const ReadAssetToken = token<ReadAsset>("ReadAsset");

export function registerMedia(c: Container): void {
  c.scoped(MediaRepositoryToken, (r) => new D1MediaRepository(r.resolve(DatabaseToken)));
  c.scoped(ObjectStorageToken, (r) => r.resolve(EnvToken).MEDIA_STORAGE ?? unavailableObjectStorage);
  c.scoped(MediaLibraryToken, (r) => new MediaLibraryService(r.resolve(MediaRepositoryToken), r.resolve(ObjectStorageToken), r.resolve(LoggerToken)));
  c.scoped(UploadImageToken, (r) => new UploadImage(r.resolve(DatabaseToken), r.resolve(MediaRepositoryToken), r.resolve(ObjectStorageToken), r.resolve(AuditLogToken), r.resolve(IdGeneratorToken)));
  c.scoped(ReadAssetToken, (r) => new ReadAsset(r.resolve(ObjectStorageToken)));
}

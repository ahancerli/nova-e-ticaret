import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { MediaLibrary } from "@/modules/media";
import type { Actor } from "@/modules/shared/actor";
import { normalizeSlug } from "@/modules/shared/slug";
import type { BrandInput, BrandPatch } from "../../domain/brand";
import { CatalogErrors } from "../../domain/errors";
import type { BrandRepository } from "../ports";

const textOrNull = (v: string | null | undefined) => v?.trim() || null;

export interface BrandCommandDeps {
  db: Database;
  brands: BrandRepository;
  media: MediaLibrary;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

abstract class BrandCommand {
  constructor(protected readonly deps: BrandCommandDeps) {}

  protected async assertImages(input: { logoMediaId?: string | null; bannerMediaId?: string | null }) {
    if (input.logoMediaId) await this.deps.media.assertImage(input.logoMediaId, "logoMediaId");
    if (input.bannerMediaId) await this.deps.media.assertImage(input.bannerMediaId, "bannerMediaId");
  }

  protected async freeSlug(raw: string, exceptId: string | null): Promise<string> {
    const slug = normalizeSlug(raw);
    if (await this.deps.brands.slugTaken(slug, exceptId)) throw CatalogErrors.slugTaken("markada");
    return slug;
  }
}

export class CreateBrand extends BrandCommand {
  async execute(input: BrandInput, actor: Actor): Promise<{ id: string; slug: string }> {
    await this.assertImages(input);
    const slug = await this.freeSlug(input.slug?.trim() || input.name, null);
    const id = this.deps.ids.newId();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.brands.insertStatement({
        id, name: input.name.trim(), slug, description: textOrNull(input.description),
        logoMediaId: input.logoMediaId ?? null, bannerMediaId: input.bannerMediaId ?? null,
        websiteUrl: textOrNull(input.websiteUrl), isActive: input.isActive, now: this.deps.clock.nowIso(),
      }))
      .add(this.deps.audit.recordStatement({ actor, action: "brand.create", entityType: "brand", entityId: id, diff: { ...input, slug } }))
      .commit();
    return { id, slug };
  }
}

export class UpdateBrand extends BrandCommand {
  async execute(id: string, patch: BrandPatch, actor: Actor): Promise<void> {
    const existing = await this.deps.brands.find(id);
    if (!existing) throw CatalogErrors.brandNotFound();
    await this.assertImages(patch);

    const normalized: BrandPatch = { ...patch };
    if (patch.name != null) normalized.name = patch.name.trim();
    if (patch.slug != null) normalized.slug = await this.freeSlug(patch.slug, id);
    if (patch.description !== undefined) normalized.description = textOrNull(patch.description);
    if (patch.websiteUrl !== undefined) normalized.websiteUrl = textOrNull(patch.websiteUrl);

    await new UnitOfWork(this.deps.db)
      .add(this.deps.brands.updateStatement(id, normalized, this.deps.clock.nowIso()))
      .expectChanges(1, CatalogErrors.brandNotFound)
      .add(this.deps.audit.recordStatement({ actor, action: "brand.update", entityType: "brand", entityId: id, diff: patch }))
      .commit();

    if (patch.logoMediaId !== undefined && patch.logoMediaId !== existing.logoMediaId) await this.deps.media.release(existing.logoMediaId);
    if (patch.bannerMediaId !== undefined && patch.bannerMediaId !== existing.bannerMediaId) await this.deps.media.release(existing.bannerMediaId);
  }
}

/**
 * products.brand_id is RESTRICT and stories.brand_id is CASCADE — deleting a brand must not silently
 * wipe homepage stories, so both block the delete with a clear message (and are re-checked atomically).
 */
export class DeleteBrand extends BrandCommand {
  async execute(id: string, actor: Actor): Promise<{ name: string; slug: string }> {
    const brand = await this.deps.brands.find(id);
    if (!brand) throw CatalogErrors.brandNotFound();
    if (brand.productCount > 0) throw CatalogErrors.brandHasProducts(brand.productCount);
    if (brand.storyCount > 0) throw CatalogErrors.brandHasStories();

    await new UnitOfWork(this.deps.db)
      .add(this.deps.brands.deleteIfUnusedStatement(id))
      .expectChanges(1, CatalogErrors.brandChanged)
      .add(this.deps.audit.recordStatement({ actor, action: "brand.delete", entityType: "brand", entityId: id, diff: { name: brand.name, slug: brand.slug } }))
      .commit();

    await this.deps.media.release(brand.logoMediaId);
    await this.deps.media.release(brand.bannerMediaId);
    return { name: brand.name, slug: brand.slug };
  }
}

import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { MediaLibrary } from "@/modules/media";
import type { Actor } from "@/modules/shared/actor";
import { normalizeSlug } from "@/modules/shared/slug";
import type { CategoryInput, CategoryPatch } from "../../domain/category";
import { CatalogErrors } from "../../domain/errors";
import type { CategoryRepository } from "../ports";

const textOrNull = (v: string | null | undefined) => v?.trim() || null;

/** Shared dependencies of the category commands (constructor injection, wired in catalog/module.ts). */
export interface CategoryCommandDeps {
  db: Database;
  categories: CategoryRepository;
  media: MediaLibrary;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

abstract class CategoryCommand {
  constructor(protected readonly deps: CategoryCommandDeps) {}

  protected async assertParent(parentId: string) {
    if (!(await this.deps.categories.exists(parentId))) throw CatalogErrors.invalidParent();
  }

  protected async assertImages(input: { imageMediaId?: string | null; menuMediaId?: string | null }) {
    if (input.imageMediaId) await this.deps.media.assertImage(input.imageMediaId, "imageMediaId");
    if (input.menuMediaId) await this.deps.media.assertImage(input.menuMediaId, "menuMediaId");
  }

  protected async freeSlug(raw: string, exceptId: string | null): Promise<string> {
    const slug = normalizeSlug(raw);
    if (await this.deps.categories.slugTaken(slug, exceptId)) throw CatalogErrors.slugTaken("kategoride");
    return slug;
  }
}

export class CreateCategory extends CategoryCommand {
  async execute(input: CategoryInput, actor: Actor): Promise<{ id: string; slug: string }> {
    const parentId = input.parentId ?? null;
    if (parentId) await this.assertParent(parentId);
    await this.assertImages(input);
    const slug = await this.freeSlug(input.slug?.trim() || input.name, null);

    const id = this.deps.ids.newId();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.categories.insertStatement({
        id, parentId, name: input.name.trim(), slug, description: textOrNull(input.description),
        imageMediaId: input.imageMediaId ?? null, menuMediaId: input.menuMediaId ?? null,
        sortOrder: input.sortOrder, isActive: input.isActive, now: this.deps.clock.nowIso(),
      }))
      .add(this.deps.audit.recordStatement({ actor, action: "category.create", entityType: "category", entityId: id, diff: { ...input, slug } }))
      .commit();
    return { id, slug };
  }
}

export class UpdateCategory extends CategoryCommand {
  async execute(id: string, patch: CategoryPatch, actor: Actor): Promise<void> {
    const existing = await this.deps.categories.findMediaRefs(id);
    if (!existing) throw CatalogErrors.categoryNotFound();

    if (patch.parentId === id) throw CatalogErrors.invalidParent("Kategori kendisinin üstü olamaz.");
    if (patch.parentId) {
      await this.assertParent(patch.parentId);
      if (await this.deps.categories.isDescendant(id, patch.parentId)) throw CatalogErrors.categoryCycle();
    }
    await this.assertImages(patch);

    const normalized: CategoryPatch = { ...patch };
    if (patch.name != null) normalized.name = patch.name.trim();
    if (patch.slug != null) normalized.slug = await this.freeSlug(patch.slug, id);
    if (patch.description !== undefined) normalized.description = textOrNull(patch.description);

    await new UnitOfWork(this.deps.db)
      .add(this.deps.categories.updateStatement(id, normalized, this.deps.clock.nowIso()))
      .expectChanges(1, CatalogErrors.categoryNotFound)
      .add(this.deps.audit.recordStatement({ actor, action: "category.update", entityType: "category", entityId: id, diff: patch }))
      .commit();

    // Replaced or removed uploads are cleaned up once nothing references them.
    if (patch.imageMediaId !== undefined && patch.imageMediaId !== existing.imageMediaId) await this.deps.media.release(existing.imageMediaId);
    if (patch.menuMediaId !== undefined && patch.menuMediaId !== existing.menuMediaId) await this.deps.media.release(existing.menuMediaId);
  }
}

export class DeleteCategory extends CategoryCommand {
  async execute(id: string, actor: Actor): Promise<{ name: string; slug: string }> {
    const existing = await this.deps.categories.findMediaRefs(id);
    if (!existing) throw CatalogErrors.categoryNotFound();
    const { children, products } = await this.deps.categories.dependents(id);
    if (children > 0) throw CatalogErrors.categoryHasChildren();
    if (products > 0) throw CatalogErrors.categoryHasProducts();

    await new UnitOfWork(this.deps.db)
      // Re-checks "no children, no products" inside the transaction: a child added meanwhile wins.
      .add(this.deps.categories.deleteIfUnusedStatement(id))
      .expectChanges(1, CatalogErrors.categoryChanged)
      .add(this.deps.audit.recordStatement({ actor, action: "category.delete", entityType: "category", entityId: id, diff: { name: existing.name, slug: existing.slug } }))
      .commit();

    await this.deps.media.release(existing.imageMediaId);
    await this.deps.media.release(existing.menuMediaId);
    return { name: existing.name, slug: existing.slug };
  }
}

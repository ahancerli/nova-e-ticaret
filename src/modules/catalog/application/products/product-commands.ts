import { UnitOfWork, ValidationError, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { MediaLibrary } from "@/modules/media";
import type { Actor } from "@/modules/shared/actor";
import type { SavedProduct } from "../../domain/product";
import { ProductErrors } from "../../domain/errors";
import { normalizeProductSlug, normalizeSku, planProductSave, type ProductSavePlan } from "./plan-product-save";
import type { ProductInput } from "./product-input";
import type { ProductRepository } from "./ports";
import type { GetProductMeta } from "./product-queries";

export interface ProductCommandDeps {
  db: Database;
  products: ProductRepository;
  meta: GetProductMeta;
  media: MediaLibrary;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

export interface ProductActor extends Actor {
  /** catalog.publish — needed to move a product to "published". */
  canPublish: boolean;
}

/**
 * Template Method: create and update share load → plan → write; they differ only in the audit entry.
 * The whole aggregate (product, categories, gallery, axes, variants, prices, stock + ledger, specs, SEO,
 * audit) is written in ONE UnitOfWork; guards make a concurrent edit / sale fail the batch instead of
 * being overwritten.
 */
abstract class SaveProduct {
  constructor(protected readonly deps: ProductCommandDeps) {}

  protected abstract auditEntry(input: ProductInput, plan: ProductSavePlan): { action: string; diff: unknown };

  /** Load the lookups and plan the save; nothing is written. */
  protected async prepare(productId: string | null, input: ProductInput, actor: ProductActor, now: string) {
    const { products } = this.deps;
    const current = productId ? await products.current(productId) : null;
    if (productId && !current) throw ProductErrors.notFound();

    const slug = normalizeProductSlug(input);
    const skus = [...new Set(input.variants.map((v) => normalizeSku(v.sku)))];
    const barcodes = [...new Set(input.variants.map((v) => v.barcode?.trim()).filter((b): b is string => Boolean(b)))];
    const modelCode = input.modelCode?.trim().toUpperCase();
    const [meta, slugTaken, modelCodeTaken, brandExists, foundCategoryIds, foundImageIds, skusTakenElsewhere, barcodesTakenElsewhere] = await Promise.all([
      this.deps.meta.execute(),
      slug.length >= 2 ? products.slugTaken(slug, productId) : Promise.resolve(false),
      modelCode ? products.modelCodeTaken(modelCode, productId) : Promise.resolve(false),
      input.brandId ? products.brandExists(input.brandId) : Promise.resolve(true),
      products.existingCategoryIds([...new Set(input.categories.map((c) => c.id))]),
      products.existingImageIds([...new Set([...input.media, ...input.variants.flatMap((v) => v.media ?? [])])]),
      products.takenElsewhere("sku", skus, productId),
      products.takenElsewhere("barcode", barcodes, productId),
    ]);

    return planProductSave({
      productId, input, current, meta, canPublish: actor.canPublish, now, newId: () => this.deps.ids.newId(),
      lookups: { slugTaken, modelCodeTaken, brandExists, foundCategoryIds, foundImageIds, skusTakenElsewhere, barcodesTakenElsewhere },
    });
  }

  protected async save(productId: string | null, input: ProductInput, actor: ProductActor): Promise<SavedProduct> {
    const now = this.deps.clock.nowIso();
    const { errors, plan } = await this.prepare(productId, input, actor, now);
    if (!plan) throw new ValidationError("validation_error", "Kaydedilemedi: işaretli alanları kontrol edin.", { fieldErrors: errors });

    const uow = this.writePlan(plan, actor, now);
    const { action, diff } = this.auditEntry(input, plan);
    uow.add(this.deps.audit.recordStatement({ actor, action, entityType: "product", entityId: plan.productId, diff }));
    await uow.commit();

    for (const m of plan.detachedMediaIds) await this.deps.media.release(m);
    return { id: plan.productId, slug: plan.fields.slug, archivedVariants: plan.archive.map((v) => v.sku), deletedVariants: plan.destroy.map((v) => v.sku) };
  }

  private writePlan(plan: ProductSavePlan, actor: Actor, now: string): UnitOfWork {
    const { products, ids } = this.deps;
    const newId = () => ids.newId();
    const id = plan.productId;
    const uow = new UnitOfWork(this.deps.db);

    uow.add(products.upsertProductStatement(plan, now));
    // Update: the row must still exist and, when the editor sent its version, still be that version.
    if (!plan.isNew) uow.expectChanges(1, plan.expectedUpdatedAt ? ProductErrors.changedMeanwhile : ProductErrors.notFound);
    uow.add(...products.replaceCategoriesStatements(id, plan.categoryIds, plan.primaryCategoryId));
    uow.add(...products.replaceGalleryStatements(id, plan.mediaIds, plan.primaryMediaId, newId));
    uow.add(...products.resetAxesStatements(id, plan.axes));

    for (const v of plan.destroy) {
      const s = products.destroyVariantStatements(id, v.id);
      uow.add(s.balance, s.variant).expectChanges(1, () => ProductErrors.variantGainedHistory(v.sku));
    }
    for (const v of plan.archive) uow.add(products.archiveVariantStatement(v.id, now));
    uow.add(...products.freeVariantSlotsStatements(id, plan.variants.filter((v) => !v.isNew).map((v) => v.id)));

    for (const v of plan.variants) {
      uow.add(products.writeVariantStatement(id, v, now));
      if (!v.isNew) uow.expectChanges(1, ProductErrors.changedMeanwhile);
      uow.add(products.priceStatement(v, now));

      // Stock: balance + append-only movement in the same transaction (spec §05).
      if (v.stock.kind === "create") {
        uow.add(products.createBalanceStatement(v.id, v.stock.onHand));
        if (v.stock.onHand !== 0) {
          uow.add(products.movementStatement({ id: newId(), variantId: v.id, productId: id, kind: "receipt", delta: v.stock.onHand, actorId: actor.userId, idempotencyKey: `mv:panel:${v.id}:${newId()}` }));
        }
      } else if (v.stock.kind === "adjust") {
        uow.add(products.adjustBalanceStatement(v.id, v.stock.expectedOnHand, v.stock.onHand, now))
          .expectChanges(1, () => ProductErrors.stockChangedMeanwhile(v.sku));
        uow.add(products.movementStatement({ id: newId(), variantId: v.id, productId: id, kind: "adjustment", delta: v.stock.delta, actorId: actor.userId, idempotencyKey: `mv:panel:${v.id}:${newId()}` }));
      }
      uow.add(...products.variantOptionStatements(v.id, v.options));
    }
    uow.add(...products.replaceVariantMediaStatements(id, plan.variants, newId));

    uow.add(...products.replaceAttributeValuesStatements(id, plan.attributeValues, newId));
    uow.add(products.seoStatement(id, plan.seo, newId));
    return uow;
  }
}

export class CreateProduct extends SaveProduct {
  execute(input: ProductInput, actor: ProductActor): Promise<SavedProduct> {
    return this.save(null, input, actor);
  }

  protected auditEntry(input: ProductInput) {
    return { action: "product.create", diff: { name: input.name, status: input.status, variants: input.variants.length } };
  }
}

/**
 * Query: would this save succeed? Runs the same lookups and plan as create / update without writing
 * (bulk imports check every row before the shop presses "Yükle"). null = valid, else field → messages.
 */
export class CheckProductSave extends SaveProduct {
  async execute(productId: string | null, input: ProductInput, actor: ProductActor): Promise<Record<string, string[]> | null> {
    try {
      const { errors, plan } = await this.prepare(productId, input, actor, this.deps.clock.nowIso());
      return plan ? null : errors;
    } catch (e) {
      // e.g. the product was deleted meanwhile
      if (e instanceof Error && "code" in e) return { product: [e.message] };
      throw e;
    }
  }

  protected auditEntry(): { action: string; diff: unknown } {
    throw new Error("CheckProductSave never writes");
  }
}

export class UpdateProduct extends SaveProduct {
  execute(id: string, input: ProductInput, actor: ProductActor): Promise<SavedProduct> {
    return this.save(id, input, actor);
  }

  protected auditEntry(input: ProductInput, plan: ProductSavePlan) {
    return {
      action: "product.update",
      diff: {
        name: input.name, status: input.status, modelCode: plan.fields.modelCode, variants: plan.variants.map((v) => v.sku),
        archivedVariants: plan.archive.map((v) => v.sku), deletedVariants: plan.destroy.map((v) => v.sku),
      },
    };
  }
}

/** Hard delete only for products that never sold / moved stock; otherwise archive (status = archived). */
export class DeleteProduct {
  constructor(private readonly deps: ProductCommandDeps) {}

  async execute(id: string, actor: Actor): Promise<{ name: string; slug: string }> {
    const { products } = this.deps;
    const product = await products.identity(id);
    if (!product) throw ProductErrors.notFound();
    const media = await products.mediaIds(id);

    await new UnitOfWork(this.deps.db)
      // The history check runs inside the transaction, so a sale that lands meanwhile blocks the delete.
      .add(products.assertNoHistoryStatement(id))
      .expectChanges(1, ProductErrors.hasHistory)
      .add(...products.deleteProductStatements(id))
      .add(this.deps.audit.recordStatement({ actor, action: "product.delete", entityType: "product", entityId: id, diff: product }))
      .commit();

    for (const m of media) await this.deps.media.release(m);
    return product;
  }
}

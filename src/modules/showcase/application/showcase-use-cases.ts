import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { MediaLibrary } from "@/modules/media";
import type { Actor } from "@/modules/shared/actor";
import { slugify } from "@/lib/slug";
import { ShowcaseErrors } from "../domain/errors";
import { isProductSection, isSafeLink, sectionProblems, type SectionInput, type SectionRow, type SlideInput, type SliderRow, type StoryCollectionRow, type StoryInput } from "../domain/showcase";
import type { ShowcaseRepository } from "./ports";

export interface ShowcaseDeps {
  db: Database;
  repo: ShowcaseRepository;
  media: MediaLibrary;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

const text = (v: string | null | undefined) => v?.trim() || null;
const unique = (xs: string[] | undefined) => [...new Set(xs ?? [])];

/** Images that a record no longer references after an update (released once the change is committed). */
const dropped = (before: (string | null | undefined)[], after: (string | null | undefined)[]) => {
  const keep = new Set(after.filter(Boolean));
  return before.filter((x): x is string => !!x && !keep.has(x));
};

abstract class ShowcaseCommand {
  constructor(protected readonly deps: ShowcaseDeps) {}

  protected audit(actor: Actor, action: string, entityId: string, diff: Record<string, unknown> = {}) {
    return this.deps.audit.recordStatement({ actor, action, entityType: "showcase", entityId, diff });
  }

  protected async images(fields: Record<string, string | null | undefined>) {
    for (const [field, id] of Object.entries(fields)) if (id) await this.deps.media.assertImage(id, field);
  }

  protected async release(ids: string[]) {
    for (const id of ids) await this.deps.media.release(id);
  }

  protected link(field: string, v: string | null | undefined) {
    if (v && !isSafeLink(v.trim())) throw ShowcaseErrors.invalid({ [field]: "Bağlantı / ile ya da https:// ile başlamalı." });
  }
}

// --- sections -------------------------------------------------------------------------------------------

/** Query: home page sections in display order (with type-specific settings). */
export class ListSections {
  constructor(private readonly repo: ShowcaseRepository) {}
  execute(): Promise<SectionRow[]> {
    return this.repo.sections();
  }
}

/**
 * Command: create / update a section. Type-specific requirements (slider, products, categories, banner image)
 * are checked; inactive sections may be saved incomplete as drafts. The type is fixed after creation.
 */
export class SaveSection extends ShowcaseCommand {
  async execute(id: string | null, raw: SectionInput & { expectedUpdatedAt?: string }, actor: Actor): Promise<{ id: string; updatedAt: string }> {
    const s: SectionInput = {
      ...raw, title: raw.title.trim(), subtitle: text(raw.subtitle), targetUrl: text(raw.targetUrl), ctaLabel: text(raw.ctaLabel),
      productIds: isProductSection(raw.type) && (raw.selectionMode ?? "manual") === "manual" ? unique(raw.productIds) : [],
      categoryIds: raw.type === "category_tiles" ? unique(raw.categoryIds) : [],
      brandIds: raw.type === "brand_strip" ? unique(raw.brandIds) : [],
      sliderId: raw.type === "hero_slider" ? raw.sliderId ?? null : null,
      storyCollectionId: raw.type === "story_strip" ? raw.storyCollectionId ?? null : null,
      mediaId: raw.type === "banner" ? raw.mediaId ?? null : null,
      mobileMediaId: raw.type === "banner" ? raw.mobileMediaId ?? null : null,
    };
    const problems = sectionProblems(s);
    if (Object.keys(problems).length) throw ShowcaseErrors.invalid(problems);
    this.link("targetUrl", s.targetUrl);
    await this.refs(s);
    await this.images({ mediaId: s.mediaId, mobileMediaId: s.mobileMediaId });

    const now = this.deps.clock.nowIso();
    const existing = id ? (await this.deps.repo.sections()).find((x) => x.id === id) : null;
    if (id && !existing) throw ShowcaseErrors.sectionNotFound();
    if (existing && existing.type !== s.type) throw ShowcaseErrors.typeLocked();

    const sectionId = id ?? this.deps.ids.newId();
    const uow = new UnitOfWork(this.deps.db);
    if (existing) {
      uow.add(this.deps.repo.updateSectionStatement(sectionId, s, raw.expectedUpdatedAt ?? "", now)).expectChanges(1, ShowcaseErrors.changedMeanwhile);
    } else {
      uow.add(this.deps.repo.insertSectionStatement(sectionId, s, await this.deps.repo.nextSortOrder(), now));
    }
    await uow
      .add(...this.deps.repo.replaceSectionItemsStatements(sectionId, s))
      .add(this.audit(actor, existing ? "showcase.section.update" : "showcase.section.create", sectionId, { type: s.type, title: s.title, isActive: s.isActive }))
      .commit();
    if (existing) await this.release(dropped([existing.media?.id, existing.mobileMedia?.id], [s.mediaId, s.mobileMediaId]));
    return { id: sectionId, updatedAt: now };
  }

  private async refs(s: SectionInput) {
    const check = async (table: Parameters<ShowcaseRepository["countExisting"]>[0], field: string, list: string[]) => {
      if (list.length && (await this.deps.repo.countExisting(table, list)) !== list.length) throw ShowcaseErrors.unknownRef(field);
    };
    await check("products", "productIds", s.productIds ?? []);
    await check("categories", "categoryIds", s.categoryIds ?? []);
    await check("brands", "brandIds", s.brandIds ?? []);
    await check("sliders", "sliderId", s.sliderId ? [s.sliderId] : []);
    await check("story_collections", "storyCollectionId", s.storyCollectionId ? [s.storyCollectionId] : []);
  }
}

/** Command: switch a section on/off without opening the editor (an incomplete draft cannot go live). */
export class ToggleSection extends ShowcaseCommand {
  async execute(id: string, active: boolean, actor: Actor): Promise<void> {
    const s = (await this.deps.repo.sections()).find((x) => x.id === id);
    if (!s) throw ShowcaseErrors.sectionNotFound();
    if (active) {
      const problems = sectionProblems({ ...s, isActive: true, mediaId: s.media?.id ?? null });
      if (Object.keys(problems).length) throw ShowcaseErrors.invalid(problems);
    }
    await new UnitOfWork(this.deps.db)
      .add(this.deps.repo.setSectionActiveStatement(id, active, this.deps.clock.nowIso()))
      .add(this.audit(actor, active ? "showcase.section.activate" : "showcase.section.deactivate", id))
      .commit();
  }
}

/** Command: new order of all sections (the list sent must be exactly the current set). */
export class ReorderSections extends ShowcaseCommand {
  async execute(order: string[], actor: Actor): Promise<void> {
    const current = (await this.deps.repo.sections()).map((s) => s.id);
    if (order.length !== current.length || new Set(order).size !== order.length || order.some((x) => !current.includes(x))) throw ShowcaseErrors.orderMismatch();
    await new UnitOfWork(this.deps.db)
      .add(...order.map((sid, i) => this.deps.repo.sortSectionStatement(sid, i + 1)))
      .add(this.audit(actor, "showcase.section.reorder", "home", { order }))
      .commit();
  }
}

export class DeleteSection extends ShowcaseCommand {
  async execute(id: string, actor: Actor): Promise<void> {
    const s = (await this.deps.repo.sections()).find((x) => x.id === id);
    if (!s) throw ShowcaseErrors.sectionNotFound();
    await new UnitOfWork(this.deps.db).add(this.deps.repo.deleteSectionStatement(id)).add(this.audit(actor, "showcase.section.delete", id, { title: s.title })).commit();
    await this.release([s.media?.id, s.mobileMedia?.id].filter((x): x is string => !!x));
  }
}

// --- sliders ---------------------------------------------------------------------------------------------

export class ListSliders {
  constructor(private readonly repo: ShowcaseRepository) {}
  execute(): Promise<SliderRow[]> {
    return this.repo.sliders();
  }
}

export class CreateSlider extends ShowcaseCommand {
  async execute(name: string, actor: Actor): Promise<{ id: string }> {
    const id = this.deps.ids.newId();
    const code = `${slugify(name).replace(/-/g, "_").slice(0, 40) || "slider"}_${id.slice(-5).toLowerCase()}`;
    await new UnitOfWork(this.deps.db).add(this.deps.repo.insertSliderStatement(id, code, name.trim())).add(this.audit(actor, "showcase.slider.create", id, { name })).commit();
    return { id };
  }
}

export class DeleteSlider extends ShowcaseCommand {
  async execute(id: string, actor: Actor): Promise<void> {
    const slider = (await this.deps.repo.sliders()).find((s) => s.id === id);
    if (!slider) throw ShowcaseErrors.sliderNotFound();
    if (slider.usedBy) throw ShowcaseErrors.inUse("slider", slider.usedBy);
    await new UnitOfWork(this.deps.db).add(this.deps.repo.deleteSliderStatement(id)).expectChanges(1, () => ShowcaseErrors.inUse("slider", 1))
      .add(this.audit(actor, "showcase.slider.delete", id, { name: slider.name })).commit();
    await this.release(slider.slides.flatMap((x) => [x.desktop.id, x.mobile?.id]).filter((x): x is string => !!x));
  }
}

/** Command: add or edit a slide (desktop image required, mobile optional). */
export class SaveSlide extends ShowcaseCommand {
  async execute(sliderId: string, slideId: string | null, raw: SlideInput, actor: Actor): Promise<{ id: string }> {
    if (!(await this.deps.repo.sliders()).some((s) => s.id === sliderId)) throw ShowcaseErrors.sliderNotFound();
    const s: SlideInput = { ...raw, title: raw.title.trim(), subtitle: text(raw.subtitle), ctaLabel: text(raw.ctaLabel), targetUrl: text(raw.targetUrl) };
    if (s.endsAt && s.startsAt && s.endsAt <= s.startsAt) throw ShowcaseErrors.invalid({ endsAt: "Bitiş, başlangıçtan sonra olmalı." });
    this.link("targetUrl", s.targetUrl);
    await this.images({ desktopMediaId: s.desktopMediaId, mobileMediaId: s.mobileMediaId });

    const existing = slideId ? await this.deps.repo.slide(slideId) : null;
    if (slideId && (!existing || existing.sliderId !== sliderId)) throw ShowcaseErrors.slideNotFound();
    const id = slideId ?? this.deps.ids.newId();
    await new UnitOfWork(this.deps.db)
      .add(existing ? this.deps.repo.updateSlideStatement(id, s) : this.deps.repo.insertSlideStatement(id, sliderId, s, await this.deps.repo.nextSlideOrder(sliderId)))
      .add(this.audit(actor, existing ? "showcase.slide.update" : "showcase.slide.create", id, { title: s.title }))
      .commit();
    if (existing) await this.release(dropped([existing.desktopMediaId, existing.mobileMediaId], [s.desktopMediaId, s.mobileMediaId]));
    return { id };
  }
}

export class DeleteSlide extends ShowcaseCommand {
  async execute(slideId: string, actor: Actor): Promise<void> {
    const existing = await this.deps.repo.slide(slideId);
    if (!existing) throw ShowcaseErrors.slideNotFound();
    await new UnitOfWork(this.deps.db).add(this.deps.repo.deleteSlideStatement(slideId)).add(this.audit(actor, "showcase.slide.delete", slideId)).commit();
    await this.release([existing.desktopMediaId, existing.mobileMediaId].filter((x): x is string => !!x));
  }
}

export class ReorderSlides extends ShowcaseCommand {
  async execute(sliderId: string, order: string[], actor: Actor): Promise<void> {
    const slider = (await this.deps.repo.sliders()).find((s) => s.id === sliderId);
    if (!slider) throw ShowcaseErrors.sliderNotFound();
    const current = slider.slides.map((x) => x.id);
    if (order.length !== current.length || order.some((x) => !current.includes(x))) throw ShowcaseErrors.orderMismatch();
    await new UnitOfWork(this.deps.db).add(...order.map((sid, i) => this.deps.repo.sortSlideStatement(sid, sliderId, i + 1)))
      .add(this.audit(actor, "showcase.slide.reorder", sliderId, { order })).commit();
  }
}

// --- stories ---------------------------------------------------------------------------------------------

export class ListStoryCollections {
  constructor(private readonly repo: ShowcaseRepository) {}
  execute(): Promise<StoryCollectionRow[]> {
    return this.repo.collections();
  }
}

export class CreateStoryCollection extends ShowcaseCommand {
  async execute(name: string, actor: Actor): Promise<{ id: string }> {
    const id = this.deps.ids.newId();
    const slug = `${slugify(name).slice(0, 60) || "hikayeler"}-${id.slice(-5).toLowerCase()}`;
    await new UnitOfWork(this.deps.db).add(this.deps.repo.insertCollectionStatement(id, name.trim(), slug)).add(this.audit(actor, "showcase.stories.create", id, { name })).commit();
    return { id };
  }
}

export class DeleteStoryCollection extends ShowcaseCommand {
  async execute(id: string, actor: Actor): Promise<void> {
    const c = (await this.deps.repo.collections()).find((x) => x.id === id);
    if (!c) throw ShowcaseErrors.collectionNotFound();
    if (c.usedBy) throw ShowcaseErrors.inUse("koleksiyon", c.usedBy);
    await new UnitOfWork(this.deps.db).add(this.deps.repo.deleteCollectionStatement(id)).expectChanges(1, () => ShowcaseErrors.inUse("koleksiyon", 1))
      .add(this.audit(actor, "showcase.stories.delete", id, { name: c.name })).commit();
    await this.release(c.stories.flatMap((s) => [s.cover?.id, ...s.frames.map((f) => f.media.id)]).filter((x): x is string => !!x));
  }
}

/** Command: add or edit a story with its frames (images shown one after another, each optionally linked). */
export class SaveStory extends ShowcaseCommand {
  async execute(collectionId: string, storyId: string | null, raw: StoryInput, actor: Actor): Promise<{ id: string }> {
    if (!(await this.deps.repo.collections()).some((c) => c.id === collectionId)) throw ShowcaseErrors.collectionNotFound();
    const s: StoryInput = { ...raw, title: raw.title.trim(), frames: raw.frames.map((f) => ({ ...f, targetUrl: text(f.targetUrl) })) };
    if (!s.frames.length) throw ShowcaseErrors.framesRequired();
    if (s.endsAt && s.startsAt && s.endsAt <= s.startsAt) throw ShowcaseErrors.invalid({ endsAt: "Bitiş, başlangıçtan sonra olmalı." });
    s.frames.forEach((f, i) => this.link(`frames.${i}.targetUrl`, f.targetUrl));
    if ((await this.deps.repo.countExisting("brands", [s.brandId])) !== 1) throw ShowcaseErrors.unknownRef("brandId");
    await this.images({ coverMediaId: s.coverMediaId, ...Object.fromEntries(s.frames.map((f, i) => [`frames.${i}.mediaId`, f.mediaId])) });

    const existing = storyId ? await this.deps.repo.storyMedia(storyId) : null;
    if (storyId && (!existing || existing.collectionId !== collectionId)) throw ShowcaseErrors.storyNotFound();
    const id = storyId ?? this.deps.ids.newId();
    await new UnitOfWork(this.deps.db)
      .add(...this.deps.repo.saveStoryStatements(id, collectionId, s, existing ? null : await this.deps.repo.nextStoryOrder(collectionId), () => this.deps.ids.newId()))
      .add(this.audit(actor, existing ? "showcase.story.update" : "showcase.story.create", id, { title: s.title, frames: s.frames.length }))
      .commit();
    if (existing) await this.release(dropped(existing.mediaIds, [s.coverMediaId, ...s.frames.map((f) => f.mediaId)]));
    return { id };
  }
}

export class DeleteStory extends ShowcaseCommand {
  async execute(storyId: string, actor: Actor): Promise<void> {
    const existing = await this.deps.repo.storyMedia(storyId);
    if (!existing) throw ShowcaseErrors.storyNotFound();
    await new UnitOfWork(this.deps.db).add(this.deps.repo.deleteStoryStatement(storyId)).add(this.audit(actor, "showcase.story.delete", storyId)).commit();
    await this.release(existing.mediaIds);
  }
}

export class ReorderStories extends ShowcaseCommand {
  async execute(collectionId: string, order: string[], actor: Actor): Promise<void> {
    const c = (await this.deps.repo.collections()).find((x) => x.id === collectionId);
    if (!c) throw ShowcaseErrors.collectionNotFound();
    const current = c.stories.map((x) => x.id);
    if (order.length !== current.length || order.some((x) => !current.includes(x))) throw ShowcaseErrors.orderMismatch();
    await new UnitOfWork(this.deps.db).add(...order.map((sid, i) => this.deps.repo.sortStoryStatement(sid, collectionId, i + 1)))
      .add(this.audit(actor, "showcase.story.reorder", collectionId, { order })).commit();
  }
}

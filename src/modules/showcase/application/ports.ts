import type { Statement } from "@/core";
import type { SectionInput, SectionRow, SlideInput, SliderRow, StoryCollectionRow, StoryInput } from "../domain/showcase";

export interface ShowcaseRepository {
  sections(): Promise<SectionRow[]>;
  countExisting(table: "products" | "categories" | "brands" | "sliders" | "story_collections", ids: string[]): Promise<number>;
  nextSortOrder(): Promise<number>;
  insertSectionStatement(id: string, s: SectionInput, sortOrder: number, now: string): Statement;
  updateSectionStatement(id: string, s: SectionInput, expectedUpdatedAt: string, now: string): Statement;
  replaceSectionItemsStatements(id: string, s: SectionInput): Statement[];
  setSectionActiveStatement(id: string, active: boolean, now: string): Statement;
  sortSectionStatement(id: string, sortOrder: number): Statement;
  deleteSectionStatement(id: string): Statement;

  sliders(): Promise<SliderRow[]>;
  slide(id: string): Promise<{ sliderId: string; desktopMediaId: string; mobileMediaId: string | null } | null>;
  insertSliderStatement(id: string, code: string, name: string): Statement;
  deleteSliderStatement(id: string): Statement;
  nextSlideOrder(sliderId: string): Promise<number>;
  insertSlideStatement(id: string, sliderId: string, s: SlideInput, sortOrder: number): Statement;
  updateSlideStatement(id: string, s: SlideInput): Statement;
  sortSlideStatement(id: string, sliderId: string, sortOrder: number): Statement;
  deleteSlideStatement(id: string): Statement;

  collections(): Promise<StoryCollectionRow[]>;
  storyMedia(id: string): Promise<{ collectionId: string; mediaIds: string[] } | null>;
  insertCollectionStatement(id: string, name: string, slug: string): Statement;
  deleteCollectionStatement(id: string): Statement;
  nextStoryOrder(collectionId: string): Promise<number>;
  /** sortOrder null = update an existing story; frames are replaced. */
  saveStoryStatements(id: string, collectionId: string, s: StoryInput, sortOrder: number | null, newId: () => string): Statement[];
  sortStoryStatement(id: string, collectionId: string, sortOrder: number): Statement;
  deleteStoryStatement(id: string): Statement;
}

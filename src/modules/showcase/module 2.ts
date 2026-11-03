import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MediaLibraryToken } from "@/modules/media";
import type { ShowcaseRepository } from "./application/ports";
import * as uc from "./application/showcase-use-cases";
import { D1ShowcaseRepository } from "./infrastructure/d1-showcase.repository";

export const ShowcaseRepositoryToken = token<ShowcaseRepository>("ShowcaseRepository");
export const ListSectionsToken = token<uc.ListSections>("ListSections");
export const SaveSectionToken = token<uc.SaveSection>("SaveSection");
export const ToggleSectionToken = token<uc.ToggleSection>("ToggleSection");
export const ReorderSectionsToken = token<uc.ReorderSections>("ReorderSections");
export const DeleteSectionToken = token<uc.DeleteSection>("DeleteSection");
export const ListSlidersToken = token<uc.ListSliders>("ListSliders");
export const CreateSliderToken = token<uc.CreateSlider>("CreateSlider");
export const DeleteSliderToken = token<uc.DeleteSlider>("DeleteSlider");
export const SaveSlideToken = token<uc.SaveSlide>("SaveSlide");
export const DeleteSlideToken = token<uc.DeleteSlide>("DeleteSlide");
export const ReorderSlidesToken = token<uc.ReorderSlides>("ReorderSlides");
export const ListStoryCollectionsToken = token<uc.ListStoryCollections>("ListStoryCollections");
export const CreateStoryCollectionToken = token<uc.CreateStoryCollection>("CreateStoryCollection");
export const DeleteStoryCollectionToken = token<uc.DeleteStoryCollection>("DeleteStoryCollection");
export const SaveStoryToken = token<uc.SaveStory>("SaveStory");
export const DeleteStoryToken = token<uc.DeleteStory>("DeleteStory");
export const ReorderStoriesToken = token<uc.ReorderStories>("ReorderStories");

export function registerShowcase(c: Container): void {
  const deps = (r: Resolver): uc.ShowcaseDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(ShowcaseRepositoryToken), media: r.resolve(MediaLibraryToken),
    audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(ShowcaseRepositoryToken, (r) => new D1ShowcaseRepository(r.resolve(DatabaseToken)));
  c.scoped(ListSectionsToken, (r) => new uc.ListSections(r.resolve(ShowcaseRepositoryToken)));
  c.scoped(ListSlidersToken, (r) => new uc.ListSliders(r.resolve(ShowcaseRepositoryToken)));
  c.scoped(ListStoryCollectionsToken, (r) => new uc.ListStoryCollections(r.resolve(ShowcaseRepositoryToken)));
  const commands: [ReturnType<typeof token>, new (d: uc.ShowcaseDeps) => unknown][] = [
    [SaveSectionToken, uc.SaveSection], [ToggleSectionToken, uc.ToggleSection], [ReorderSectionsToken, uc.ReorderSections], [DeleteSectionToken, uc.DeleteSection],
    [CreateSliderToken, uc.CreateSlider], [DeleteSliderToken, uc.DeleteSlider], [SaveSlideToken, uc.SaveSlide], [DeleteSlideToken, uc.DeleteSlide], [ReorderSlidesToken, uc.ReorderSlides],
    [CreateStoryCollectionToken, uc.CreateStoryCollection], [DeleteStoryCollectionToken, uc.DeleteStoryCollection], [SaveStoryToken, uc.SaveStory],
    [DeleteStoryToken, uc.DeleteStory], [ReorderStoriesToken, uc.ReorderStories],
  ];
  for (const [t, Cmd] of commands) c.scoped(t, (r) => new Cmd(deps(r)));
}

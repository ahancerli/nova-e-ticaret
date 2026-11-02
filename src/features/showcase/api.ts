"use client";

import { api } from "@/lib/api-client";
import type { SectionInput, SlideInput, StoryInput } from "@/modules/showcase";

const base = "/api/admin/showcase";
const enc = encodeURIComponent;

export const showcaseApi = {
  createSection: (s: SectionInput) => api<{ id: string; updatedAt: string }>(`${base}/sections`, { method: "POST", json: s }),
  updateSection: (id: string, s: SectionInput & { expectedUpdatedAt: string }) => api<{ id: string; updatedAt: string }>(`${base}/sections/${enc(id)}`, { method: "PUT", json: s }),
  toggleSection: (id: string, isActive: boolean) => api<{ updated: true }>(`${base}/sections/${enc(id)}`, { method: "PATCH", json: { isActive } }),
  deleteSection: (id: string) => api<{ deleted: true }>(`${base}/sections/${enc(id)}`, { method: "DELETE" }),
  orderSections: (order: string[]) => api<{ updated: true }>(`${base}/sections/order`, { method: "PUT", json: { order } }),

  createSlider: (name: string) => api<{ id: string }>(`${base}/sliders`, { method: "POST", json: { name } }),
  deleteSlider: (id: string) => api<{ deleted: true }>(`${base}/sliders/${enc(id)}`, { method: "DELETE" }),
  saveSlide: (sliderId: string, slideId: string | null, s: SlideInput) =>
    api<{ id: string }>(slideId ? `${base}/sliders/${enc(sliderId)}/slides/${enc(slideId)}` : `${base}/sliders/${enc(sliderId)}/slides`, { method: slideId ? "PUT" : "POST", json: s }),
  deleteSlide: (sliderId: string, slideId: string) => api<{ deleted: true }>(`${base}/sliders/${enc(sliderId)}/slides/${enc(slideId)}`, { method: "DELETE" }),
  orderSlides: (sliderId: string, order: string[]) => api<{ updated: true }>(`${base}/sliders/${enc(sliderId)}/order`, { method: "PUT", json: { order } }),

  createCollection: (name: string) => api<{ id: string }>(`${base}/stories`, { method: "POST", json: { name } }),
  deleteCollection: (id: string) => api<{ deleted: true }>(`${base}/stories/${enc(id)}`, { method: "DELETE" }),
  saveStory: (collectionId: string, storyId: string | null, s: StoryInput) =>
    api<{ id: string }>(storyId ? `${base}/stories/${enc(collectionId)}/items/${enc(storyId)}` : `${base}/stories/${enc(collectionId)}/items`, { method: storyId ? "PUT" : "POST", json: s }),
  deleteStory: (collectionId: string, storyId: string) => api<{ deleted: true }>(`${base}/stories/${enc(collectionId)}/items/${enc(storyId)}`, { method: "DELETE" }),
  orderStories: (collectionId: string, order: string[]) => api<{ updated: true }>(`${base}/stories/${enc(collectionId)}/order`, { method: "PUT", json: { order } }),
};

/** Moves one id up or down in a list (for the ↑ / ↓ buttons). */
export function move<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const j = index + delta;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j]!, next[index]!];
  return next;
}

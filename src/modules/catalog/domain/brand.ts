/** Brand aggregate types (pure). */

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoMediaId: string | null;
  logoUrl: string | null;
  bannerMediaId: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  productCount: number;
  storyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrandInput {
  name: string;
  slug?: string;
  description?: string | null;
  logoMediaId?: string | null;
  bannerMediaId?: string | null;
  websiteUrl?: string | null;
  isActive: boolean;
}

export type BrandPatch = Partial<BrandInput>;

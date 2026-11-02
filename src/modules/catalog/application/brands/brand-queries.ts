import type { BrandRow } from "../../domain/brand";
import type { BrandRepository } from "../ports";

/** Query: all brands with usage counts. */
export class ListBrands {
  constructor(private readonly brands: BrandRepository) {}

  execute(): Promise<BrandRow[]> {
    return this.brands.list();
  }
}

/** Query: one brand. null = not found. */
export class GetBrand {
  constructor(private readonly brands: BrandRepository) {}

  execute(id: string): Promise<BrandRow | null> {
    return this.brands.find(id);
  }
}

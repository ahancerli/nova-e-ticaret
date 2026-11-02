import { buildTree, parentOptionsFor, type CategoryNode, type CategoryTree, type ParentOption } from "../../domain/category";
import type { CategoryRepository } from "../ports";

/** Query: the whole category tree (admin tree view, product editor category picker). */
export class ListCategoryTree {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(): Promise<CategoryTree> {
    return buildTree(await this.categories.listAll());
  }
}

export interface CategoryDetail {
  category: CategoryNode;
  parentOptions: ParentOption[];
  sampleProducts: { id: string; name: string; slug: string; status: string }[];
  tree: CategoryNode[];
}

/** Query: one category with the parents it may move under and a sample of its products. null = not found. */
export class GetCategoryDetail {
  constructor(private readonly categories: CategoryRepository) {}

  async execute(id: string): Promise<CategoryDetail | null> {
    const { tree, flat } = buildTree(await this.categories.listAll());
    const category = flat.find((c) => c.id === id);
    if (!category) return null;
    return {
      category,
      parentOptions: parentOptionsFor(category, flat),
      sampleProducts: await this.categories.sampleProducts(id, 20),
      tree,
    };
  }
}

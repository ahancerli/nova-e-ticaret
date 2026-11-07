import type { AttributeMeta, ProductEditorData, ProductListRow, ProductMeta } from "../../domain/product";
import type { ListCategoryTree } from "../categories/category-queries";
import type { ProductReadModel } from "./ports";

/** Query: admin product grid. */
export class ListProducts {
  constructor(private readonly read: ProductReadModel) {}

  execute(): Promise<ProductListRow[]> {
    return this.read.list();
  }
}

/** Query: everything the editor needs for one product. null = not found. */
export class GetProductEditor {
  constructor(private readonly read: ProductReadModel) {}

  execute(id: string): Promise<ProductEditorData | null> {
    return this.read.editor(id);
  }
}

/** Query: editor reference data (brands, category tree, attribute catalogue, required-attribute rules). */
export class GetProductMeta {
  constructor(private readonly read: ProductReadModel, private readonly categoryTree: ListCategoryTree) {}

  async execute(): Promise<ProductMeta> {
    const [ref, { flat }] = await Promise.all([this.read.reference(), this.categoryTree.execute()]);
    return {
      brands: ref.brands,
      categories: flat.map((c) => ({ id: c.id, parentId: c.parentId, name: c.name, depth: c.depth, path: c.path, isActive: c.isActive })),
      categoryAttributes: ref.categoryAttributes,
      attributes: ref.attributes.map((a) => ({
        ...a,
        dataType: a.dataType as AttributeMeta["dataType"],
        options: ref.options.filter((o) => o.attributeId === a.id).map((o) => ({ id: o.id, value: o.value, label: o.label, colorHex: o.colorHex, isActive: o.isActive, numericValue: o.numericValue })),
      })),
    };
  }
}

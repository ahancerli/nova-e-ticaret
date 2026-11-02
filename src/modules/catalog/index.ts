/** Public surface of the catalog module (admin categories, brands, products). Other code imports only from here. */
export type { CategoryInput, CategoryNode, CategoryPatch, CategoryRecord, CategoryTree, ParentOption } from "./domain/category";
export type { BrandInput, BrandPatch, BrandRow } from "./domain/brand";
export type { CategoryDetail } from "./application/categories/category-queries";
export type { AttributeMeta, EditorVariant, ProductEditorData, ProductListRow, ProductMeta, SavedProduct } from "./domain/product";
export type { ProductInput } from "./application/products/product-input";
export { brandCreateSchema, brandUpdateSchema, categoryCreateSchema, categoryUpdateSchema, productSaveSchema } from "./http/schemas";
export {
  CreateBrandToken,
  CreateCategoryToken,
  CreateProductToken,
  DeleteBrandToken,
  DeleteCategoryToken,
  DeleteProductToken,
  GetBrandToken,
  GetCategoryDetailToken,
  GetProductEditorToken,
  GetProductMetaToken,
  ListBrandsToken,
  ListCategoryTreeToken,
  ListProductsToken,
  UpdateBrandToken,
  UpdateCategoryToken,
  UpdateProductToken,
  registerCatalog,
} from "./module";

/** Public surface of the catalog module (admin categories + brands). Other code imports only from here. */
export type { CategoryInput, CategoryNode, CategoryPatch, CategoryRecord, CategoryTree, ParentOption } from "./domain/category";
export type { BrandInput, BrandPatch, BrandRow } from "./domain/brand";
export type { CategoryDetail } from "./application/categories/category-queries";
export { brandCreateSchema, brandUpdateSchema, categoryCreateSchema, categoryUpdateSchema } from "./http/schemas";
export {
  CreateBrandToken,
  CreateCategoryToken,
  DeleteBrandToken,
  DeleteCategoryToken,
  GetBrandToken,
  GetCategoryDetailToken,
  ListBrandsToken,
  ListCategoryTreeToken,
  UpdateBrandToken,
  UpdateCategoryToken,
  registerCatalog,
} from "./module";

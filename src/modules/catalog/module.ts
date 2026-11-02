import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MediaLibraryToken } from "@/modules/media";
import { CreateBrand, DeleteBrand, UpdateBrand, type BrandCommandDeps } from "./application/brands/brand-commands";
import { GetBrand, ListBrands } from "./application/brands/brand-queries";
import { CreateCategory, DeleteCategory, UpdateCategory, type CategoryCommandDeps } from "./application/categories/category-commands";
import { GetCategoryDetail, ListCategoryTree } from "./application/categories/category-queries";
import type { BrandRepository, CategoryRepository } from "./application/ports";
import { D1BrandRepository } from "./infrastructure/d1-brand.repository";
import { D1CategoryRepository } from "./infrastructure/d1-category.repository";

export const CategoryRepositoryToken = token<CategoryRepository>("CategoryRepository");
export const BrandRepositoryToken = token<BrandRepository>("BrandRepository");

export const ListCategoryTreeToken = token<ListCategoryTree>("ListCategoryTree");
export const GetCategoryDetailToken = token<GetCategoryDetail>("GetCategoryDetail");
export const CreateCategoryToken = token<CreateCategory>("CreateCategory");
export const UpdateCategoryToken = token<UpdateCategory>("UpdateCategory");
export const DeleteCategoryToken = token<DeleteCategory>("DeleteCategory");

export const ListBrandsToken = token<ListBrands>("ListBrands");
export const GetBrandToken = token<GetBrand>("GetBrand");
export const CreateBrandToken = token<CreateBrand>("CreateBrand");
export const UpdateBrandToken = token<UpdateBrand>("UpdateBrand");
export const DeleteBrandToken = token<DeleteBrand>("DeleteBrand");

const categoryDeps = (r: Resolver): CategoryCommandDeps => ({
  db: r.resolve(DatabaseToken),
  categories: r.resolve(CategoryRepositoryToken),
  media: r.resolve(MediaLibraryToken),
  audit: r.resolve(AuditLogToken),
  clock: r.resolve(ClockToken),
  ids: r.resolve(IdGeneratorToken),
});

const brandDeps = (r: Resolver): BrandCommandDeps => ({
  db: r.resolve(DatabaseToken),
  brands: r.resolve(BrandRepositoryToken),
  media: r.resolve(MediaLibraryToken),
  audit: r.resolve(AuditLogToken),
  clock: r.resolve(ClockToken),
  ids: r.resolve(IdGeneratorToken),
});

export function registerCatalog(c: Container): void {
  c.scoped(CategoryRepositoryToken, (r) => new D1CategoryRepository(r.resolve(DatabaseToken)));
  c.scoped(BrandRepositoryToken, (r) => new D1BrandRepository(r.resolve(DatabaseToken)));

  c.scoped(ListCategoryTreeToken, (r) => new ListCategoryTree(r.resolve(CategoryRepositoryToken)));
  c.scoped(GetCategoryDetailToken, (r) => new GetCategoryDetail(r.resolve(CategoryRepositoryToken)));
  c.scoped(CreateCategoryToken, (r) => new CreateCategory(categoryDeps(r)));
  c.scoped(UpdateCategoryToken, (r) => new UpdateCategory(categoryDeps(r)));
  c.scoped(DeleteCategoryToken, (r) => new DeleteCategory(categoryDeps(r)));

  c.scoped(ListBrandsToken, (r) => new ListBrands(r.resolve(BrandRepositoryToken)));
  c.scoped(GetBrandToken, (r) => new GetBrand(r.resolve(BrandRepositoryToken)));
  c.scoped(CreateBrandToken, (r) => new CreateBrand(brandDeps(r)));
  c.scoped(UpdateBrandToken, (r) => new UpdateBrand(brandDeps(r)));
  c.scoped(DeleteBrandToken, (r) => new DeleteBrand(brandDeps(r)));
}

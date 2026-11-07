import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MediaLibraryToken } from "@/modules/media";
import { CreateBrand, DeleteBrand, UpdateBrand, type BrandCommandDeps } from "./application/brands/brand-commands";
import { GetBrand, ListBrands } from "./application/brands/brand-queries";
import { CreateCategory, DeleteCategory, UpdateCategory, type CategoryCommandDeps } from "./application/categories/category-commands";
import { GetCategoryDetail, ListCategoryTree } from "./application/categories/category-queries";
import {
  AddAttributeOptions, ApplyAttributeTemplate, CreateAttribute, DeleteAttribute, DeleteAttributeOption, GenerateBarcodes, GetBarcodeSettings, ListAttributes,
  ReorderAttributeOptions, SetAttributeCategories, SetBarcodePrefix, UpdateAttribute, UpdateAttributeOption, type AttributeDeps,
} from "./application/attributes/attribute-commands";
import type { AttributeRepository, BrandRepository, CategoryRepository } from "./application/ports";
import { D1AttributeRepository } from "./infrastructure/d1-attribute.repository";
import { CheckProductSave, CreateProduct, DeleteProduct, UpdateProduct, type ProductCommandDeps } from "./application/products/product-commands";
import { GetProductEditor, GetProductMeta, ListProducts } from "./application/products/product-queries";
import type { ProductReadModel, ProductRepository } from "./application/products/ports";
import { D1ProductReadModel } from "./infrastructure/d1-product-read-model";
import { D1ProductRepository } from "./infrastructure/d1-product.repository";
import { D1BrandRepository } from "./infrastructure/d1-brand.repository";
import { D1CategoryRepository } from "./infrastructure/d1-category.repository";

export const CategoryRepositoryToken = token<CategoryRepository>("CategoryRepository");
export const BrandRepositoryToken = token<BrandRepository>("BrandRepository");
export const ProductRepositoryToken = token<ProductRepository>("ProductRepository");
export const ProductReadModelToken = token<ProductReadModel>("ProductReadModel");

export const ListCategoryTreeToken = token<ListCategoryTree>("ListCategoryTree");
export const AttributeRepositoryToken = token<AttributeRepository>("AttributeRepository");
export const ListAttributesToken = token<ListAttributes>("ListAttributes");
export const CreateAttributeToken = token<CreateAttribute>("CreateAttribute");
export const ApplyAttributeTemplateToken = token<ApplyAttributeTemplate>("ApplyAttributeTemplate");
export const UpdateAttributeToken = token<UpdateAttribute>("UpdateAttribute");
export const DeleteAttributeToken = token<DeleteAttribute>("DeleteAttribute");
export const AddAttributeOptionsToken = token<AddAttributeOptions>("AddAttributeOptions");
export const UpdateAttributeOptionToken = token<UpdateAttributeOption>("UpdateAttributeOption");
export const DeleteAttributeOptionToken = token<DeleteAttributeOption>("DeleteAttributeOption");
export const ReorderAttributeOptionsToken = token<ReorderAttributeOptions>("ReorderAttributeOptions");
export const SetAttributeCategoriesToken = token<SetAttributeCategories>("SetAttributeCategories");
export const GetBarcodeSettingsToken = token<GetBarcodeSettings>("GetBarcodeSettings");
export const SetBarcodePrefixToken = token<SetBarcodePrefix>("SetBarcodePrefix");
export const GenerateBarcodesToken = token<GenerateBarcodes>("GenerateBarcodes");
export const GetCategoryDetailToken = token<GetCategoryDetail>("GetCategoryDetail");
export const CreateCategoryToken = token<CreateCategory>("CreateCategory");
export const UpdateCategoryToken = token<UpdateCategory>("UpdateCategory");
export const DeleteCategoryToken = token<DeleteCategory>("DeleteCategory");

export const ListBrandsToken = token<ListBrands>("ListBrands");
export const GetBrandToken = token<GetBrand>("GetBrand");
export const CreateBrandToken = token<CreateBrand>("CreateBrand");
export const UpdateBrandToken = token<UpdateBrand>("UpdateBrand");
export const DeleteBrandToken = token<DeleteBrand>("DeleteBrand");

export const ListProductsToken = token<ListProducts>("ListProducts");
export const GetProductEditorToken = token<GetProductEditor>("GetProductEditor");
export const GetProductMetaToken = token<GetProductMeta>("GetProductMeta");
export const CreateProductToken = token<CreateProduct>("CreateProduct");
export const UpdateProductToken = token<UpdateProduct>("UpdateProduct");
export const CheckProductSaveToken = token<CheckProductSave>("CheckProductSave");
export const DeleteProductToken = token<DeleteProduct>("DeleteProduct");

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

const productDeps = (r: Resolver): ProductCommandDeps => ({
  db: r.resolve(DatabaseToken),
  products: r.resolve(ProductRepositoryToken),
  meta: r.resolve(GetProductMetaToken),
  media: r.resolve(MediaLibraryToken),
  audit: r.resolve(AuditLogToken),
  clock: r.resolve(ClockToken),
  ids: r.resolve(IdGeneratorToken),
});

export function registerCatalog(c: Container): void {
  c.scoped(CategoryRepositoryToken, (r) => new D1CategoryRepository(r.resolve(DatabaseToken)));
  c.scoped(BrandRepositoryToken, (r) => new D1BrandRepository(r.resolve(DatabaseToken)));

  c.scoped(ListCategoryTreeToken, (r) => new ListCategoryTree(r.resolve(CategoryRepositoryToken)));
  c.scoped(AttributeRepositoryToken, (r) => new D1AttributeRepository(r.resolve(DatabaseToken)));
  const attrDeps = (r: Resolver): AttributeDeps => ({ db: r.resolve(DatabaseToken), attributes: r.resolve(AttributeRepositoryToken), audit: r.resolve(AuditLogToken), ids: r.resolve(IdGeneratorToken) });
  c.scoped(ListAttributesToken, (r) => new ListAttributes(r.resolve(AttributeRepositoryToken)));
  c.scoped(CreateAttributeToken, (r) => new CreateAttribute(attrDeps(r)));
  c.scoped(ApplyAttributeTemplateToken, (r) => new ApplyAttributeTemplate(attrDeps(r)));
  c.scoped(UpdateAttributeToken, (r) => new UpdateAttribute(attrDeps(r)));
  c.scoped(DeleteAttributeToken, (r) => new DeleteAttribute(attrDeps(r)));
  c.scoped(AddAttributeOptionsToken, (r) => new AddAttributeOptions(attrDeps(r)));
  c.scoped(UpdateAttributeOptionToken, (r) => new UpdateAttributeOption(attrDeps(r)));
  c.scoped(DeleteAttributeOptionToken, (r) => new DeleteAttributeOption(attrDeps(r)));
  c.scoped(ReorderAttributeOptionsToken, (r) => new ReorderAttributeOptions(attrDeps(r)));
  c.scoped(SetAttributeCategoriesToken, (r) => new SetAttributeCategories(attrDeps(r)));
  c.scoped(GetBarcodeSettingsToken, (r) => new GetBarcodeSettings(r.resolve(AttributeRepositoryToken)));
  c.scoped(SetBarcodePrefixToken, (r) => new SetBarcodePrefix(attrDeps(r)));
  c.scoped(GenerateBarcodesToken, (r) => new GenerateBarcodes(r.resolve(AttributeRepositoryToken)));
  c.scoped(GetCategoryDetailToken, (r) => new GetCategoryDetail(r.resolve(CategoryRepositoryToken)));
  c.scoped(CreateCategoryToken, (r) => new CreateCategory(categoryDeps(r)));
  c.scoped(UpdateCategoryToken, (r) => new UpdateCategory(categoryDeps(r)));
  c.scoped(DeleteCategoryToken, (r) => new DeleteCategory(categoryDeps(r)));

  c.scoped(ListBrandsToken, (r) => new ListBrands(r.resolve(BrandRepositoryToken)));
  c.scoped(GetBrandToken, (r) => new GetBrand(r.resolve(BrandRepositoryToken)));
  c.scoped(CreateBrandToken, (r) => new CreateBrand(brandDeps(r)));
  c.scoped(UpdateBrandToken, (r) => new UpdateBrand(brandDeps(r)));
  c.scoped(DeleteBrandToken, (r) => new DeleteBrand(brandDeps(r)));

  c.scoped(ProductRepositoryToken, (r) => new D1ProductRepository(r.resolve(DatabaseToken)));
  c.scoped(ProductReadModelToken, (r) => new D1ProductReadModel(r.resolve(DatabaseToken)));
  c.scoped(ListProductsToken, (r) => new ListProducts(r.resolve(ProductReadModelToken)));
  c.scoped(GetProductEditorToken, (r) => new GetProductEditor(r.resolve(ProductReadModelToken)));
  c.scoped(GetProductMetaToken, (r) => new GetProductMeta(r.resolve(ProductReadModelToken), r.resolve(ListCategoryTreeToken)));
  c.scoped(CreateProductToken, (r) => new CreateProduct(productDeps(r)));
  c.scoped(UpdateProductToken, (r) => new UpdateProduct(productDeps(r)));
  c.scoped(CheckProductSaveToken, (r) => new CheckProductSave(productDeps(r)));
  c.scoped(DeleteProductToken, (r) => new DeleteProduct(productDeps(r)));
}

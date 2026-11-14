import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { GetTemplateVariablesToken } from "@/modules/settings";
import {
  CreatePage, DeletePage, GetAcceptedContracts, GetCheckoutLegal, GetCookiePolicy, GetSignupLegal, GetFooterLinks, GetPage, GetPageRevision, GetPublishedPage, ListPages, UpdatePage, type ContentCommandDeps,
} from "./application/content-use-cases";
import type { ContentRepository } from "./application/ports";
import { D1ContentRepository } from "./infrastructure/d1-content.repository";

export const ContentRepositoryToken = token<ContentRepository>("ContentRepository");
export const ListPagesToken = token<ListPages>("ListPages");
export const GetPageToken = token<GetPage>("GetPage");
export const GetPageRevisionToken = token<GetPageRevision>("GetPageRevision");
export const CreatePageToken = token<CreatePage>("CreatePage");
export const UpdatePageToken = token<UpdatePage>("UpdatePage");
export const DeletePageToken = token<DeletePage>("DeletePage");
export const GetPublishedPageToken = token<GetPublishedPage>("GetPublishedPage");
export const GetFooterLinksToken = token<GetFooterLinks>("GetFooterLinks");
export const GetCheckoutLegalToken = token<GetCheckoutLegal>("GetCheckoutLegal");
export const GetCookiePolicyToken = token<GetCookiePolicy>("GetCookiePolicy");
export const GetSignupLegalToken = token<GetSignupLegal>("GetSignupLegal");
export const GetAcceptedContractsToken = token<GetAcceptedContracts>("GetAcceptedContracts");

export function registerContent(c: Container): void {
  const deps = (r: Resolver): ContentCommandDeps => ({
    db: r.resolve(DatabaseToken), pages: r.resolve(ContentRepositoryToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(ContentRepositoryToken, (r) => new D1ContentRepository(r.resolve(DatabaseToken)));
  c.scoped(ListPagesToken, (r) => new ListPages(r.resolve(ContentRepositoryToken)));
  c.scoped(GetPageToken, (r) => new GetPage(r.resolve(ContentRepositoryToken)));
  c.scoped(GetPageRevisionToken, (r) => new GetPageRevision(r.resolve(ContentRepositoryToken)));
  c.scoped(CreatePageToken, (r) => new CreatePage(deps(r)));
  c.scoped(UpdatePageToken, (r) => new UpdatePage(deps(r)));
  c.scoped(DeletePageToken, (r) => new DeletePage(deps(r)));
  c.scoped(GetPublishedPageToken, (r) => new GetPublishedPage(r.resolve(ContentRepositoryToken), r.resolve(GetTemplateVariablesToken)));
  c.scoped(GetFooterLinksToken, (r) => new GetFooterLinks(r.resolve(ContentRepositoryToken)));
  c.scoped(GetCheckoutLegalToken, (r) => new GetCheckoutLegal(r.resolve(ContentRepositoryToken)));
  c.scoped(GetCookiePolicyToken, (r) => new GetCookiePolicy(r.resolve(ContentRepositoryToken)));
  c.scoped(GetSignupLegalToken, (r) => new GetSignupLegal(r.resolve(ContentRepositoryToken)));
  c.scoped(GetAcceptedContractsToken, (r) => new GetAcceptedContracts(r.resolve(ContentRepositoryToken), r.resolve(GetTemplateVariablesToken)));
}

/** Public surface of the content module (company-specific pages: legal texts, corporate, help; footer links). */
export * from "./domain/page";
export { placeholdersIn, renderTemplate } from "./domain/template";
export { LEGAL_TEMPLATES } from "./domain/legal-templates";
export { pageCreateSchema, pageUpdateSchema, revisionParams } from "./http/schemas";
export {
  CreatePageToken, DeletePageToken, GetAcceptedContractsToken, GetCheckoutLegalToken, GetCookiePolicyToken, GetSignupLegalToken, GetFooterLinksToken, GetPageRevisionToken, GetPageToken, GetPublishedPageToken, ListPagesToken,
  UpdatePageToken, registerContent,
} from "./module";

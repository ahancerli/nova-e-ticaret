/** Public surface of the consent module: cookie consent (KVKK banner, proof records) and tracking tags (GA4, Meta Pixel …). */
export * from "./domain/consent";
export * from "./domain/tags";
export * from "./domain/events";
export type { ConsentAdminView, RecordConsentInput, SaveTrackingTagInput, UpdateConsentSettingsInput } from "./application/consent-use-cases";
export type { ConsentRecordRow, ConsentStats } from "./application/ports";
export { META_GRAPH_VERSION, type TrackingHttp } from "./application/server-tracking";
export { consentRecordSchema, consentRecordsQuery, consentSettingsSchema, tagCodeParams, trackingTagDeleteSchema, trackingTagSaveSchema } from "./http/schemas";
export {
  CaptureOrderTrackingToken, GetConsentAdminToken, GetConsentConfigToken, TrackingHttpToken, ListConsentRecordsToken, RecordConsentToken, RemoveTrackingTagToken, RenewConsentToken, SaveTrackingTagToken,
  UpdateConsentSettingsToken, registerConsent,
} from "./module";
